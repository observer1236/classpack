/**
 * Socket-backed functions.
 */

import { resolveToken } from "./utils.mjs";
import { ClasspackDialogApp } from "./dialog-app.mjs";
import { ClasspackTeleport } from "./teleport.mjs";

/* -------------------------------------------------------------------------- *
 *  Local API + socket functions
 * -------------------------------------------------------------------------- */

const socketFunctions = {
  /**
   * Open a dialog on the executing client. Args are forwarded to
   * ClasspackDialogApp.dialog and the dialog result is returned to the caller.
   */
  dialog: async (...args) => ClasspackDialogApp.dialog(...args),

  /**
   * Set targets for the local canvas. `tokens` is an array of token ids (or
   * objects exposing `.id`).
   */
  updateTargets: async function (tokens) {
    const list = Array.isArray(tokens) || tokens instanceof Set ? tokens : [tokens];
    const ids = Array.from(list).map(token => token?.id ?? token);
    canvas.tokens?.setTargets(ids);
  },

  /**
   * Apply already-computed token position updates. Used when the crosshair UI
   * runs on a player client but the player lacks permission to move the tokens.
   * `updates` is an array of TokenDocument update objects.
   */
  teleportUpdate: async function (updates) {
    if (!updates?.length) return;
    await canvas.scene.updateEmbeddedDocuments("Token", updates, { isPaste: true });
  },

  /**
   * Apply already-computed push/pull token updates. `updates` is an array of
   * TokenDocument update objects.
   */
  pushUpdate: async function (updates) {
    if (!updates?.length) return;
    await canvas.scene.updateEmbeddedDocuments("Token", updates, { isPaste: true });
  },

  /**
   * Teleport one or more tokens to a freely chosen point on the executing
   * client. `tokens` is an array of TokenDocument UUIDs.
   */
  teleportPoint: async function (tokenUuids, options = {}) {
    const tokens = [];
    const list = Array.isArray(tokenUuids) ? tokenUuids : [tokenUuids];
    for (const uuid of list) {
      const token = await resolveToken(uuid);
      if (token) tokens.push(token);
    }
    if (!tokens.length) return;

    await ClasspackTeleport.point(tokens, options);
  },

  /**
   * Teleport tokens to a destination token, using crosshairs on the executing
   * client. `tokens` is an array of TokenDocument UUIDs; `targetUuid` is the
   * UUID of the destination token.
   */
  teleport: async function (tokenUuids, targetUuid, options = {}) {
    const tokens = [];
    const list = Array.isArray(tokenUuids) ? tokenUuids : [tokenUuids];
    for (const uuid of list) {
      const token = await resolveToken(uuid);
      if (token) tokens.push(token);
    }
    if (!tokens.length) return;

    const target = await resolveToken(targetUuid);
    if (!target) return;

    if (tokens.length > 1) await ClasspackTeleport.group(tokens, target, options);
    else await ClasspackTeleport.target(tokens[0], target, options);
  }
};

export { socketFunctions };
