import type { StagePoint, StageRange, Wisp, WispCategory } from '../domain/types';
import { anyRangeContains, anyRangesOverlap, rangesOverlap, remainingRanges } from '../rules/stages';
import { evaluateRequirement, type RequirementState } from '../rules/requirements';

export interface CandidateCriteria {
  stage?: StagePoint; stageRange?: StageRange; currentGold?: number; affordableOnly?: boolean;
  categories?: readonly WispCategory[]; prismaticOnly?: boolean; requirementState?: RequirementState;
  referenceRanges?: readonly StageRange[]; referenceFrom?: StagePoint; excludedIds?: ReadonlySet<string>;
  minCost?: number; maxCost?: number;
}

export const isAffordable = (wisp: Wisp, gold: number): boolean => gold >= (wisp.minimumAffordableGold ?? wisp.cost);

export function buildCandidatePool(wisps: readonly Wisp[], criteria: CandidateCriteria): Wisp[] {
  const requirementState: RequirementState | undefined = criteria.requirementState || criteria.currentGold !== undefined
    ? { gold: criteria.currentGold, ...criteria.requirementState }
    : undefined;
  return wisps.filter((wisp) => {
    if (criteria.excludedIds?.has(wisp.id)) return false;
    if (criteria.stage && !anyRangeContains(wisp.stageRanges, criteria.stage)) return false;
    if (criteria.stageRange && !anyRangesOverlap(wisp.stageRanges, criteria.stageRange)) return false;
    if (criteria.currentGold !== undefined && criteria.affordableOnly !== false && !isAffordable(wisp, criteria.currentGold)) return false;
    if (criteria.categories?.length && !criteria.categories.includes(wisp.category)) return false;
    if (criteria.prismaticOnly && !wisp.effects.prismatic) return false;
    if (criteria.minCost !== undefined && wisp.cost < criteria.minCost) return false;
    if (criteria.maxCost !== undefined && wisp.cost > criteria.maxCost) return false;
    if (requirementState && wisp.requirements.some((requirement) => evaluateRequirement(requirement, requirementState) === false)) return false;
    if (criteria.referenceRanges) {
      const windows = criteria.referenceFrom ? remainingRanges(criteria.referenceRanges, criteria.referenceFrom) : criteria.referenceRanges;
      if (!wisp.stageRanges.some((candidate) => windows.some((window) => rangesOverlap(candidate, window)))) return false;
    }
    return true;
  });
}

export const affordableCandidatePool = (wisps: readonly Wisp[], currentGold: number): Wisp[] =>
  buildCandidatePool(wisps, { currentGold, affordableOnly: true });
