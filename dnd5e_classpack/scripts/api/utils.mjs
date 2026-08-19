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
  // Token placeable.
  if (tokenish?.document?.documentName === "Token") return tokenish;

  // TokenDocument: prefer its rendered placeable, but fall back to a canvas
  // token with the same id when the document has not been rendered yet.
  if (tokenish?.documentName === "Token") {
    return tokenish.object ?? canvas.tokens?.get(tokenish.id) ?? undefined;
  }

  if (typeof tokenish === "string") {
    const onCanvas = canvas.tokens?.get(tokenish);
    if (onCanvas) return onCanvas;

    const doc = await fromUuid(tokenish);
    if (doc?.documentName === "Token") {
      return doc.object ?? canvas.tokens?.get(doc.id) ?? undefined;
    }
    return doc?.object ?? undefined;
  }

  return tokenish;
}

/**
 * Normalize a user-ish value to a user id. Accepts a User document, a user id
 * string, or a user id embedded in an object.
 */
export function resolveUserId(value, fallback = game.user) {
  if (value === undefined || value === null) {
    return typeof fallback === "string" ? fallback : fallback?.id;
  }
  if (typeof value === "string") return value;
  return value?.id ?? value;
}

/**
 * Whether the local user can update the given token (or token document).
 */
export function canUpdateToken(tokenish) {
  const doc = tokenish?.document ?? tokenish;
  if (!doc) return false;
  if (game.user?.isGM) return true;

  try {
    if (typeof doc.testUserPermission === "function") {
      return doc.testUserPermission(game.user, "update");
    }
    if (typeof doc.canUserModify === "function") {
      return doc.canUserModify(game.user, "update");
    }
  } catch (err) {
    log("warn", "Could not determine token update permission:", err);
  }

  return doc.owner?.[game.user?.id] === "OWNER";
}

/**
 * Return a copy of `options` that is safe to send through a socket. User
 * document references and functions are not serialisable, so they are removed.
 */
export function toSocketSafeOptions(options = {}, targetUserId) {
  let copy;
  try {
    copy = JSON.parse(JSON.stringify(options));
  } catch (err) {
    copy = { ...options };
  }
  delete copy.user;
  if (targetUserId !== undefined) copy.userId = targetUserId;
  return copy;
}

/**
 * Resolve a reference point from a Token, MeasuredTemplate, UUID string, or a
 * plain `{x, y}` object. Tokens resolve to their centre; measured templates
 * resolve to their source point.
 */
export async function resolveOriginPoint(origin) {
  if (origin?.document?.documentName === "MeasuredTemplate") origin = origin.document;
  if (origin?.documentName === "MeasuredTemplate") return { x: origin.x, y: origin.y };

  if (origin?.center) return origin.center;

  if (origin?.documentName === "Token") {
    const token = origin.object ?? canvas.tokens?.get(origin.id);
    return token?.center ?? { x: origin.x, y: origin.y };
  }

  if (origin?.document?.documentName === "Token") return origin.center;

  if (typeof origin === "string") {
    const doc = await fromUuid(origin);
    if (doc?.documentName === "MeasuredTemplate") return { x: doc.x, y: doc.y };
    if (doc?.documentName === "Token") {
      const token = doc.object ?? canvas.tokens?.get(doc.id);
      return token?.center ?? { x: doc.x, y: doc.y };
    }
  }

  if (typeof origin?.x === "number" && typeof origin?.y === "number") return { x: origin.x, y: origin.y };

  log("warn", "resolveOriginPoint: could not resolve the reference origin to a point.");
  return undefined;
}

/**
 * Get the first active non-GM owner of a document, modelled after CPR's
 * firstOwner helper. Accepts Actor, TokenDocument, Token placeable, Item, or
 * ActiveEffect documents. Falls back to the active GM when no player owner is
 * found.
 *
 * @param {*} doc             Actor/Token/Item/ActiveEffect document or placeable
 * @param {boolean} [asId]    Return a user id instead of a User instance
 * @returns {*}               User instance or user id, or undefined
 */
export function firstOwner(doc, asId = false) {
  if (!doc) return undefined;

  // Normalise to an Actor document.
  if (doc?.document?.documentName === "Token") doc = doc.document.actor;
  if (doc?.documentName === "Token") doc = doc.actor;
  if (doc?.documentName === "Item" || doc?.documentName === "ActiveEffect") {
    doc = doc.actor ?? doc.parent;
  }
  if (!doc) return undefined;

  const ownership = foundry.utils.getProperty(doc, "ownership") ?? {};
  const ownerLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;

  const ownerIds = Object.entries(ownership)
    .filter(([userId, level]) => {
      const user = game.users?.get(userId);
      return user && !user.isGM && user.active && level === ownerLevel;
    })
    .map(([userId]) => userId);

  let ownerId;
  if (ownerIds.length) {
    ownerId = doc.documentName === "Actor"
      ? ownerIds.find(id => game.users.get(id)?.character?.uuid === doc.uuid) ?? ownerIds[0]
      : ownerIds[0];
  } else {
    ownerId = game.users?.activeGM?.id ?? game.users?.find(user => user.active && user.isGM)?.id;
  }

  if (!ownerId) return undefined;
  return asId ? ownerId : game.users.get(ownerId);
}
