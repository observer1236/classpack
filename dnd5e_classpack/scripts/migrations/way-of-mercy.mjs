import {
  canonical, source, standardFlags, usesAsSource, favoritesUpdate, actorsForFeatureMigration
} from "./feature-variants.mjs";
import {equal} from "./patches.mjs";

const MODULE_ID = "dnd5e_classpack";
const SETTING = "mercyActivitiesMigrated";
const FEATURE = "Compendium.dnd5e_classpack.extra-ability.Item.";
const SUBCLASS = "Compendium.dnd5e_classpack.subclass.Item.UdiF2PfBvmVstQ08";
const HEAL = "R9VbDJOCQk2Mb9eG";
const HARM = "bolUalIQ1Ad2I6Mg";
const BASE = "dnd5eactivity000";
const POISON = "sUXOfKG8x4LINj9p";
const groups = [
  {keep: HEAL, retired: ["KIHR0JFVidGcgMQI"]},
  {keep: HARM, retired: ["AyjAUIpyI4sB2Smk", "OdxaUIHIeR9x3H6z"]}
];
const retiredSources = new Set(groups.flatMap(({retired}) => retired.map(id => FEATURE + id)));
const classpackSources = new Set([...retiredSources, FEATURE + HEAL, FEATURE + HARM, SUBCLASS]);

function grantUpdates(item, moves) {
  if (item.type !== "subclass" || source(item) !== SUBCLASS) return {};
  const updates = {};
  for (const [id, grant] of Object.entries(item.toObject(true).system.advancement ?? {})) {
    if (grant.type !== "ItemGrant") continue;
    const prefix = "system.advancement." + id;
    const items = grant.configuration.items ?? [];
    const filtered = items.filter(entry => !retiredSources.has(canonical(entry.uuid)));
    if (items.length !== filtered.length) updates[prefix + ".configuration.items"] = filtered;

    for (const {paid, entry} of moves) {
      if (canonical(grant.value?.added?.[paid]) === FEATURE + entry.paidAction) {
        updates[prefix + ".value.added.-=" + paid] = null;
      }
    }
  }
  return updates;
}

function mergeActivity(old, desired) {
  const activity = structuredClone(old ?? desired);
  activity._id = desired._id;
  activity.name ||= desired.name;
  activity.activation = {...activity.activation, ...desired.activation};
  activity.consumption = structuredClone(desired.consumption);
  activity.effects = structuredClone(desired.effects);
  activity.flags = {...activity.flags, ...desired.flags};
  if (desired.midiProperties?.chooseEffects) {
    activity.midiProperties ??= {};
    activity.midiProperties.chooseEffects = true;
  }
  return activity;
}

async function migrateActor(actor, templates, assertWriter, report) {
  const items = actor.items.contents;
  const moves = [];
  for (const group of groups) {
    const kept = items.filter(item => item.type === "feat" && source(item) === FEATURE + group.keep);
    const retired = group.retired.map(id => items.filter(item => item.type === "feat" && source(item) === FEATURE + id));
    if (!kept.length && !retired.some(items => items.length)) continue;
    const item = kept[0];
    if (kept.length !== 1 || retired.some(items => items.length > 1)) {
      report.skipped.push({actor: actor.uuid, item: item?.uuid ?? retired.flat()[0]?.uuid, reason: "原特性缺失或有多份"});
      continue;
    }

    const current = item.toObject(true);
    const template = templates.get(group.keep);
    const activities = current.system.activities;
    if (activities[BASE]?.type !== template.system.activities[BASE].type) {
      report.skipped.push({actor: actor.uuid, item: item.uuid, reason: "基础行动类型已自定义"});
      continue;
    }

    const updates = {}, groupMoves = [];
    let blocked = false;
    for (const [id, desired] of Object.entries(template.system.activities)) {
      const oldItem = retired[group.retired.indexOf(id)]?.[0];
      const old = oldItem?.toObject(true);
      const oldActivity = old?.system.activities[BASE];
      const poisonVariant = desired.effects.some(effect => effect._id === POISON) && id === group.retired[0]
        && group.keep === HARM;
      if (old && (Object.keys(old.system.activities).length !== 1 || oldActivity?.type !== desired.type
        || old.effects.length !== Number(poisonVariant) || (poisonVariant && old.effects[0]?._id !== POISON)
        || old.system.uses.max || !equal(standardFlags(current), standardFlags(old)) || usesAsSource(actor, oldItem))) {
        report.skipped.push({actor: actor.uuid, item: oldItem.uuid, reason: "变体有自定义数据或仍被效果引用"});
        blocked = true;
        break;
      }
      if (oldItem) groupMoves.push({entry: {paidAction: id}, destination: item.id, paid: oldItem.id});
      if (id !== BASE && activities[id]) continue;
      const action = mergeActivity(id === BASE ? activities[id] : oldActivity, desired);
      if (!equal(activities[id], action)) updates["system.activities." + id] = action;
    }

    if (blocked) continue;
    if (group.keep === HARM) {
      const marker = '<p><strong>6 级：生死之触。</strong>';
      if (!current.system.description.value.includes(marker)) {
        const description = template.system.description.value;
        updates["system.description.value"] = current.system.description.value + description.slice(description.indexOf(marker));
      }
      if (!item.effects.has(POISON)) {
        const desired = template.effects.find(effect => effect._id === POISON);
        const old = retired[0][0]?.toObject(true).effects[0];
        const effect = structuredClone(old ?? desired);
        const expiry = effect.duration;
        if (!old || (expiry.expiry === "turnStart" && expiry.value === 1 && expiry.units === "rounds")) {
          effect.duration = structuredClone(desired.duration);
        }
        effect.system.origin.item = item.uuid;
        assertWriter();
        await item.createEmbeddedDocuments("ActiveEffect", [effect], {keepId: true});
        if (!item.effects.has(POISON)) throw new Error("夺命之手中毒效应保存后缺失：" + item.uuid);
      }
      const uses = {...template.system.uses, spent: current.system.uses.spent ?? 0};
      if (!equal(current.system.uses, uses)) updates["system.uses"] = uses;
    }
    if (Object.keys(updates).length) {
      assertWriter();
      await item.update(updates);
      const saved = item.toObject(true).system.activities;
      if (Object.keys(updates).filter(key => key.startsWith("system.activities."))
        .some(key => !saved[key.split(".").at(-1)])) throw new Error("合并行动保存后缺失：" + item.uuid);
      report.updated++;
    }
    moves.push(...groupMoves);
  }

  for (const item of items) {
    const updates = grantUpdates(item, moves);
    if (!Object.keys(updates).length) continue;
    assertWriter();
    await item.update(updates);
  }

  const favorites = favoritesUpdate(actor, moves);
  if (favorites) {
    assertWriter();
    await actor.update({"system.favorites": favorites});
  }
  if (moves.length) {
    const ids = moves.map(move => move.paid);
    assertWriter();
    await actor.deleteEmbeddedDocuments("Item", ids);
    if (ids.some(id => actor.items.has(id))) throw new Error("命流宗旧变体未删除：" + actor.uuid);
    report.removed += ids.length;
  }
}

export function registerMercyActivities() {
  Hooks.on("dnd5e.preUseActivity", activity => {
    const minimum = activity.flags?.[MODULE_ID]?.mercyMonkLevel;
    if (!minimum || Number(activity.actor?.classes?.monk?.system.levels) >= minimum) return;
    ui.notifications.warn("此用法需要武僧等级 " + minimum + "。");
    return false;
  });
  game.settings.register(MODULE_ID, SETTING, {
    name: "命流宗行动合并迁移标记", scope: "world", config: false, type: Boolean, default: false
  });
}

export function mercyMigrationPending() {
  return !game.settings.get(MODULE_ID, SETTING);
}

let running = false;
export async function migrateMercyOnReady() {
  if (!game.user?.isGM || Number(game.release?.generation) !== 14 || game.system?.id !== "dnd5e"
    || !/^6\.0\./.test(game.system.version) || running) return;
  const activeGM = () => game.users.activeGM ?? game.users.find(user => user.isGM && user.active);
  if (activeGM()?.id !== game.user.id || !mercyMigrationPending()) return;
  const assertWriter = () => {
    if (activeGM()?.id !== game.user.id) throw new Error("当前 active GM 已改变");
  };
  running = true;
  const report = {updated: 0, removed: 0, skipped: []};
  try {
    const actors = actorsForFeatureMigration().filter(actor => actor.items.contents.some(item => classpackSources.has(source(item))));
    const templates = new Map();
    if (actors.length) {
      for (const {keep, retired} of groups) {
        const item = await fromUuid(FEATURE + keep);
        const template = item?.toObject(true);
        if (!template || !retired.every(id => template.system.activities[id])) {
          throw new Error("找不到合并后的命流宗特性：" + keep);
        }
        templates.set(keep, template);
      }
    }
    for (const actor of actors) await migrateActor(actor, templates, assertWriter, report);
    for (const item of game.items.contents) {
      const updates = grantUpdates(item, []);
      if (!Object.keys(updates).length) continue;
      assertWriter();
      await item.update(updates);
    }
    assertWriter();
    await game.settings.set(MODULE_ID, SETTING, true);
    if (report.skipped.length) {
      console.warn("Classpack 命流宗迁移：以下旧物品需要核对", report);
      ui.notifications.warn("命流宗迁移有旧物品需要核对，详情见控制台。");
    } else console.info("Classpack 命流宗迁移完成", report);
    return report;
  } catch (error) {
    console.error("Classpack 命流宗迁移中止，下次进世界会续跑", report, error);
    ui.notifications.error("命流宗迁移中止，详情见控制台。");
    return {...report, error};
  } finally {
    running = false;
  }
}
