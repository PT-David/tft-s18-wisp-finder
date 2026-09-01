import { knownValue, type FieldSource, type Wisp } from '../domain/types';
import type { StageFiveSlot } from '../probability/equalWeight';

export type EffectMode = 'normal' | 'blossom' | 'prismatic';
export const CATEGORY_LABELS: Record<Wisp['category'], string> = {
  champion: '英雄', combat: '战斗', misc: '杂项', shop: '商店', gold_xp: '金币 / 经验', risky: '风险', item: '装备',
};
export const EFFECT_LABELS: Record<EffectMode, string> = { normal: '普通', blossom: 'Blossom', prismatic: 'Prismatic' };

export interface WispCardViewModel {
  id: string; nameZh: string; nameEn: string; category: Wisp['category']; categoryLabel: string; cost: number;
  stageText: string; requirements: string[]; hasBlossom: boolean; hasPrismatic: boolean;
  normal: string; blossom?: string; prismatic?: string; oncePerGame: boolean; cooldown?: number; sources: FieldSource[];
}

export const formatStageRangeList = (wisp: Wisp): string[] => wisp.stageRanges
  .map(({ start, end }) => `${start.stage}-${start.round} ～ ${end.stage}-${end.round}`);

export const formatStageRanges = (wisp: Wisp): string => formatStageRangeList(wisp).join(' · ');

export function toCardViewModel(wisp: Wisp): WispCardViewModel {
  return {
    id: wisp.id, nameZh: wisp.nameZh, nameEn: wisp.nameEn, category: wisp.category, categoryLabel: CATEGORY_LABELS[wisp.category], cost: wisp.cost,
    stageText: formatStageRanges(wisp),
    requirements: wisp.requirements.map((item) => item.textZh), hasBlossom: Boolean(wisp.effects.blossom), hasPrismatic: Boolean(wisp.effects.prismatic),
    normal: wisp.effects.normal, blossom: wisp.effects.blossom || undefined, prismatic: wisp.effects.prismatic || undefined,
    oncePerGame: knownValue(wisp.oncePerGame) === true, cooldown: knownValue(wisp.reofferCooldownShops) ?? undefined, sources: Object.values(wisp.sources),
  };
}

export const slotLabel = (slot: StageFiveSlot): string => ({ ordinary: '普通位', forced_combat: '强制 Combat 位', uncertain: '不确定' })[slot];
