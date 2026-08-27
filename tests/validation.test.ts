import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { validateDataset } from '../scripts/validation';

const valid = JSON.parse(readFileSync('data/wisps_18.1.json', 'utf8')) as { records: Record<string, unknown>[] };
const mutate = (fn: (copy: typeof valid) => void) => { const copy = structuredClone(valid); fn(copy); return validateDataset(copy); };

describe('数据验证器', () => {
  test('种子通过', () => expect(validateDataset(valid)).toEqual([]));
  test.each([
    ['重复 ID', (d: typeof valid) => { d.records[1]!.id = d.records[0]!.id; }, '重复 ID'],
    ['非法 category', (d: typeof valid) => { d.records[0]!.category = 'magic'; }, '非法类别'],
    ['非法 stage range', (d: typeof valid) => { d.records[0]!.stageRanges = [{ start: { stage: 4, round: 2 }, end: { stage: 3, round: 1 } }]; }, 'start 不得晚于 end'],
    ['负数 cost', (d: typeof valid) => { d.records[0]!.cost = -1; }, '非负有限数'],
    ['normal 为空', (d: typeof valid) => { (d.records[0]!.effects as Record<string, unknown>).normal = ' '; }, 'effects.normal'],
    ['来源缺失', (d: typeof valid) => { delete d.records[0]!.sources; }, '缺失来源元数据'],
    ['非对象 record', (d: typeof valid) => { d.records[0] = null as unknown as Record<string, unknown>; }, 'records[0]: 必须是对象'],
    ['非法 blossom', (d: typeof valid) => { (d.records[0]!.effects as Record<string, unknown>).blossom = 3; }, 'effects.blossom'],
    ['非法 searchConcepts 成员', (d: typeof valid) => { d.records[0]!.searchConcepts = ['valid', 3]; }, 'searchConcepts: 必须是 string[]'],
    ['非法 synonyms 成员', (d: typeof valid) => { d.records[0]!.synonyms = [false]; }, 'synonyms: 必须是 string[]'],
    ['无限 minimumAffordableGold', (d: typeof valid) => { d.records[0]!.minimumAffordableGold = Infinity; }, '非负有限数'],
    ['非法 cooldown', (d: typeof valid) => { d.records[0]!.reofferCooldownShops = 1.5; }, '非负整数'],
    ['非法 Requirement 项目', (d: typeof valid) => { d.records[0]!.requirements = [null]; }, 'requirements[0]: 必须是对象'],
    ['数值操作符缺少 value', (d: typeof valid) => { d.records[0]!.requirements = [{ type: 'gold', operator: '>=', textZh: '金币', machineEvaluable: true }]; }, '>= 操作符需要有限数值'],
    ['in 操作符 value 类型非法', (d: typeof valid) => { d.records[0]!.requirements = [{ type: 'mode', operator: 'in', value: 'a', textZh: '模式', machineEvaluable: true }]; }, 'in 操作符需要非空 string[]'],
    ['active 操作符 value 类型非法', (d: typeof valid) => { d.records[0]!.requirements = [{ type: 'trait', operator: 'active', value: true, textZh: '羁绊', machineEvaluable: true }]; }, 'active 操作符需要非空字符串'],
  ])('%s', (_name, change, message) => expect(mutate(change).join('\n')).toContain(message));
});
