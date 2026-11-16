import {equal} from "./patches.mjs";

const DEFAULT_ACTIVITY = "dnd5eactivity000";

export function canonical(uuid) {
  return typeof uuid === "string"
    ? uuid.replace(/^(Compendium\.dnd5e_classpack\.[\w-]+)\.(?=[A-Za-z0-9]{16}$)/, "$1.Item.")
    : undefined;
}


export function source(item) {
  return canonical(item.flags?.dnd5e?.sourceId ?? item._stats?.compendiumSource
    ?? item.flags?.core?.sourceId ?? item.flags?.["scene-packer"]?.sourceId);
}


export function standardFlags(item) {
  const {core, dnd5e, "scene-packer": scenePacker, ...flags} = item.flags ?? {};
  const {sourceId, advancementOrigin, advancementRoot, ...dnd5eFlags} = dnd5e ?? {};
  return {...flags, dnd5e: dnd5eFlags};
}


export function usesAsSource(actor, item) {
  const cached = actor.items.contents.filter(spell => {
    const owner = spell.flags?.dnd5e?.cachedFor;
    return owner?.startsWith(".Item." + item.id + ".") || owner?.startsWith(item.uuid + ".");
  });
  const sources = [item, ...cached];
  return actor.effects.contents.some(effect => {
    const data = effect.toObject(true);
    const origins = [data.origin, data.flags?.dnd5e?.dependentOn, data.flags?.dae?.itemUuid,
      ...Object.values(data.system?.origin ?? {})];
    return origins.some(origin => typeof origin === "string"
      && sources.some(source => origin === source.uuid || origin.startsWith(source.uuid + ".")));
  });
}


export function favoritesUpdate(actor, merged) {
  const favorites = actor.toObject(true).system.favorites;
  if (!favorites?.length || !merged.length) return;
  const updated = favorites.map(favorite => {
    for (const {entry, destination, paid} of merged) {
      const oldActivity = entry.oldPaidAction ?? DEFAULT_ACTIVITY;
      for (const prefix of [".Item.", actor.uuid + ".Item."]) {
        const original = prefix + paid;
        const replacement = prefix + destination;
        if (favorite.id === original + ".Activity." + oldActivity) {
          return {...favorite, id: replacement + ".Activity." + entry.paidAction};
        }
        if (favorite.id === original) return {...favorite, id: replacement};
      }
    }
    return favorite;
  });
  if (equal(updated, favorites)) return;
  const seen = new Set();
  return updated.filter(favorite => {
    const key = favorite.type + ":" + favorite.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


export function actorsForFeatureMigration() {
  const synthetics = game.scenes.contents.flatMap(scene => scene.tokens.contents
    .filter(token => !token.actorLink).map(token => token.actor).filter(actor => actor?.isToken));
  return [...new Map([...synthetics, ...game.actors.contents].map(actor => [actor.uuid, actor])).values()];
}
