import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { WispDataset } from '../src/domain/types';
import { detectAliasCollisions, generateSearchLexicon, TAXONOMY, type QueryGroup } from '../scripts/data/lib/search-lexicon';

const input = readFileSync('data/normalized/wisps_18.1.json');
const dataset = JSON.parse(input.toString()) as WispDataset;
const generated = generateSearchLexicon(dataset, input);
const assignment = (id: string, concept: string) => generated.conceptDraft.assignments.find(x => x.wispId === id && x.conceptKey === concept);

describe('Stage C2.1 search lexicon generation', () => {
  it('is deterministic for a fixed production snapshot', () => {
    expect(JSON.stringify(generateSearchLexicon(dataset, input))).toBe(JSON.stringify(generateSearchLexicon(dataset, input)));
    expect(generated.conceptDraft.input).toEqual({ path: 'data/normalized/wisps_18.1.json', sha256: expect.stringMatching(/^[a-f0-9]{64}$/), recordCount: 169 });
  });

  it('only emits canonical taxonomy keys and retains exact evidence fields', () => {
    const keys = new Set(TAXONOMY.map(x => x.key));
    expect(generated.conceptDraft.assignments.every(x => keys.has(x.conceptKey))).toBe(true);
    const requirement = assignment('da_18_fieldofmice', 'champion_cost_tier')?.evidence.find(x => x.field.startsWith('requirements['));
    expect(requirement).toMatchObject({ field: 'requirements[0].textZh', text: '上一场战斗中上阵了5个1费弈子', requirementIndex: 0, requirementType: 'source_text' });
    expect(assignment('da_18_fieldofmice', 'champion_cost_tier')?.evidence.some(x => x.field === 'effects.normal')).toBe(true);
  });

  it('does not promote bare unit health into player-health concepts', () => {
    expect(assignment('da_18_giantgrowth', 'player_health_gain')).toBeUndefined();
    expect(assignment('da_18_giantgrowth', 'player_health_threshold')).toBeUndefined();
    expect(generated.report.reviewGroups.player_vs_unit_health.some(x => x.wispId === 'da_18_giantgrowth' && x.rule === 'bare_health_guard')).toBe(true);
    expect(assignment('snapshot_022_fc7538964718', 'player_health_loss')).toBeDefined();
  });

  it('keeps death, kill, and execute concepts distinct', () => {
    expect(assignment('da_18_fertilize', 'enemy_death')).toBeDefined();
    expect(assignment('da_18_fertilize', 'kill_takedown')).toBeUndefined();
    expect(assignment('da_18_killingfrenzy', 'execute_threshold')).toBeDefined();
    expect(assignment('da_18_killingfrenzy', 'kill_takedown')).toBeDefined();
    expect(generated.report.reviewGroups.death_kill_execute.some(x => x.wispId === 'da_18_killingfrenzy')).toBe(true);
  });

  it('separates gold rewards, gold conditions, and item semantics', () => {
    expect(assignment('da_18_bloodmoney', 'gold_gain')).toBeDefined();
    expect(assignment('da_18_mercenaryforce', 'gold_cost')?.confidence).toBe('needs_review');
    expect(assignment('da_blastpotion18_charm', 'temporary_item')).toBeDefined();
    expect(assignment('da_18_heroicsacrifice', 'item_requirement')?.evidence.every(x => x.field.startsWith('requirements['))).toBe(true);
    expect(assignment('da_artifactinate18', 'artifact_item')).toBeDefined();
  });

  it('does not confuse generic copies with Champion Duplicators', () => {
    expect(assignment('da_18_fieldofmice', 'champion_duplicator')).toBeDefined();
    expect(assignment('snapshot_139_6fda4e76a4da', 'champion_duplicator')).toBeUndefined();
    expect(generated.report.reviewGroups.clone_vs_duplicator.some(x => x.wispId === 'snapshot_139_6fda4e76a4da')).toBe(true);
  });

  it('assigns reroll only to explicit TFT reroll wording and still queues context review', () => {
    expect(assignment('da_18_allfives', 'shop_reroll')).toBeDefined();
    expect(assignment('da_18_freeroller', 'shop_reroll')).toBeDefined();
    expect(generated.report.reviewGroups.reroll_vs_refresh.some(x => x.wispId === 'da_18_freeroller')).toBe(true);
  });

  it('keeps query expansion and record aliases separate and preserves phrases', () => {
    const synonyms = generated.synonymDraft;
    expect(Array.isArray(synonyms.queryExpansionGroups)).toBe(true);
    expect(synonyms.recordAliases).toEqual([]);
    const duplicator = synonyms.queryExpansionGroups.find(x => x.key === 'champion_duplicator_terms');
    expect(duplicator?.aliases).toContainEqual({ term: 'Champion Duplicator', language: 'en' });
    expect(duplicator?.aliases).not.toContainEqual(expect.objectContaining({ term: 'Champion' }));
  });

  it('reports an alias mapped to multiple concepts instead of choosing one', () => {
    const groups: QueryGroup[] = [
      { key: 'gain', canonicalTerm: 'coin', conceptKeys: ['gold_gain'], aliases: [{ term: 'coin', language: 'en' }], evidence: 'test rule', collisionRisk: [], reviewStatus: 'draft_candidate' },
      { key: 'cost', canonicalTerm: 'coin', conceptKeys: ['gold_cost'], aliases: [{ term: 'coin', language: 'en' }], evidence: 'test rule', collisionRisk: [], reviewStatus: 'draft_candidate' },
    ];
    expect(detectAliasCollisions(groups)).toEqual([{ alias: 'coin', groupKeys: ['cost', 'gain'], conceptKeys: ['gold_cost', 'gold_gain'], reviewStatus: 'needs_review' }]);
  });

  it('does not alter production search fields', () => {
    expect(dataset.records).toHaveLength(169);
    expect(dataset.records.every(w => w.searchConcepts.length === 0 && w.synonyms.length === 0)).toBe(true);
    const publicDataset = JSON.parse(readFileSync('public/data/wisps.json', 'utf8')) as WispDataset;
    expect(publicDataset.records.every(w => w.searchConcepts.length === 0 && w.synonyms.length === 0)).toBe(true);
  });
});
