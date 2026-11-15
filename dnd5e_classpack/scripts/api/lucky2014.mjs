import { MODULE_ID } from './utils.mjs';

/** Lucky contains only identity, eligibility and its extra-d20/cancellation rule. */
export function registerLucky2014(api) {
  const id = 'lucky2014', setting = 'lucky2014Automation', version = '2.0.0';
  api.automations.register({
    id, version, rules: '2014', itemTypes: ['feat'], itemKinds: ['feat'], legacyBinding: 'lucky2014',
    legacyEnabled: item => item.flags?.world?.lucky2014?.enabled === true,
    identifiers: ['lucky'], explicitIdentifiers: ['lucky-2014', 'lucky2014'],
    sourceUuids: ['Compendium.dnd5e_classpack.feats-all.Item.Zxh8VEiQwezfcnvk'], names: ['幸运', '幸运 Lucky', 'Lucky'],
    uses: { max: '3', recovery: [{ period: 'lr', type: 'recoverAll' }] }
  });
  const enabled = () => game.modules.get('midi-qol')?.active && game.settings.get(MODULE_ID, setting) === true;
  const selectionStrategy = (context, spender) => game.settings.get(MODULE_ID, 'lucky2014AutomaticSelection') === true
    ? (context.type === 'attack' && spender.actor.uuid !== context.actor.uuid ? 'lowest' : 'highest') : null;
  const failuresOnly = () => game.settings.get(MODULE_ID, 'lucky2014FailuresOnly') === true;
  api.rollInterventions.register({
    id, automationId: id, label: '幸运', enabled, cancelOnMultipleActors: true, selectionStrategy,
    types: ['attack', 'check', 'save', 'skill', 'tool', 'concentration', 'deathSave', 'initiative'],
    collect(context) {
      const actors = new Map([context.actor, ...(context.type === 'attack' ? context.targets : [])].map(actor => [actor.uuid, actor]));
      return [...actors.values()].flatMap(actor => {
        if (failuresOnly()) {
          if (context.type === 'attack') {
            const outcome = context.attackOutcome;
            if (!outcome || !(actor.uuid === context.actor.uuid
              ? outcome.missActorUuids.length : outcome.hitActorUuids.includes(actor.uuid))) return [];
          } else if (context.roll.isFailure !== true) return [];
        }
        const item = api.automations.find(actor, id);
        return item ? [{ actor, item, amount: 1 }] : [];
      });
    },
    async apply(context, { spenders }) {
      const extra = (await new Roll('1d20').evaluate({ allowInteractive: false })).total;
      const spender = spenders[0];
      const strategy = selectionStrategy(context, spender);
      if (strategy) return api.rolls.selectD20By(context.roll, { additionalResults: [extra], strategy });
      const result = await api.rolls.selectD20Dialog(context.roll, {
        additionalResults: [extra], user: spender.user, label: `幸运选骰 · ${spender.actor.name}`, reveal: spender.reveal
      });
      return result;
    },
    suppressLegacyChange(effect, change) {
      const item = effect.item ?? (effect.parent?.documentName === 'Item' ? effect.parent : null);
      if (!api.automations.match(item, id).matched) return false;
      return change.key?.startsWith('flags.midi-qol.optional.')
        || (change.key === 'flags.midi-qol.onUseMacroName' && /Lucky2014-OnUse/.test(String(change.value)));
    }
  });
  function registerSettings() {
    game.settings.register(MODULE_ID, setting, {
      name: '幸运专长（2014）自动化', hint: '自动匹配2014版幸运并在检定结算前询问和选骰。更改后刷新客户端。',
      scope: 'world', config: true, type: Boolean, default: true, requiresReload: true
    });
    game.settings.register(MODULE_ID, 'lucky2014AutomaticSelection', {
      name: '幸运自动选骰', hint: '自己的检定取高，受击时取低；关闭后手动选骰。',
      scope: 'world', config: true, type: Boolean, default: true
    });
    game.settings.register(MODULE_ID, 'lucky2014FailuresOnly', {
      name: '幸运仅在失败或被命中时触发',
      hint: '自己的攻击未命中、豁免或检定失败，或敌人的攻击命中自己时才询问。攻击使用 Midi 的命中判定；没有 DC 或尚未判定命中的掷骰不询问。关闭后恢复每次掷骰询问。',
      scope: 'world', config: true, type: Boolean, default: false
    });
  }
  let installed = false;
  const resolving = new WeakSet();
  function install() {
    if (installed) return false;
    Hooks.on('midi-qol.hitsChecked', async workflow => {
      if (!failuresOnly() || !enabled() || !api.rolls.installed || !api.rollInterventions.installed
        || workflow.readOnly || workflow.aborted || !workflow.attackRoll || resolving.has(workflow)
        || workflow.attackRoll.options.classpackInterventions?.[id]) return;
      // Midi 14.6.9 sets include undrawn targets through documents; older sets contain Tokens.
      const targets = Array.from(workflow.targets.documents ?? workflow.targets);
      const hit = target => workflow.hitTargets.has(target) || workflow.hitTargetsEC?.has(target);
      const context = { roll: workflow.attackRoll, actor: workflow.actor, workflow, activity: workflow.activity,
        targets: targets.map(target => target.actor).filter(Boolean), type: 'attack', providerIds: [id],
        attackOutcome: {
          hitActorUuids: targets.filter(hit).map(target => target.actor?.uuid).filter(Boolean),
          missActorUuids: targets.filter(target => !hit(target)).map(target => target.actor?.uuid).filter(Boolean)
        }, rollMode: workflow.attackRoll.options.rollMode ?? CONFIG.Dice.BasicRoll.getMessageMode(),
        label: `${workflow.actor.name}：${workflow.item?.name ?? '攻击'}` };
      resolving.add(workflow);
      try {
        const selected = await api.rollInterventions.beforePublish(context);
        if (!selected || workflow.aborted) return;
        await workflow.setAttackRoll(selected);
        if (selected.options.classpackInterventions?.[id]?.state === 'selected') {
          api.rolls.syncNaturalResults(workflow);
          await workflow.processAttackRoll();
          const options = workflow.workflowOptions;
          const hadReactionOption = Object.hasOwn(options, 'noProvokeReaction');
          const previous = options.noProvokeReaction;
          options.noProvokeReaction = true;
          try {
            workflow.hitTargetsEC = new Set();
            await workflow.checkHits();
          } finally {
            if (hadReactionOption) options.noProvokeReaction = previous;
            else delete options.noProvokeReaction;
          }
        }
        await workflow.displayAttackRoll();
      } finally {
        resolving.delete(workflow);
      }
    });
    installed = true;
    return true;
  }
  function prepareLegacyBridge() {
    if (!enabled()) return;
    if (globalThis.Lucky2014 && globalThis.Lucky2014.integration !== MODULE_ID) globalThis.Lucky2014.uninstall?.();
    globalThis.Lucky2014 = { version: '1.0.0', integration: MODULE_ID,
      prepare: api.rolls.prepare, candidates: api.rolls.d20Candidates,
      chooseDie: (roll, extra, selected) => api.rolls.selectD20(roll, { additionalResults: [extra], selected }) };
  }
  return Object.freeze({ version, registerSettings, prepareLegacyBridge, install,
    match: item => api.automations.match(item, id), findItem: actor => api.automations.find(actor, id),
    configure: (item, options) => api.automations.configure(item, id, options), remaining: api.resources.remaining,
    get installed() { return api.rolls.installed && api.rollInterventions.installed; },
    inspect(actor) {
      return { installed: api.rolls.installed, enabled: enabled(), items: Array.from(actor.items).map(item => ({
        uuid: item.uuid, name: item.name, ...api.automations.match(item, id), remaining: api.resources.remaining(item)
      })).filter(item => item.matched) };
    }
  });
}
