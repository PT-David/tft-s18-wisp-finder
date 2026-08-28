import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { WispDataset } from '../src/domain/types';
import { buildCandidatePool } from '../src/filter/candidates';
import { criteriaFromUI, finiteOptionalNumber, parseStagePoint, validationMessage, type QueryUIState } from '../src/ui/queryState';

const wisps = (JSON.parse(readFileSync('data/wisps_18.1.json', 'utf8')) as WispDataset).records;
const state = (changes: Partial<QueryUIState> = {}): QueryUIState => ({
  query: '', exactStage: '', rangeStart: '', rangeEnd: '', gold: '', affordableOnly: true, categories: new Set(), prismaticOnly: false,
  effectMode: 'normal', probabilityMode: false, slot: 'ordinary', minCost: '', maxCost: '', referenceId: '', excluded: new Set(), patch: '18.1', ...changes,
});

describe('UI 状态显式转换', () => {
  test('affordableOnly 保持 boolean，3 金可切换 Field of Mice', () => {
    expect(buildCandidatePool(wisps, criteriaFromUI(state({ gold: '3', affordableOnly: true }), wisps)).some(({ id }) => id === 'field_of_mice')).toBe(false);
    expect(buildCandidatePool(wisps, criteriaFromUI(state({ gold: '3', affordableOnly: false }), wisps)).some(({ id }) => id === 'field_of_mice')).toBe(true);
  });
  test('无效阶段与非有限数字不会进入 criteria', () => {
    expect(parseStagePoint('4-x')).toBeUndefined();
    expect(finiteOptionalNumber('Infinity')).toBeUndefined();
    expect(criteriaFromUI(state({ exactStage: 'bad', gold: 'Infinity' }), wisps)).toMatchObject({ stage: undefined, currentGold: undefined });
  });
  test('售价和范围反向时提供紧凑错误提示', () => {
    expect(validationMessage(state({ minCost: '9', maxCost: '2' }))).toContain('最低售价');
    expect(validationMessage(state({ rangeStart: '5-2', rangeEnd: '4-1' }))).toContain('阶段范围');
  });
  test('reference 只从当前 patch 查找', () => {
    const reference = wisps[0]!;
    const crossPatch = { ...reference, patch: '18.2' as never };
    const criteria = criteriaFromUI(state({ referenceId: reference.id, patch: '18.2' }), [reference, crossPatch]);
    expect(criteria.referenceRanges).toBe(crossPatch.stageRanges);
  });
});
