import { ClasspackDialogApp } from "./dialog-app.mjs";
import { log } from "./utils.mjs";

const DEFAULT_TIMEOUT = 15000;
const MAX_TIMEOUT = 300000;
const DELIVERY_TIMEOUT = 5000;

export function timedDuration(value = DEFAULT_TIMEOUT) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 100 || value > MAX_TIMEOUT) {
    throw new RangeError("ClassPack timed dialog duration must be between 100 and 300000 milliseconds.");
  }
  return value;
}

/** Reject Documents, callbacks and lossy/non-JSON data before opening any window. */
function wireCopy(value) {
  const ancestors = new Set();
  function visit(entry, depth = 0) {
    if (depth > 30) throw new TypeError("ClassPack timed dialog data is too deeply nested.");
    if (entry == null || typeof entry === "string" || typeof entry === "boolean") return entry;
    if (typeof entry === "number" && Number.isFinite(entry)) return entry;
    if (typeof entry !== "object" || ancestors.has(entry)
      || (!Array.isArray(entry) && Object.getPrototypeOf(entry) !== Object.prototype)) {
      throw new TypeError("ClassPack timed dialogs require plain, serializable data.");
    }
    ancestors.add(entry);
    const result = Array.isArray(entry) ? entry.map(value => visit(value, depth + 1))
      : Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, visit(value, depth + 1)]));
    ancestors.delete(entry);
    return result;
  }
  const copy = visit(value);
  if (JSON.stringify(copy).length > 250000) throw new RangeError("ClassPack timed dialog data exceeds 250 KB.");
  return copy;
}

/** One controller on the initiating client arbitrates all decisions. */
export class TimedDialogManager {
  requests = new Map();
  windows = new Map();
  // A close may overtake a delayed open RPC. Tombstones are pruned on use.
  closedWindows = new Map();

  constructor(api) { this.api = api; }

  get publicAPI() {
    return Object.freeze({
      timedDialog: (...args) => this.request(...args),
      timedConfirm: async ({ title = "Classpack.Timed.Confirm", content = "", defaultResult = false, ...options } = {}) => {
        if (typeof defaultResult !== "boolean") throw new TypeError("timedConfirm defaultResult must be boolean.");
        const result = await this.request(title, content, [], "yesNo", { ...options, defaultResult });
        return result === true || result?.buttons === true;
      }
    });
  }

  async request(title, content, inputs = [], buttons = "okCancel", options = {}) {
    if (typeof title !== "string" || typeof content !== "string" || !Array.isArray(inputs)) {
      throw new TypeError("timedDialog requires a title, content string and input descriptors array.");
    }
    const timeoutMs = timedDuration(options.timeoutMs), gmTimeoutMs = timedDuration(options.gmTimeoutMs);
    const userId = options.userId ?? game.user.id;
    if (typeof userId !== "string") throw new TypeError("timedDialog userId must be a User ID string.");
    const args = wireCopy([title, content, inputs, buttons ?? null]);
    const defaultResult = wireCopy(options.defaultResult ?? null);
    const dialogOptions = wireCopy({ width: options.width, height: options.height, compact: options.compact });
    const requestId = foundry.utils.randomID(32);
    const promise = new Promise(resolve => {
      const request = { requestId, args, userId, dialogOptions, timeoutMs, gmTimeoutMs, defaultResult,
        mirrorToGM: options.mirrorToGM !== false, resolve, parts: new Map(), triedGMs: new Set(), phase: "player" };
      this.requests.set(requestId, request);
      if (game.users.get(userId)?.active) {
        this.openPart(request, userId, "player");
        if (request.mirrorToGM) this.ensureGM(request);
      } else this.takeover(request);
    });
    return promise;
  }

  /** Bounded transport, with no fallback to a different local user. */
  async send(operation, userId, payload) {
    try {
      if (userId === game.user.id) return this[operation](payload, game.user.id);
      if (!this.api.socket?.executeForUsers || !game.users.get(userId)?.active) return false;
      // Notifications plus first-render acknowledgements avoid leaving an
      // unanswerable executeAsUser RPC inside socketlib when a client vanishes.
      await this.api.socket.executeForUsers(`cprTimed${operation[0].toUpperCase()}${operation.slice(1)}`, [userId], payload);
      return true;
    } catch (error) {
      log("warn", `Timed dialog ${operation} could not reach user ${userId}:`, error);
      return false;
    }
  }

  state(request, role) {
    const name = game.users.get(request.userId)?.name ?? request.userId;
    if (role === "player") return { phase: "player", durationMs: request.timeoutMs, statusKey: "Classpack.Timed.Player", name };
    if (request.phase === "gm") return { phase: "gm", durationMs: request.gmTimeoutMs, statusKey: "Classpack.Timed.Takeover", name };
    const remaining = request.deadline == null ? null : Math.max(100, request.deadline - performance.now());
    return { phase: "mirror", durationMs: remaining, statusKey: remaining == null ? "Classpack.Timed.Opening" : "Classpack.Timed.Mirror", name };
  }

  openPart(request, userId, role) {
    if (request.done) return;
    const windowId = foundry.utils.randomID(32), part = { windowId, userId, role, revision: 0, ready: false };
    request.parts.set(windowId, part);
    if (role === "gm") request.gm = part;
    else request.player = part;
    // Bound missing renders as well as unavailable/unresponsive remote clients.
    part.startup = setTimeout(() => this.unavailable(request, part), DELIVERY_TIMEOUT);
    const payload = { requestId: request.requestId, windowId, coordinatorId: game.user.id, userId,
      role, revision: part.revision, args: request.args, dialogOptions: request.dialogOptions,
      state: this.state(request, role), leaseMs: request.timeoutMs + request.gmTimeoutMs + DELIVERY_TIMEOUT * 3 };
    void this.send("open", userId, payload).then(accepted => {
      if (!accepted) this.unavailable(request, part);
      if (request.done || part.closed) void this.send("close", userId, payload);
    });
  }

  ensureGM(request) {
    if (request.done || (request.gm && !request.gm.closed)) return;
    const candidates = [...game.users].filter(user => user.active && user.isGM
      && user.id !== request.userId && !request.triedGMs.has(user.id));
    candidates.sort((a, b) => Number(b.id === game.user.id) - Number(a.id === game.user.id) || a.id.localeCompare(b.id));
    const gm = candidates[0];
    if (!gm) {
      if (request.phase === "gm") this.finish(request, request.defaultResult);
      return;
    }
    request.triedGMs.add(gm.id);
    this.openPart(request, gm.id, "gm");
  }

  unavailable(request, part) {
    if (request.done || part.closed) return;
    if (part.role === "gm" && request.phase === "gm") {
      clearTimeout(request.timer);
      request.deadline = null;
    }
    this.closePart(request, part);
    if (part.role === "player") this.takeover(request);
    else { request.gm = null; this.ensureGM(request); }
  }

  closePart(request, part) {
    if (!part || part.closed) return;
    part.closed = true;
    clearTimeout(part.startup);
    void this.send("close", part.userId, { requestId: request.requestId, windowId: part.windowId, coordinatorId: game.user.id });
  }

  takeover(request) {
    if (request.done || request.phase === "gm") return;
    request.phase = "gm";
    clearTimeout(request.timer);
    request.deadline = null;
    this.closePart(request, request.player);
    if (request.gm && !request.gm.closed) {
      const part = request.gm;
      part.ready = false;
      part.revision++;
      clearTimeout(part.startup);
      part.startup = setTimeout(() => this.unavailable(request, part), DELIVERY_TIMEOUT);
      void this.send("update", part.userId, { requestId: request.requestId, windowId: part.windowId,
        coordinatorId: game.user.id, revision: part.revision, state: this.state(request, "gm") })
        .then(accepted => { if (!accepted) this.unavailable(request, part); });
    } else this.ensureGM(request);
  }

  finish(request, result) {
    if (request.done) return false;
    request.done = true;
    clearTimeout(request.timer);
    for (const part of request.parts.values()) this.closePart(request, part);
    this.requests.delete(request.requestId);
    request.resolve(result);
    return true;
  }

  /** Called by socketlib with its authenticated sender ID, never a payload ID. */
  respond(message, senderId) {
    const request = this.requests.get(message?.requestId), part = request?.parts.get(message?.windowId);
    if (!request || request.done || !part || part.closed || part.userId !== senderId
      || (part.role === "gm" && !game.users.get(senderId)?.isGM)) return false;
    if (message.kind === "submit") {
      if (part.role === "player" && request.phase !== "player") return false;
      if (request.deadline != null && performance.now() >= request.deadline) {
        if (part.role === "player") { this.takeover(request); return false; }
        if (request.phase === "gm") { this.finish(request, request.defaultResult); return false; }
      }
      return this.finish(request, wireCopy(message.result));
    }
    if (message.revision !== part.revision) return false;
    if (message.kind === "ready") {
      if (part.ready) return true;
      let remainingMs;
      try { remainingMs = timedDuration(message.remainingMs); }
      catch { return false; }
      part.ready = true;
      clearTimeout(part.startup);
      const isTurn = part.role === "player" ? request.phase === "player" : request.phase === "gm";
      if (isTurn) {
        const duration = Math.min(remainingMs, part.role === "player" ? request.timeoutMs : request.gmTimeoutMs);
        request.deadline = performance.now() + duration;
        clearTimeout(request.timer);
        request.timer = setTimeout(() => {
          if (part.role === "player") this.takeover(request);
          else this.finish(request, request.defaultResult);
        }, duration);
        if (part.role === "player" && request.gm && !request.gm.closed) {
          const gm = request.gm;
          gm.revision++;
          void this.send("update", gm.userId, { requestId: request.requestId, windowId: gm.windowId,
            coordinatorId: game.user.id, revision: gm.revision, state: this.state(request, "gm") });
        }
      } else if (part.role === "gm" && request.deadline != null) {
        // Its open RPC may have arrived after the player's first-render update.
        part.revision++;
        void this.send("update", part.userId, { requestId: request.requestId, windowId: part.windowId,
          coordinatorId: game.user.id, revision: part.revision, state: this.state(request, "gm") });
      }
      return true;
    }
    if (message.kind === "timeout" || message.kind === "closed" || message.kind === "failed") {
      if (part.role === "player") this.unavailable(request, part);
      else if (request.phase === "gm" && message.kind === "timeout") this.finish(request, request.defaultResult);
      else this.unavailable(request, part);
      return true;
    }
    return false;
  }

  windowKey(senderId, windowId) { return `${senderId}:${windowId}`; }

  pruneClosed() {
    for (const [key, expires] of this.closedWindows) if (expires <= performance.now()) this.closedWindows.delete(key);
    while (this.closedWindows.size > 1024) this.closedWindows.delete(this.closedWindows.keys().next().value);
  }

  open(payload, senderId) {
    if (typeof senderId !== "string" || !payload || payload.coordinatorId !== senderId || payload.userId !== game.user.id
      || (payload.role !== "player" && payload.role !== "gm") || (payload.role === "gm" && !game.user.isGM)
      || typeof payload.requestId !== "string" || typeof payload.windowId !== "string") return false;
    if (!this.validState(payload.state, payload.role) || !Number.isFinite(payload.leaseMs)) return false;
    const key = this.windowKey(senderId, payload.windowId);
    this.pruneClosed();
    if (this.closedWindows.has(key)) return false;
    if (this.windows.has(key)) return true;
    const entry = { ...payload, key, rendered: false, decided: false };
    const app = entry.app = new ClasspackDialogApp([...payload.args, { ...payload.dialogOptions,
      id: `classpack-timed-${payload.windowId}`, timing: { state: payload.state,
        onReady: () => { entry.rendered = true; this.notifyReady(entry); },
        onTimeout: () => {
          if (entry.role === "gm" && entry.state.phase === "mirror") {
            app.setTiming({ ...entry.state, durationMs: null, statusKey: "Classpack.Timed.WaitingGM" });
          } else this.decide(entry, "timeout");
        }
      } }]);
    this.windows.set(key, entry);
    // Close even paused mirrors if the initiating client disconnects/reloads.
    entry.lease = setTimeout(() => this.decide(entry, "failed"),
      Math.min(MAX_TIMEOUT * 2 + DELIVERY_TIMEOUT * 3, Math.max(DELIVERY_TIMEOUT, payload.leaseMs)));
    app.submit = result => this.decide(entry, "submit", result);
    app.addEventListener("close", () => this.decide(entry, "closed"), { once: true });
    void app.render({ force: true }).catch(error => {
      log("error", "Timed dialog could not render:", error);
      this.decide(entry, "failed");
    });
    return true;
  }

  notifyReady(entry) {
    if (entry.decided) return;
    void this.send("respond", entry.coordinatorId, { requestId: entry.requestId, windowId: entry.windowId,
      revision: entry.revision, kind: "ready", remainingMs: entry.state.durationMs ?? DEFAULT_TIMEOUT });
  }

  validState(state, role) {
    if (!state || !["player", "mirror", "gm"].includes(state.phase)
      || (role === "player" && state.phase !== "player") || (role === "gm" && state.phase === "player")) return false;
    if (state.phase === "mirror" && state.durationMs === null) return true;
    try { timedDuration(state.durationMs); return true; }
    catch { return false; }
  }

  decide(entry, kind, result) {
    if (entry.decided) return;
    if (kind === "submit") {
      try { result = wireCopy(result); }
      catch (error) { log("warn", "Timed dialog result is not serializable:", error); kind = "failed"; }
    }
    entry.decided = true;
    entry.app.stopCountdown();
    const message = { requestId: entry.requestId, windowId: entry.windowId, revision: entry.revision, kind };
    if (kind === "submit") message.result = result;
    void this.send("respond", entry.coordinatorId, message);
    this.destroyWindow(entry);
  }

  destroyWindow(entry) {
    entry.decided = true;
    clearTimeout(entry.lease);
    entry.app.stopCountdown();
    this.windows.delete(entry.key);
    this.closedWindows.set(entry.key, performance.now() + MAX_TIMEOUT * 2 + DELIVERY_TIMEOUT * 3);
    this.pruneClosed();
    // V14 queues close behind any in-flight render on the Application semaphore.
    void entry.app.close({ animate: false }).catch(error => log("warn", "Timed dialog close failed:", error));
  }

  update(payload, senderId) {
    const entry = this.windows.get(this.windowKey(senderId, payload?.windowId));
    if (!entry || entry.decided || payload.coordinatorId !== senderId || entry.requestId !== payload.requestId
      || entry.role !== "gm" || !game.user.isGM || payload.revision <= entry.revision) return false;
    if (!this.validState(payload.state, "gm")) return false;
    entry.revision = payload.revision;
    entry.state = payload.state;
    entry.app.setTiming(payload.state);
    if (entry.rendered) this.notifyReady(entry);
    return true;
  }

  close(payload, senderId) {
    if (!payload || payload.coordinatorId !== senderId || typeof payload.windowId !== "string") return false;
    const key = this.windowKey(senderId, payload.windowId), entry = this.windows.get(key);
    if (entry && entry.requestId !== payload.requestId) return false;
    if (entry) this.destroyWindow(entry);
    else {
      this.closedWindows.set(key, performance.now() + MAX_TIMEOUT * 2 + DELIVERY_TIMEOUT * 3);
      this.pruneClosed();
    }
    return true;
  }

  userConnected(user, connected) {
    if (connected) return;
    for (const request of this.requests.values()) for (const part of request.parts.values()) {
      if (!part.closed && part.userId === user.id) this.unavailable(request, part);
    }
  }
}
