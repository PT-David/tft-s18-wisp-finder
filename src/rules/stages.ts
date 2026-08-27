import type { StagePoint, StageRange } from '../domain/types';

export const compareStagePoints = (a: StagePoint, b: StagePoint): number =>
  a.stage === b.stage ? a.round - b.round : a.stage - b.stage;

export const rangeContains = (range: StageRange, point: StagePoint): boolean =>
  compareStagePoints(range.start, point) <= 0 && compareStagePoints(point, range.end) <= 0;

export const rangesOverlap = (a: StageRange, b: StageRange): boolean =>
  compareStagePoints(a.start, b.end) <= 0 && compareStagePoints(b.start, a.end) <= 0;

export const anyRangeContains = (ranges: readonly StageRange[], point: StagePoint): boolean =>
  ranges.some((range) => rangeContains(range, point));

export const anyRangesOverlap = (ranges: readonly StageRange[], query: StageRange): boolean =>
  ranges.some((range) => rangesOverlap(range, query));

export function remainingRanges(ranges: readonly StageRange[], current: StagePoint): StageRange[] {
  return ranges.flatMap((range) => {
    if (compareStagePoints(range.end, current) < 0) return [];
    return [{ start: compareStagePoints(range.start, current) < 0 ? current : range.start, end: range.end }];
  });
}
