/**
 * ClassPack shared API entry point.
 *
 * Exposes:
 * - socketlib-backed remote functions (updateTargets / teleport)
 * - ClasspackDialogApp: an ApplicationV2-based dialog (similar to CPR's DialogApp)
 * - ClasspackTeleport: point-and-click token teleporting
 * - ClasspackCrosshairs: the measured-template crosshairs helper used by teleport
 * - dialogUtils: CPR-style dialog helpers (buttonDialog, selectTargetDialog, ...)
 *
 * Global access:
 *   globalThis.dnd5eClasspack / globalThis.classpack
 *   socket handle: dnd5eClasspack.socket
 *
 * The implementation is split across `scripts/api/` for maintainability. The
 * GitHub release workflow bundles this entry and its imports back into a single
 * `scripts/api.mjs` file.
 */

import { canUpdateToken, log, MODULE_ID, SOCKET_NAME, registerHandlebarsHelpers, resolveToken, resolveUserId, toSocketSafeOptions } from "./api/utils.mjs";
import { ClasspackDialogApp } from "./api/dialog-app.mjs";
import { ClasspackCrosshairs } from "./api/crosshairs.mjs";
import { ClasspackTeleport } from "./api/teleport.mjs";
import { createDialogUtils } from "./api/dialog-utils.mjs";
import { calculatePushUpdates, resolveOriginPoint } from "./api/push.mjs";
import { socketFunctions } from "./api/socket-functions.mjs";

const api = {
  socket: null,
  DialogApp: ClasspackDialogApp,
  Crosshairs: ClasspackCrosshairs,
  Teleport: ClasspackTeleport,

  /**
   * Open an ApplicationV2 dialog. Signature matches CPR:
   * dialog(title, content, inputs, buttons, options?)
   *
   * The optional fifth argument may include `userId` (or `user`). When that
   * user is not the current client, the dialog is opened on their client via
   * socketlib and the result is returned here.
   */
  dialog: async (...args) => {
    const options = args[4] ?? {};
    const targetUserId = resolveUserId(options.userId ?? options.user);

    if (targetUserId && targetUserId !== game.user.id) {
      if (!api.socket) {
        log("warn", "socketlib is not ready; opening the dialog on the local client instead.");
        return ClasspackDialogApp.dialog(...args);
      }
      const remoteArgs = [...args];
      remoteArgs[4] = toSocketSafeOptions(options, targetUserId);
      return await api.socket.executeAsUser("dialog", targetUserId, ...remoteArgs);
    }

    return await ClasspackDialogApp.dialog(...args);
  },

  /**
   * Set targets on the local client, or on another user's client via socketlib.
   */
  updateTargets: async function (tokens, user = game.user) {
    const list = Array.isArray(tokens) || tokens instanceof Set ? tokens : [tokens];
    const ids = Array.from(list).map(token => token?.id ?? token);

    let targetUser = typeof user === "string" ? game.users.get(user) : user;
    if (!targetUser) targetUser = game.user;

    if (targetUser === game.user) {
      canvas.tokens?.setTargets(ids);
    } else {
      if (!api.socket) {
        log("warn", "socketlib is not ready; updateTargets only affects the local client.");
        return;
      }
      await api.socket.executeAsUser("updateTargets", targetUser.id, ids);
    }
  },

  /**
   * Teleport one or more tokens.
   *
   * Two modes:
   * - Point mode (target omitted/null): the crosshair is anchored on the first
   *   token (or `options.centerpoint`) and the destination can be picked
   *   anywhere within `options.range`.
   * - Token mode (target provided): the crosshair is anchored on the target
   *   token and the moved tokens are placed relative to that point.
   *
   * Tokens and target can be Token placeables, TokenDocuments, or UUID strings.
   *
   * Options:
   * - `centerpoint`: a Token, TokenDocument, UUID string, or plain `{x, y}`
   *   point to use as the range anchor / reference point. Defaults to the
   *   controlling token centre (the target token in token mode, the first
   *   moved token in point mode).
   * - `userId` / `user`: run the teleport (including its crosshair UI) on that
   *   user's client via socketlib.
   * - If no user is specified and the local user lacks update permission for
   *   the tokens (or destination token), the crosshair UI still runs on the
   *   local client, and only the final token position updates are sent to a GM
   *   client via socketlib.
   */
  teleport: async function (tokens, target = null, options = {}) {
    const resolved = [];
    const list = Array.isArray(tokens) ? tokens : [tokens];
    for (const tokenish of list) {
      const token = await resolveToken(tokenish);
      if (token) resolved.push(token);
    }
    if (!resolved.length) {
      log("warn", "teleport: no tokens could be resolved to canvas placeables.");
      return;
    }

    const tokenUuids = resolved.map(token => token.document?.uuid ?? token.document?.id ?? token.id);
    const requestedUserId = resolveUserId(options.userId ?? options.user);

    // Resolve an optional destination token.
    let targetToken = null;
    if (target !== null && target !== undefined) {
      targetToken = await resolveToken(target);
      if (!targetToken) return;
    }

    // Point mode: no destination token, choose any point within range.
    if (!targetToken) {
      if (requestedUserId && requestedUserId !== game.user.id) {
        if (!api.socket) {
          log("warn", "socketlib is not ready; teleporting on the local client instead.");
        } else {
          const remoteOptions = toSocketSafeOptions(options, requestedUserId);
          return await api.socket.executeAsUser("teleportPoint", requestedUserId, tokenUuids, remoteOptions);
        }
      }

      const localCanMove = resolved.every(canUpdateToken);
      if (!localCanMove && api.socket) {
        const gmCommit = async updates => api.socket.executeAsGM("teleportUpdate", updates);
        await ClasspackTeleport.point(resolved, { ...options, commit: gmCommit });
        return;
      }
      if (!localCanMove) {
        log("warn", "No permission to move the target tokens and socketlib is not ready; teleport was not performed.");
        return;
      }

      await ClasspackTeleport.point(resolved, options);
      return;
    }

    const targetUuid = targetToken.document?.uuid ?? targetToken.document?.id ?? targetToken.id;

    // Token mode: explicitly requested a different client.
    if (requestedUserId && requestedUserId !== game.user.id) {
      if (!api.socket) {
        log("warn", "socketlib is not ready; teleporting on the local client instead.");
      } else {
        const remoteOptions = toSocketSafeOptions(options, requestedUserId);
        return await api.socket.executeAsUser("teleport", requestedUserId, tokenUuids, targetUuid, remoteOptions);
      }
    }

    // Token mode, lacking permission locally? Keep the crosshair UI local and
    // send only the resulting token updates to a GM client via socketlib.
    const localCanMove = resolved.every(canUpdateToken) && canUpdateToken(targetToken);
    if (!localCanMove && api.socket) {
      const gmCommit = async updates => api.socket.executeAsGM("teleportUpdate", updates);
      if (resolved.length > 1) await ClasspackTeleport.group(resolved, targetToken, { ...options, commit: gmCommit });
      else await ClasspackTeleport.target(resolved[0], targetToken, { ...options, commit: gmCommit });
      return;
    }
    if (!localCanMove) {
      log("warn", "No permission to move the target tokens and socketlib is not ready; teleport was not performed.");
      return;
    }

    if (resolved.length > 1) await ClasspackTeleport.group(resolved, targetToken, options);
    else await ClasspackTeleport.target(resolved[0], targetToken, options);
  },

  /**
   * Push targets away from (positive distance) or pull them toward (negative
   * distance) a reference origin. The origin may be a Token, a
   * MeasuredTemplate (its source point is used), a UUID string, or a plain
   * `{x, y}` point.
   *
   * The movement is collision-aware (`options.checkCollision`, default true)
   * and snaps to the grid. If the local user lacks permission to update the
   * targets, only the computed token updates are sent to a GM client via
   * socketlib.
   */
  push: async function (targets, origin, distance, options = {}) {
    const resolved = [];
    const list = Array.isArray(targets) ? targets : [targets];
    for (const tokenish of list) {
      const token = await resolveToken(tokenish);
      if (token) resolved.push(token);
    }
    if (!resolved.length) {
      log("warn", "push: no targets could be resolved to canvas placeables.");
      return;
    }

    const originPoint = await resolveOriginPoint(origin);
    if (!originPoint) return;

    const updates = calculatePushUpdates(resolved, originPoint, distance, options);
    if (!updates.length) {
      log("warn", "push: no targets could be moved; the path may be blocked or the distance is zero.");
      return;
    }

    const localCanMove = resolved.every(canUpdateToken);
    if (!localCanMove && api.socket) {
      return await api.socket.executeAsGM("pushUpdate", updates);
    }
    if (!localCanMove) {
      log("warn", "push: no permission to move the targets and socketlib is not ready.");
      return;
    }

    await canvas.scene.updateEmbeddedDocuments("Token", updates, { isPaste: true });
    return updates;
  },

  /**
   * Convenience wrapper for `push` with a negative distance.
   */
  pull: async function (targets, origin, distance, options = {}) {
    return await api.push(targets, origin, -Math.abs(distance), options);
  }
};

api.dialogUtils = createDialogUtils((...args) => api.dialog(...args));

/* -------------------------------------------------------------------------- *
 *  Registration
 * -------------------------------------------------------------------------- */

Hooks.once("init", () => {
  registerHandlebarsHelpers();
  const module = game.modules?.get?.(MODULE_ID);
  if (module) module.api = api;
});

Hooks.once("socketlib.ready", () => {
  const socketlib = globalThis.socketlib;
  if (!socketlib) {
    log("warn", "socketlib is not available; remote functions will be disabled.");
    return;
  }

  api.socket = socketlib.registerModule(SOCKET_NAME);
  if (!api.socket) {
    log("warn", "socketlib rejected the socket registration (is `socket: true` set in module.json?).");
    return;
  }

  for (const [name, fn] of Object.entries(socketFunctions)) {
    api.socket.register(name, fn);
  }
  log("info", "socket functions registered:", Object.keys(socketFunctions).join(", "));
});

Hooks.once("ready", () => {
  Hooks.callAll("dnd5eClasspackReady", api);
});

globalThis.dnd5eClasspack = api;
globalThis.classpack = api;
