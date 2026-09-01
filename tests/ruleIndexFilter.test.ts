import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import rulesJson from '../rules/wisp_rules_18.1.json';
import { filterRuleRows } from '../src/rules/filterRuleRows';
import { buildRulesPageModel, type WispRuleRow } from '../src/rules/rulePageModel';
import type { WispDataset } from '../src/domain/types';
import type { WispRuleDataset } from '../src/rules/types';

const dataset = JSON.parse(readFileSync('data/normalized/wisps_18.1.json', 'utf8')) as WispDataset;
const rows = buildRulesPageModel(rulesJson as WispRuleDataset, dataset.records, dataset.patch).wisps;
const filter = (overrides: Partial<Parameters<typeof filterRuleRows>[1]> = {}) => filterRuleRows(rows, { query: '', specialOnly: false, ...overrides });

describe('rule index name-only filtering', () => {
  test('matches direct partial Chinese and case-insensitive partial English names', () => {
    const petrify = rows.find(row => row.id === 'da_petrifyshields18')!;
    expect(filter({ query: petrify.nameZh.slice(0, 2) })).toContain(petrify);
    expect(filter({ query: 'pEtRiFy' })).toEqual([petrify]);
  });

  test('normalizes NFKC input without matching effects or requirements', () => {
    expect(filter({ query: 'ＰＥＴＲＩＦＹ' }).map(row => row.id)).toEqual(['da_petrifyshields18']);
    const prophecy = rows.find(row => row.id === 'da_heroofprophecy18')!;
    expect(filter({ query: prophecy.requirements.value[0] })).not.toContain(prophecy);
  });

  test('filters category and the exact special-rule definition', () => {
    const category = rows[0]!.category;
    expect(filter({ category }).every(row => row.category === category)).toBe(true);
    expect(filter({ specialOnly: true }).every(row => row.hasSpecialRules)).toBe(true);
    expect(filter({ specialOnly: true }).map(row => row.id)).toContain('da_heroofprophecy18');
  });

  test('combines name, category, and special-only with AND and can return empty', () => {
    const prophecy = rows.find(row => row.id === 'da_heroofprophecy18')!;
    expect(filter({ query: 'Hero', category: prophecy.category, specialOnly: true })).toContain(prophecy);
    const otherCategory = rows.find(row => row.category !== prophecy.category)!.category;
    expect(filter({ query: 'Hero', category: otherCategory, specialOnly: true })).toEqual([]);
    expect(filter({ query: '不存在的仙灵名称' })).toEqual([]);
  });

  test('does not mutate the source array or its row objects', () => {
    const snapshot = rows.map(row => ({ id: row.id, nameZh: row.nameZh, category: row.category, special: row.hasSpecialRules }));
    const result = filter({ query: 'hero', specialOnly: true });
    expect(rows.map(row => ({ id: row.id, nameZh: row.nameZh, category: row.category, special: row.hasSpecialRules }))).toEqual(snapshot);
    expect(result).not.toBe(rows);
  });

  test('special-only accepts each of the four supported metadata fields and nothing else', () => {
    const base = rows.find(row => !row.hasSpecialRules)!;
    const variants: WispRuleRow[] = [
      { ...base, id: 'requirement', requirements: { value: ['条件'] }, hasSpecialRules: true },
      { ...base, id: 'once', oncePerGame: { value: true }, hasSpecialRules: true },
      { ...base, id: 'cooldown', reofferCooldownShops: { value: 5 }, hasSpecialRules: true },
      { ...base, id: 'gold', minimumAffordableGold: 35, hasSpecialRules: true },
      { ...base, id: 'multiple-stages-only', stageRanges: { value: ['1-1 ～ 1-2', '2-1 ～ 2-2'] }, hasSpecialRules: false },
    ];
    expect(filterRuleRows(variants, { query: '', specialOnly: true }).map(row => row.id)).toEqual(['requirement', 'once', 'cooldown', 'gold']);
  });
});
