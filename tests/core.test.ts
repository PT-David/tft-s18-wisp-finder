import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { WispDataset } from '../src/domain/types';
import { wispDataUrl } from '../src/data/wispRepository';
import { buildCandidatePool } from '../src/filter/candidates';
import { calculateEqualWeight, calculateStageFive, probabilityForWisp } from '../src/probability/equalWeight';
import { evaluateRequirement } from '../src/rules/requirements';

const dataset = JSON.parse(readFileSync('data/wisps_18.1.json', 'utf8')) as WispDataset;
const wisps = dataset.records;

test('数据 URL 遵循 Vite BASE_URL 子路径', () => {
  expect(wispDataUrl('/tft-s18-wisp-finder/')).toBe('/tft-s18-wisp-finder/data/wisps.json');
});

describe('阶段和候选池', () => {
  test('Petrify Shields 支持不连续窗口', () => {
    expect(buildCandidatePool(wisps, { stage: { stage: 4, round: 3 } }).some((w) => w.id === 'petrify_shields')).toBe(true);
    expect(buildCandidatePool(wisps, { stage: { stage: 5, round: 2 } }).some((w) => w.id === 'petrify_shields')).toBe(false);
    expect(buildCandidatePool(wisps, { stage: { stage: 6, round: 1 } }).some((w) => w.id === 'petrify_shields')).toBe(true);
  });
  test('Hero of Prophecy 保留结构化要求', () => {
    const hero = wisps.find((w) => w.id === 'hero_of_prophecy')!;
    expect(hero.requirements.map(({ type, operator, value }) => ({ type, operator, value }))).toEqual([
      { type: 'gold', operator: '>=', value: 35 }, { type: 'player_health', operator: '>=', value: 50 }, { type: 'level', operator: '>=', value: 10 },
    ]);
    expect(hero.oncePerGame).toBe(true);
  });
  test('3 金时 Field of Mice 不进入可负担池，但可关闭可负担过滤', () => {
    expect(buildCandidatePool(wisps, { currentGold: 3 }).some((w) => w.id === 'field_of_mice')).toBe(false);
    expect(buildCandidatePool(wisps, { currentGold: 3, affordableOnly: false }).some((w) => w.id === 'field_of_mice')).toBe(true);
  });
  test('类别、棱彩、条件和排除均可组合', () => {
    const result = buildCandidatePool(wisps, { categories: ['combat'], prismaticOnly: true, excludedIds: new Set(['downpour']) });
    expect(result.map((w) => w.id)).toEqual(['ultra_ascension']);
    expect(buildCandidatePool(wisps, { requirementState: { gold: 12 } }).some((w) => w.id === 'verdant_vitality')).toBe(false);
  });
  test('运行时无法判断的 Requirement 不会静默排除候选', () => {
    const unknown = { ...wisps[0]!, requirements: [{ type: 'gold', operator: '>=' as const, textZh: '损坏的运行时数据', machineEvaluable: true }] };
    expect(evaluateRequirement(unknown.requirements[0]!, { gold: 10 })).toBeUndefined();
    expect(buildCandidatePool([unknown], { requirementState: { gold: 10 } })).toEqual([unknown]);
  });
  test('参考仙灵只使用从当前回合开始的剩余窗口', () => {
    const referenceRanges = [
      { start: { stage: 2, round: 1 }, end: { stage: 2, round: 7 } },
      { start: { stage: 3, round: 5 }, end: { stage: 4, round: 7 } },
    ];
    const overlapping = { ...wisps[0]!, id: 'overlapping', stageRanges: [{ start: { stage: 4, round: 2 }, end: { stage: 4, round: 5 } }] };
    const pastOnly = { ...wisps[0]!, id: 'past', stageRanges: [{ start: { stage: 2, round: 2 }, end: { stage: 2, round: 5 } }] };
    const result = buildCandidatePool([overlapping, pastOnly], { referenceRanges, referenceFrom: { stage: 4, round: 3 } });
    expect(result.map((wisp) => wisp.id)).toEqual(['overlapping']);
  });
});

describe('理论等权概率', () => {
  const pool = Array.from({ length: 40 }, (_, index) => ({ ...wisps[0]!, id: `w${index}`, category: index < 10 ? 'combat' as const : 'misc' as const }));
  const targets = new Set(['w0', 'w1', 'w2', 'w3']);
  test('40 候选、4 目标为 10%，单个为 2.5%', () => expect(calculateEqualWeight(pool, targets)).toEqual({ poolSize: 40, targetCount: 4, targetProbability: .1, perWispProbability: .025 }));
  test('排除非目标后为 4/39', () => expect(calculateEqualWeight(pool.filter((w) => w.id !== 'w39'), targets).targetProbability).toBeCloseTo(4 / 39));
  test('排除目标后为 3/39', () => expect(calculateEqualWeight(pool.filter((w) => w.id !== 'w0'), targets).targetProbability).toBeCloseTo(3 / 39));
  test('Stage 5+ 强制 Combat 和不确定模式', () => {
    expect(probabilityForWisp(pool[20]!, pool, 'forced_combat')).toBe(0);
    expect(probabilityForWisp(pool[0]!, pool, 'forced_combat')).toBe(.1);
    const result = calculateStageFive(pool, targets, 'uncertain');
    expect(result).toHaveProperty('ordinary'); expect(result).toHaveProperty('forcedCombat');
    expect(result).not.toHaveProperty('blended');
  });
});
