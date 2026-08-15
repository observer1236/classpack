/**
 * ClassPack shared API entry point.
 *
 * Exposes:
 * - socketlib-backed remote functions (updateTargets / teleport)
 * - ClasspackDialogApp: an ApplicationV2-based dialog (similar to CPR's DialogApp)
 * - ClasspackTeleport: point-and-click token teleporting
 * - ClasspackCrosshairs: the measured-template crosshairs helper used by teleport
 *
 * Global access:
 *   globalThis.dnd5eClasspack / globalThis.classpack
 *   socket handle: dnd5eClasspack.socket
 *
 * The implementation is split across `scripts/api/` for maintainability. The
 * GitHub release workflow bundles this entry and its imports back into a single
 * `scripts/api.mjs` file.
 */

import { log, MODULE_ID, SOCKET_NAME, registerHandlebarsHelpers, resolveToken } from "./api/utils.mjs";
import { ClasspackDialogApp } from "./api/dialog-app.mjs";
import { ClasspackCrosshairs } from "./api/crosshairs.mjs";
import { ClasspackTeleport } from "./api/teleport.mjs";
import { socketFunctions } from "./api/socket-functions.mjs";

const api = {
  socket: null,
  DialogApp: ClasspackDialogApp,
  Crosshairs: ClasspackCrosshairs,
  Teleport: ClasspackTeleport,

  /**
   * Open an ApplicationV2 dialog. Signature matches CPR:
   * dialog(title, content, inputs, buttons, options?)
   */
  dialog: async (...args) => ClasspackDialogApp.dialog(...args),

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
   * Teleport one or more tokens to a destination token. Tokens and target can
   * be Token placeables, TokenDocuments, or UUID strings.
   */
  teleport: async function (tokens, target, options = {}) {
    const resolved = [];
    const list = Array.isArray(tokens) ? tokens : [tokens];
    for (const tokenish of list) {
      const token = await resolveToken(tokenish);
      if (token) resolved.push(token);
    }
    if (!resolved.length) return;

    const targetToken = await resolveToken(target);
    if (!targetToken) return;

    if (resolved.length > 1) await ClasspackTeleport.group(resolved, targetToken, options);
    else await ClasspackTeleport.target(resolved[0], targetToken, options);
  }
};

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
