import type { StagePoint, StageRange, Wisp, WispCategory } from '../domain/types';
import type { CandidateCriteria } from '../filter/candidates';
import type { StageFiveSlot } from '../probability/equalWeight';
import type { EffectMode } from './viewModels';

export interface QueryUIState {
  query: string;
  exactStage: string;
  rangeStart: string;
  rangeEnd: string;
  gold: string;
  affordableOnly: boolean;
  categories: Set<WispCategory>;
  prismaticOnly: boolean;
  effectMode: EffectMode;
  probabilityMode: boolean;
  slot: StageFiveSlot;
  minCost: string;
  maxCost: string;
  referenceId: string;
  excluded: Set<string>;
  patch: string;
}

export const finiteOptionalNumber = (value: string): number | undefined => {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

export const parseStagePoint = (value: string): StagePoint | undefined => {
  const match = value.trim().match(/^(\d+)-(\d+)$/);
  if (!match) return undefined;
  const point = { stage: Number(match[1]), round: Number(match[2]) };
  return point.stage >= 1 && point.round >= 1 ? point : undefined;
};

// Set 18 uses seven planning/encounter positions per stage. Dataset range sentinels
// such as 10-1 remain valid; this parser is only for user-entered playable rounds.
export const PLAYABLE_ROUNDS_PER_STAGE = 7;
export const parsePlayableRound = (value: string): StagePoint | undefined => {
  const point = parseStagePoint(value);
  return point && point.round <= PLAYABLE_ROUNDS_PER_STAGE ? point : undefined;
};

export function rangeFromInputs(startValue: string, endValue: string): StageRange | undefined {
  const start = parsePlayableRound(startValue);
  const end = parsePlayableRound(endValue);
  if (!start || !end || start.stage > end.stage || (start.stage === end.stage && start.round > end.round)) return undefined;
  return { start, end };
}

export function criteriaFromUI(state: QueryUIState, wisps: readonly Wisp[]): CandidateCriteria {
  const exact = parsePlayableRound(state.exactStage);
  const reference = wisps.find(({ id, patch }) => id === state.referenceId && patch === state.patch);
  return {
    stage: exact,
    stageRange: exact ? undefined : rangeFromInputs(state.rangeStart, state.rangeEnd),
    currentGold: finiteOptionalNumber(state.gold),
    affordableOnly: state.affordableOnly,
    categories: [...state.categories],
    prismaticOnly: state.prismaticOnly,
    excludedIds: state.excluded,
    referenceRanges: reference?.stageRanges,
    referenceFrom: exact,
    minCost: finiteOptionalNumber(state.minCost),
    maxCost: finiteOptionalNumber(state.maxCost),
  };
}

export function validationMessage(state: QueryUIState): string {
  const min = finiteOptionalNumber(state.minCost);
  const max = finiteOptionalNumber(state.maxCost);
  if (min !== undefined && max !== undefined && min > max) return '最低售价不能高于最高售价。';
  for (const [label, value] of [['精确回合', state.exactStage], ['范围开始', state.rangeStart], ['范围结束', state.rangeEnd]] as const) {
    if (value.trim() && !parsePlayableRound(value)) return `${label}无效，请输入真实回合（如 4-7；每阶段为 1～7）。`;
  }
  const start = parsePlayableRound(state.rangeStart);
  const end = parsePlayableRound(state.rangeEnd);
  if (start && end && !rangeFromInputs(state.rangeStart, state.rangeEnd)) return '阶段范围开始不能晚于结束。';
  return '';
}
