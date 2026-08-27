import { expect, test } from 'vitest';
import { diffRecords } from '../scripts/diff-data';

test('diff 报告增删和具体字段', () => {
  const result = diffRecords([{ id: 'a', cost: 1 }, { id: 'gone', cost: 2 }], [{ id: 'a', cost: 3 }, { id: 'new', cost: 4 }]);
  expect(result.added).toEqual(['new']); expect(result.removed).toEqual(['gone']);
  expect(result.changed).toEqual(['a.cost: 1 -> 3']);
});
