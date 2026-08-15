/**
 * ClassPack API helpers.
 */

export const MODULE_ID = "dnd5e_classpack";
export const SOCKET_NAME = "dnd5e_classpack";

export function log(level, ...args) {
  console[level]?.(`[${MODULE_ID}]`, ...args);
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function mergeMultiple(...sources) {
  return sources.reduce((acc, source) => {
    return foundry.utils.mergeObject(acc, source ?? {});
  }, {});
}

export function localize(key, fallback = key) {
  const value = game.i18n.localize(key);
  return value === key ? fallback : value;
}

/**
 * Register the small set of Handlebars helpers the dialog template needs.
 * Foundry registers these in most versions, but ensure they exist without
 * clobbering an existing helper.
 */
export function registerHandlebarsHelpers() {
  const helpers = {
    gte: (a, b) => a >= b,
    gt: (a, b) => a > b,
    eq: (a, b) => a === b
  };
  for (const [name, fn] of Object.entries(helpers)) {
    if (!Handlebars.helpers[name]) Handlebars.registerHelper(name, fn);
  }
}

/**
 * Resolve a token-like value to a Token placeable. Accepts TokenDocuments,
 * Token placeables, canvas token ids, or UUID strings.
 */
export async function resolveToken(tokenish) {
  if (tokenish?.documentName === "Token") return tokenish.object;
  if (tokenish?.document?.documentName === "Token") return tokenish;
  if (typeof tokenish === "string") {
    const onCanvas = canvas.tokens?.get(tokenish);
    if (onCanvas) return onCanvas;
    return (await fromUuid(tokenish))?.object;
  }
  return tokenish;
}
