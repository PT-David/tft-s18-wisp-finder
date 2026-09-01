import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import rulesJson from '../rules/wisp_rules_18.1.json';
import { buildRulesPageModel } from '../src/rules/rulePageModel';
import type { WispRuleDataset } from '../src/rules/types';
import type { Wisp, WispDataset } from '../src/domain/types';

const dataset = JSON.parse(readFileSync('data/normalized/wisps_18.1.json', 'utf8')) as WispDataset;
const rules = rulesJson as WispRuleDataset;

describe('rules page model', () => {
  test('covers official, Blossom, observations, unknown mechanisms, and confidence', () => {
    const model = buildRulesPageModel(rules, dataset.records, dataset.patch);
    expect(model.officialRules.map(rule => rule.id)).toEqual(['categories', 'planning', 'shop-slot', 'purchases', 'stage-five']);
    expect(model.officialRules.every(rule => rule.confidence === 'official')).toBe(true);
    expect(model.blossomMilestones.map(item => item.level)).toEqual([3, 5, 7, 9, 11]);
    expect(model.blossomMilestones.every(item => !item.label.includes('_'))).toBe(true);
    expect(model.observedRules.map(rule => rule.text).join(' ')).toMatch(/5 个商店.*20 个商店.*10 个商店/);
    expect(model.observedRules.every(rule => rule.confidence === 'community_high_confidence')).toBe(true);
    expect(model.unknownRules).toHaveLength(4);
    expect(model.unknownRules.every(rule => rule.confidence === 'unverified')).toBe(true);
  });

  test('production index is exact, deterministic, and preserves reviewed per-field facts', () => {
    const model = buildRulesPageModel(rules, dataset.records, dataset.patch);
    expect(model.wisps).toHaveLength(169);
    expect(new Set(model.wisps.map(row => row.id))).toEqual(new Set(dataset.records.map(wisp => wisp.id)));
    expect(model.wisps.every(row => row.stageRanges.value.length > 0)).toBe(true);
    const petrify = model.wisps.find(row => row.id === 'da_petrifyshields18')!;
    expect(petrify.stageRanges.value).toEqual(['4-2 ～ 4-7', '6-1 ～ 10-1']);
    expect(petrify.oncePerGame).toBeUndefined();
    expect(petrify.reofferCooldownShops).toBeUndefined();
    const prophecy = model.wisps.find(row => row.id === 'da_heroofprophecy18')!;
    expect(prophecy.requirements.value).toEqual(['至少拥有35金币', '生命值高于50', '等级达到10级或以上']);
    expect(prophecy.oncePerGame?.value).toBe(true);
    expect(prophecy.requirements.confidence).toBe(dataset.records.find(wisp => wisp.id === prophecy.id)!.sources.requirements?.confidence);
  });

  test('Knowledge unknown/false/null stays absent and no general default is copied into rows', () => {
    const base = dataset.records[0]!;
    const fixtures: Wisp[] = [
      { ...base, id: 'unknown', requirements: [], oncePerGame: { status: 'unknown' }, reofferCooldownShops: { status: 'unknown' }, minimumAffordableGold: undefined },
      { ...base, id: 'false-null', requirements: [], oncePerGame: { status: 'confirmed', value: false }, reofferCooldownShops: { status: 'confirmed', value: null }, minimumAffordableGold: undefined },
      { ...base, id: 'minimum-null', requirements: [], oncePerGame: { status: 'unknown' }, reofferCooldownShops: { status: 'unknown' }, minimumAffordableGold: null },
      { ...base, id: 'requirements-special', requirements: [{ type: 'special', textZh: '第一项', machineEvaluable: false }], oncePerGame: { status: 'unknown' }, reofferCooldownShops: { status: 'unknown' }, minimumAffordableGold: undefined },
      { ...base, id: 'once-special', requirements: [], oncePerGame: { status: 'confirmed', value: true }, reofferCooldownShops: { status: 'unknown' }, minimumAffordableGold: undefined },
      { ...base, id: 'cooldown-special', requirements: [], oncePerGame: { status: 'unknown' }, reofferCooldownShops: { status: 'confirmed', value: 8 }, minimumAffordableGold: undefined },
      { ...base, id: 'minimum-special', requirements: [], oncePerGame: { status: 'unknown' }, reofferCooldownShops: { status: 'unknown' }, minimumAffordableGold: 35 },
    ];
    const rows = buildRulesPageModel(rules, fixtures, '18.1').wisps;
    const unknown = rows.find(row => row.id === 'unknown')!;
    const falseNull = rows.find(row => row.id === 'false-null')!;
    const minimumNull = rows.find(row => row.id === 'minimum-null')!;
    expect(unknown).not.toMatchObject({ oncePerGame: expect.anything(), reofferCooldownShops: expect.anything(), minimumAffordableGold: expect.anything() });
    expect(unknown.hasSpecialRules).toBe(false);
    expect(falseNull.oncePerGame).toBeUndefined();
    expect(falseNull.reofferCooldownShops).toBeUndefined();
    expect(falseNull.hasSpecialRules).toBe(false);
    expect(minimumNull.minimumAffordableGold).toBeUndefined();
    expect(minimumNull.hasSpecialRules).toBe(false);
    expect(rows.find(row => row.id === 'requirements-special')?.hasSpecialRules).toBe(true);
    expect(rows.find(row => row.id === 'once-special')?.hasSpecialRules).toBe(true);
    expect(rows.find(row => row.id === 'cooldown-special')?.hasSpecialRules).toBe(true);
    expect(rows.find(row => row.id === 'minimum-special')?.hasSpecialRules).toBe(true);
  });

  test('patch mismatch fails clearly', () => {
    expect(() => buildRulesPageModel(rules, dataset.records, '18.2')).toThrow(/版本.*不一致/);
  });
});
