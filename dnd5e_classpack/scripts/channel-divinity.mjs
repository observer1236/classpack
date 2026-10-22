import { canonicalUuid } from "./content-sources/policy.mjs";

const RESOURCE = "Compendium.dnd5e_classpack.class-abilityphb.Item.v8z4Z2NuBAbYnjxk";
const IDENTIFIER = "channel-divinity";
const source = item => canonicalUuid(item.flags?.dnd5e?.sourceId ?? item._stats?.compendiumSource);
const advancements = item => Object.values(item.system?.advancement ?? {});

function grants(item) {
  if (item.type !== "class" || !["cleric", "paladin"].includes(item.system?.identifier)
    || item.system.source?.rules === "2024") return [];
  return advancements(item).filter(a => a.type === "ItemGrant"
    && a.configuration.items?.some(i => canonicalUuid(i.uuid) === RESOURCE));
}

function isResource(item) {
  return item.type === "feat" && item.system?.source?.rules !== "2024"
    && (source(item) === RESOURCE || item.system?.identifier === IDENTIFIER);
}

/** Each class contributes its own progression; multiclass levels and uses are not added. */
export function channelDivinityMaximum(items) {
  let maximum = 0;
  for (const item of items) {
    if (!grants(item).length) continue;
    const level = Number(item.system.levels ?? 0);
    const scales = advancements(item).filter(a => a.type === "ScaleValue"
      && a.configuration.identifier === IDENTIFIER);
    // Older ClassPack actor copies may predate the scale advancement.
    if (!scales.length) {
      const value = item.system.identifier === "cleric"
        ? level >= 18 ? 3 : level >= 6 ? 2 : level >= 2 ? 1 : 0 : level >= 3 ? 1 : 0;
      maximum = Math.max(maximum, value);
    }
    for (const scale of scales) {
      const entry = Object.entries(scale.configuration.scale ?? {})
        .filter(([at]) => Number(at) <= level).sort(([a], [b]) => Number(b) - Number(a))[0];
      maximum = Math.max(maximum, Number(entry?.[1]?.value ?? 0));
    }
  }
  return maximum;
}

/** Operate on the advancement manager's pending transaction, never on world actors directly. */
export function reconcileChannelDivinity(manager, _updates, toCreate, toUpdate, toDelete) {
  const original = Array.from(manager.actor.items, item => item.toObject());
  const pending = [...toCreate, ...toUpdate];
  if (![...original, ...pending].some(item => grants(item).length)) return;
  const pools = pending.filter(isResource), previous = original.filter(isResource);
  const maximum = channelDivinityMaximum(pending);
  const ids = new Set([...pools, ...previous].map(item => item._id));
  const remove = (array, predicate) => {
    for (let i = array.length - 1; i >= 0; i--) if (predicate(array[i])) array.splice(i, 1);
  };
  if (!maximum) {
    remove(toCreate, isResource); remove(toUpdate, isResource);
    for (const item of previous) if (!toDelete.includes(item._id)) toDelete.push(item._id);
    return;
  }

  // Prefer an existing item so its ID, manual edits, favourites and spent uses survive.
  const existing = previous.find(item => pools.some(pool => pool._id === item._id)) ?? previous[0];
  const preferred = pools.find(item => item._id === existing?._id) ?? existing ?? pools[0];
  if (!preferred) return; // Respect a deliberately skipped ItemGrant; do not synthesize a new feature.
  const keeper = preferred._id;
  const pool = foundry.utils.deepClone(preferred);
  const spent = items => items.reduce((sum, item) => sum + Number(item.system.uses?.spent ?? 0), 0);
  pool.system.identifier = IDENTIFIER;
  pool.system.uses = { ...pool.system.uses, max: String(maximum),
    spent: Math.max(spent(previous), spent(pools)),
    recovery: [{ period: "sr", type: "recoverAll" }] };

  const owners = [];
  for (const item of pending) {
    for (const grant of grants(item)) {
      const added = { ...grant.value?.added };
      let removed = false;
      for (const [id, uuid] of Object.entries(added)) {
        if (ids.has(id) || canonicalUuid(uuid) === RESOURCE) { delete added[id]; removed = true; }
      }
      if (Number(item.system.levels ?? 0) >= Number(grant.level)) {
        grant.value ??= {};
        grant.value.added = { ...added, [keeper]: RESOURCE };
        owners.push({ item, grant });
      } else if (removed) {
        if (Object.keys(added).length) grant.value.added = added;
        else delete grant.value.added;
      }
    }
    // Existing activities can already refer to a duplicate's actor Item ID.
    for (const activity of Object.values(item.system?.activities ?? {})) {
      for (const target of activity.consumption?.targets ?? []) {
        if (target.type === "itemUses" && ids.has(target.target)) target.target = keeper;
      }
    }
  }
  const owner = owners.find(({ item, grant }) =>
    `${item._id}.${grant._id}` === pool.flags?.dnd5e?.advancementOrigin) ?? owners[0];
  pool.flags ??= {}; pool.flags.dnd5e ??= {};
  pool.flags.dnd5e.sourceId = RESOURCE;
  if (owner) {
    const origin = `${owner.item._id}.${owner.grant._id}`;
    pool.flags.dnd5e.advancementOrigin = origin;
    pool.flags.dnd5e.advancementRoot = owner.item.flags?.dnd5e?.advancementRoot ?? origin;
  }
  remove(toCreate, isResource); remove(toUpdate, isResource);
  remove(toDelete, id => id === keeper);
  for (const item of previous) {
    if (item._id !== keeper && !toDelete.includes(item._id)) toDelete.push(item._id);
  }
  (original.some(item => item._id === keeper) ? toUpdate : toCreate).push(pool);
}

export function registerChannelDivinity() {
  Hooks.on("dnd5e.preAdvancementManagerComplete", reconcileChannelDivinity);
}
