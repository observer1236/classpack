/**
 * Socket-backed functions.
 */

import { resolveToken } from "./utils.mjs";
import { ClasspackTeleport } from "./teleport.mjs";

/* -------------------------------------------------------------------------- *
 *  Local API + socket functions
 * -------------------------------------------------------------------------- */

const socketFunctions = {
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
