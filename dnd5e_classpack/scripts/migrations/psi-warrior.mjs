import {equal} from "./patches.mjs";
import {canonical, source, standardFlags, usesAsSource, favoritesUpdate, actorsForFeatureMigration} from "./feature-variants.mjs";

const MODULE_ID = "dnd5e_classpack";
const SETTING = "psiWarriorActivitiesMigrated";
const FEATURE = "Compendium.dnd5e_classpack.extra-ability.Item.";
const SUBCLASS = "Compendium.dnd5e_classpack.subclass.Item.NOdNl8paEppqJs10";
const TELEKINESIS = "Compendium.dnd5e_classpack.spell.Item.MTNfEcCXSJZ2m2nG";
const DEFAULT_ACTIVITY = "dnd5eactivity000";

const pairs = [
  {free: "w6wzRcoxxL5rrnxe", paid: "siAeTtoqnGz0fsI5", paidAction: "siAeTtoqnGz0fsI5"},
  {free: "6s7P6OwuQlVpfnDQ", paid: "X45yHNAw6pvDmWji", paidAction: "X45yHNAw6pvDmWji",
    freeEffect: "eHWOR58SGOvxnUtv", paidEffect: "O8TSIPlwPEtP31dO"},
  {free: "2dqkKB0KNItEKuCk", paid: "vZXnOtXH7hJT4seL", paidAction: "vZXnOtXH7hJT4seL"},
  {free: "P7AyHQ1wqI7fLw1B", paid: "PjbFvDngvjDQjezs", freeAction: "Y6d5Do176hlWqj2m", paidAction: "wPyZ97Gzl5cOENfa",
    oldPaidAction: "wPyZ97Gzl5cOENfa"}
];
const retiredGrants = new Set(pairs.map(pair => FEATURE + pair.paid));

function grantUpdates(item, merged = []) {
  if (item.type !== "subclass" || source(item) !== SUBCLASS) return {};
  const updates = {};
  for (const [id, grant] of Object.entries(item.toObject(true).system.advancement ?? {})) {
    if (grant.type !== "ItemGrant") continue;
    const prefix = "system.advancement." + id;
    const items = grant.configuration.items ?? [];
    const filtered = items.filter(entry => {
      const uuid = canonical(entry.uuid);
      return !retiredGrants.has(uuid) && !(grant.level === 18 && uuid === TELEKINESIS);
    });
    if (items.length !== filtered.length) updates[prefix + ".configuration.items"] = filtered;
    const added = grant.value?.added ?? {};
    for (const {entry, destination, paid} of merged) {
      if (canonical(added[paid]) !== FEATURE + entry.paid) continue;
      if (paid !== destination) updates[prefix + ".value.added.-=" + paid] = null;
      updates[prefix + ".value.added." + destination] = FEATURE + entry.free;
    }
  }
  return updates;
}

function effectRules(effect) {
  return {
    changes: effect.system.changes.map(({_id, ...change}) => change),
    duration: effect.duration,
    statuses: effect.statuses
  };
}

function prepareMerge(actor, entry, free, paid, template) {
  const current = (free ?? paid).toObject(true);
  const previousPaidAction = entry.oldPaidAction ?? DEFAULT_ACTIVITY;
  const freeAction = entry.freeAction ?? DEFAULT_ACTIVITY;
  const activities = current.system.activities;
  const previousPaid = paid?.toObject(true);
  const desired = template.system.activities;
  const converted = !free && activities[freeAction] && activities[entry.paidAction];
  const existingPaid = (free || converted) && activities[entry.paidAction];
  const oldPaid = existingPaid ?? previousPaid?.system.activities[previousPaidAction];
  const effects = current.effects;
  const duplicates = free && paid && free.id !== paid.id;
  const targetEffect = free ? entry.freeEffect : entry.paidEffect;
  const oldFlight = previousPaid?.effects.find(effect => effect._id === entry.paidEffect);
  const sharedFlight = effects.find(effect => effect._id === targetEffect);

  if (paid && (!oldPaid || oldPaid.type !== desired[entry.paidAction].type)) return "旧消耗行动已自定义";
  if (duplicates && (usesAsSource(actor, paid) || previousPaid.system.uses.max || Object.keys(previousPaid.system.activities).length !== 1
    || previousPaid.effects.length !== Number(Boolean(entry.paidEffect))
    || !equal(standardFlags(current), standardFlags(previousPaid))
    || previousPaid.system.description?.value !== template.system.description?.value
    || previousPaid.system.description?.chat !== template.system.description?.chat
    || (entry.paidEffect && (!oldFlight || !sharedFlight || !equal(effectRules(oldFlight), effectRules(sharedFlight)))))) {
    return "旧消耗版有自定义数据或仍被角色效应引用";
  }
  if (entry.freeEffect && !sharedFlight) return "原飞行效应缺失";
  if (free && activities[freeAction]?.type !== desired[freeAction].type) return "旧免费行动已自定义";

  const updated = {};
  const migratedFree = structuredClone(free || converted ? activities[freeAction] : desired[freeAction]);
  migratedFree.name ||= desired[freeAction].name;
  migratedFree.consumption.spellSlot = false;
  if (entry.free === "2dqkKB0KNItEKuCk") {
    const targets = migratedFree.consumption.targets;
    if (targets.length === 2 && targets.every(target => target.type === "itemUses" && !target.target && target.value === "1")) {
      migratedFree.consumption.targets = targets.slice(0, 1);
    }
  }
  if (entry.freeEffect && !free) {
    migratedFree.effects = migratedFree.effects.map(effect => ({...effect, _id: targetEffect}));
  }
  if (migratedFree.type === "cast") migratedFree.spell.ability ||= "int";

  const migratedPaid = existingPaid ?? structuredClone(oldPaid ?? desired[entry.paidAction]);
  if (!existingPaid) {
    migratedPaid._id = entry.paidAction;
    migratedPaid.name ||= desired[entry.paidAction].name;
    migratedPaid.consumption.spellSlot = false;
    if (entry.paidEffect && paid) {
      migratedPaid.effects = migratedPaid.effects.map(effect => effect._id === entry.paidEffect
        ? {...effect, _id: targetEffect} : effect);
    }
    if (migratedPaid.type === "cast") {
      migratedPaid.spell.ability ||= "int";
      migratedPaid.spell.spellbook = false;
    }
  }

  if (!equal(activities[freeAction], migratedFree)) updated["system.activities." + freeAction] = migratedFree;
  if (!equal(activities[entry.paidAction], migratedPaid)) updated["system.activities." + entry.paidAction] = migratedPaid;
  const name = current.name.replace(/\s*[(（](?:免费|消耗)[)）]\s*/g, " ").trim();
  if (name !== current.name) updated.name = name;
  if (!free && !converted) {
    // A paid-only copy has no free-use state to carry over. It recovers normally at the next rest.
    updated["system.uses"] = {...template.system.uses, spent: 1};
  }
  if ((!free || current.system.identifier === "telekinetic-master-free")
    && current.system.identifier !== template.system.identifier) {
    updated["system.identifier"] = template.system.identifier;
  }
  return updated;
}

function actorItems(actor) {
  return actor.items.contents.filter(item => item.type === "feat" || item.type === "subclass");
}

async function migrateActor(actor, templates, requireWriter, report) {
  const items = actorItems(actor);
  const merged = [];
  for (const entry of pairs) {
    const free = items.filter(item => source(item) === FEATURE + entry.free);
    const paid = items.filter(item => source(item) === FEATURE + entry.paid);
    if (!free.length && !paid.length) continue;
    const destination = free[0] ?? paid[0];
    const update = free.length > 1 || paid.length > 1 ? "同一来源有多份物品"
      : prepareMerge(actor, entry, free[0], paid[0], templates.get(entry.free));
    if (typeof update === "string") {
      report.skipped.push({actor: actor.uuid, item: destination.uuid, reason: update});
      continue;
    }
    if (Object.keys(update).length) {
      requireWriter();
      await destination.update(update);
      if (!destination.toObject(true).system.activities[entry.paidAction]) {
        throw new Error("消耗行动保存后缺失：" + destination.uuid);
      }
      report.updated++;
    }
    if (paid.length) merged.push({entry, destination: destination.id, paid: paid[0].id});
  }

  for (const item of items) {
    const update = grantUpdates(item, merged);
    if (!Object.keys(update).length) continue;
    requireWriter();
    await item.update(update);
    report.grants++;
  }
  const favorites = favoritesUpdate(actor, merged);
  if (favorites) {
    requireWriter();
    await actor.update({"system.favorites": favorites});
  }
  for (const {entry, destination, paid} of merged) {
    if (destination !== paid) continue;
    requireWriter();
    // Update provenance last so a retry can still find the former paid-only item.
    await actor.items.get(destination).update({"flags.dnd5e.sourceId": FEATURE + entry.free});
  }
  const obsolete = merged.filter(entry => entry.destination !== entry.paid).map(entry => entry.paid);
  if (obsolete.length) {
    requireWriter();
    await actor.deleteEmbeddedDocuments("Item", obsolete);
    if (obsolete.some(id => actor.items.has(id))) throw new Error("旧消耗版物品未删除：" + actor.uuid);
    report.removed += obsolete.length;
  }
}

export function registerPsiWarriorMigrationSetting() {
  game.settings.register(MODULE_ID, SETTING, {
    name: "灵能武士行动合并迁移标记", scope: "world", config: false, type: Boolean, default: false
  });
}

export function psiWarriorMigrationPending() {
  return !game.settings.get(MODULE_ID, SETTING);
}

let running = false;
export async function migratePsiWarriorOnReady() {
  if (!game.user?.isGM || Number(game.release?.generation) !== 14 || game.system?.id !== "dnd5e"
    || !/^6\.0\./.test(game.system.version) || running) return;
  const activeGM = () => game.users.activeGM ?? game.users.find(user => user.isGM && user.active);
  if (activeGM()?.id !== game.user.id || !psiWarriorMigrationPending()) return;
  const requireWriter = () => {
    if (activeGM()?.id !== game.user.id) throw new Error("当前 active GM 已改变");
  };

  running = true;
  const report = {updated: 0, removed: 0, grants: 0, skipped: []};
  try {
    const actors = actorsForFeatureMigration();
    const affected = actors.filter(actor => actorItems(actor).some(item => source(item) === SUBCLASS
      || pairs.some(entry => [FEATURE + entry.free, FEATURE + entry.paid].includes(source(item)))));
    const templates = new Map();
    if (affected.length) {
      for (const entry of pairs) {
        const item = await fromUuid(FEATURE + entry.free);
        const template = item?.toObject(true);
        if (!template?.system.activities[entry.paidAction]) throw new Error("找不到合并后的合集特性：" + entry.free);
        templates.set(entry.free, template);
      }
    }
    for (const actor of affected) await migrateActor(actor, templates, requireWriter, report);
    for (const item of game.items.contents) {
      const update = grantUpdates(item);
      if (!Object.keys(update).length) continue;
      requireWriter();
      await item.update(update);
      report.grants++;
    }

    requireWriter();
    await game.settings.set(MODULE_ID, SETTING, true);
    if (report.skipped.length) {
      console.warn("Classpack 灵能武士迁移：以下角色保留了需要人工核对的旧物品", report);
      ui.notifications.warn("灵能武士迁移有旧物品需要核对，详情见控制台。");
    } else console.info("Classpack 灵能武士迁移完成", report);
  } catch (error) {
    console.error("Classpack 灵能武士迁移中止，下次进世界会续跑", report, error);
    ui.notifications.error("灵能武士迁移中止，详情见控制台。");
    return {...report, error};
  } finally {
    running = false;
  }
  return report;
}
