import { knownValue, type Confidence, type FieldSource, type Wisp, type WispCategory } from '../domain/types';
import { compareStagePoints } from './stages';
import type { BlossomEffect, UnconfirmedRealModel, WispRuleDataset } from './types';
import { CATEGORY_LABELS, formatStageRangeList } from '../ui/viewModels';

export interface GeneralRuleView { id: string; title: string; text: string; confidence: Confidence }
export interface BlossomView { level: number; effect: BlossomEffect; label: string }
export interface WispRuleField<T> { value: T; confidence?: Confidence }
export interface WispRuleRow {
  id: string; nameZh: string; nameEn: string; category: WispCategory; categoryLabel: string; hasSpecialRules: boolean;
  stageRanges: WispRuleField<string[]>; requirements: WispRuleField<string[]>;
  oncePerGame?: WispRuleField<true>; reofferCooldownShops?: WispRuleField<number>;
  minimumAffordableGold?: number;
}
export interface RulesPageViewModel {
  patch: string; summary: { wispCount: number; categoryCount: number }; officialRules: GeneralRuleView[]; blossomMilestones: BlossomView[];
  observedRules: GeneralRuleView[]; unknownRules: GeneralRuleView[]; wisps: WispRuleRow[];
}

const blossomLabels: Record<BlossomEffect, string> = {
  upgraded_wisps: '仙灵升级', wisp_every_shop: '每个商店都有仙灵', gain_gold_after_purchase: '购买后返还或获得金币',
  two_purchases_per_round: '每回合可购买 2 个仙灵', prismatic_wisps: '仙灵获得 Prismatic 强化',
};
const unknownLabels: Record<UnconfirmedRealModel, string> = {
  category_then_wisp: '是否先抽取类型、再在类型内抽取仙灵',
  equal_weight_all_eligible: '真实游戏是否在所有合资格仙灵间完全等权',
  fixed_hidden_weight_per_wisp: '每个仙灵是否存在固定隐藏权重',
};
const confidenceFor = (sources: Record<string, FieldSource>, key: string): Confidence | undefined => sources[key]?.confidence;

export function buildRulesPageModel(rules: WispRuleDataset, wisps: readonly Wisp[], activePatch: string): RulesPageViewModel {
  if (rules.patch !== activePatch) throw new Error(`规则数据不可用：仙灵版本 ${activePatch} 与规则版本 ${rules.patch} 不一致`);
  if (wisps.some(({ patch }) => patch !== activePatch)) throw new Error(`规则索引包含非 ${activePatch} 版本仙灵`);
  const official: GeneralRuleView[] = [
    { id: 'categories', title: '官方类别', text: `${rules.official.categories.length} 类：${rules.official.categories.map(category => CATEGORY_LABELS[category]).join('、')}`, confidence: 'official' },
    { id: 'planning', title: '购买时机', text: rules.official.planningPhaseOnly ? '仅可在备战阶段购买' : '购买阶段未限定', confidence: 'official' },
    { id: 'shop-slot', title: '商店出现', text: `正常每 ${rules.official.wispShopInterval} 个商店出现一次${rules.official.rightmostShopSlot ? '，位于最右侧' : ''}`, confidence: 'official' },
    { id: 'purchases', title: '每回合购买', text: `普通情况下可购买 ${rules.official.defaultPurchasesPerRound} 个仙灵`, confidence: 'official' },
    { id: 'stage-five', title: `Stage ${rules.official.lateGameCombatGuarantee.startStage}+ Combat 保底`, text: `每 ${rules.official.lateGameCombatGuarantee.everyNthWisp} 个仙灵位中有一个保证为 Combat；普通位仍可能出现 Combat，并非 Combat / 非 Combat 严格交替。`, confidence: 'official' },
  ];
  const observed: GeneralRuleView[] = [
    { id: 'default-cooldown', title: '默认再次出现冷却', text: `同一具体仙灵常见约 ${rules.observedNotOfficial.defaultReofferCooldownShops} 个商店后才再次提供`, confidence: 'community_high_confidence' },
    { id: 'item-cooldown', title: 'Item 仙灵冷却', text: `特定 Item 仙灵可能约 ${rules.observedNotOfficial.itemWispReofferCooldownShops} 个商店`, confidence: 'community_high_confidence' },
    { id: 'heal-cooldown', title: '玩家治疗仙灵冷却', text: `恢复玩家生命的特定仙灵可能约 ${rules.observedNotOfficial.playerHealWispReofferCooldownShops} 个商店`, confidence: 'community_high_confidence' },
    { id: 'affordability', title: '可负担观察', text: '观察支持当前无法负担的仙灵可能不会被提供；完整公式并非官方确认，也未完整公开。', confidence: 'community_high_confidence' },
  ];
  const unknown: GeneralRuleView[] = [
    { id: 'model-boundary', title: 'V1 等权模型边界', text: '“当前合资格仙灵间等权”只是本工具的计算模型，不是对真实游戏刷新概率的声明。', confidence: 'unverified' },
    ...rules.probabilityModel.unconfirmedRealModels.map((model) => ({ id: model, title: '真实抽取机制', text: `${unknownLabels[model]}：尚未确认。`, confidence: 'unverified' as const })),
  ];
  const rows = wisps.map((wisp): WispRuleRow => {
    const once = knownValue(wisp.oncePerGame);
    const cooldown = knownValue(wisp.reofferCooldownShops);
    return {
      id: wisp.id, nameZh: wisp.nameZh, nameEn: wisp.nameEn, category: wisp.category, categoryLabel: CATEGORY_LABELS[wisp.category],
      hasSpecialRules: wisp.requirements.length > 0 || once === true || typeof cooldown === 'number' || wisp.minimumAffordableGold != null,
      stageRanges: { value: formatStageRangeList(wisp), confidence: confidenceFor(wisp.sources, 'stageRanges') },
      requirements: { value: wisp.requirements.map(({ textZh }) => textZh), confidence: confidenceFor(wisp.sources, 'requirements') },
      ...(once === true ? { oncePerGame: { value: true as const, confidence: confidenceFor(wisp.sources, 'oncePerGame') } } : {}),
      ...(typeof cooldown === 'number' ? { reofferCooldownShops: { value: cooldown, confidence: confidenceFor(wisp.sources, 'reofferCooldownShops') } } : {}),
      ...(wisp.minimumAffordableGold != null ? { minimumAffordableGold: wisp.minimumAffordableGold } : {}),
    };
  }).sort((a, b) => {
    const wa = wisps.find(({ id }) => id === a.id)!; const wb = wisps.find(({ id }) => id === b.id)!;
    return compareStagePoints(wa.stageRanges[0]!.start, wb.stageRanges[0]!.start) || a.nameZh.localeCompare(b.nameZh, 'zh-CN') || a.id.localeCompare(b.id);
  });
  return { patch: rules.patch, summary: { wispCount: rows.length, categoryCount: rules.official.categories.length }, officialRules: official, blossomMilestones: Object.entries(rules.official.blossom).map(([level, effect]) => ({ level: Number(level), effect, label: blossomLabels[effect] })).sort((a, b) => a.level - b.level), observedRules: observed, unknownRules: unknown, wisps: rows };
}
