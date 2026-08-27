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
  ])('%s', (_name, change, message) => expect(mutate(change).join('\n')).toContain(message));
});
