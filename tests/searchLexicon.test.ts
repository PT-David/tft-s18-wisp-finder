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
    expect(assignment('da_18_mercenaryforce', 'gold_requirement')?.confidence).toBe('needs_review');
    expect(assignment('da_18_mercenaryforce', 'gold_payment')).toBeUndefined();
    expect(assignment('da_heroofprophecy18', 'gold_requirement')).toBeDefined();
    expect(assignment('da_heroofprophecy18', 'gold_payment')).toBeUndefined();
    expect(assignment('da_curiocart18', 'shop_price')).toBeDefined();
    expect(assignment('da_curiocart18', 'gold_payment')).toBeUndefined();
    expect(assignment('da_blastpotion18_charm', 'temporary_item')).toBeDefined();
    expect(assignment('da_18_heroicsacrifice', 'item_requirement')?.evidence.every(x => x.field.startsWith('requirements['))).toBe(true);
    expect(assignment('da_artifactinate18', 'artifact_item')).toBeDefined();
  });

  it('only treats explicit gold payment or loss as gold_payment', () => {
    const fixture = structuredClone(dataset.records[0]!);
    fixture.id = 'synthetic_gold_payment_rule_fixture';
    fixture.effects.normal = '支付3金币。';
    fixture.effects.blossom = null;
    fixture.effects.prismatic = null;
    fixture.requirements = [];
    const result = generateSearchLexicon({ ...dataset, records: [fixture] }, Buffer.from('synthetic rule fixture'));
    expect(result.conceptDraft.assignments.find(x => x.conceptKey === 'gold_payment')).toBeDefined();
    expect(result.conceptDraft.assignments.find(x => x.conceptKey === 'gold_requirement')).toBeUndefined();
    expect(result.conceptDraft.assignments.find(x => x.conceptKey === 'shop_price')).toBeUndefined();
  });

  it('does not confuse delayed triggers or buff durations with survival', () => {
    for (const id of ['da_18_radiantize', 'da_herosentrance18', 'da_natureswrath18']) {
      expect(assignment(id, 'survival_condition')).toBeUndefined();
      expect(assignment(id, 'delayed_trigger')).toBeDefined();
    }
    expect(assignment('da_quicken18', 'survival_condition')).toBeUndefined();
    expect(assignment('da_rolypolys18', 'survival_condition')).toBeDefined();
  });

  it('retains evidence for every simple and compound Aftershock delayed trigger', () => {
    const delayed = assignment('da_18_aftershock', 'delayed_trigger');
    expect(delayed?.evidence.map(x => x.field)).toEqual(['effects.blossom', 'effects.normal']);
    expect(delayed?.evidence.find(x => x.field === 'effects.blossom')).toMatchObject({
      text: '在8和18秒后，晕眩所有敌人1.5秒。',
      matchedTerms: ['在8和18秒后'],
    });
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

  it('recognizes current Set 18 AP and AD terminology', () => {
    expect(assignment('da_18_prolificpower', 'ability_power')).toBeDefined();
    expect(assignment('da_18_prolificpower', 'attack_damage')).toBeDefined();
    expect(assignment('da_thingamajigjar18', 'ability_power')).toBeDefined();
    expect(assignment('da_knickknackjar18', 'attack_damage')).toBeDefined();
  });

  it('assigns free reroll and shop reroll to the production 免费重随 wording', () => {
    expect(assignment('da_refreshinglight18', 'free_reroll')).toBeDefined();
    expect(assignment('da_refreshinglight18', 'shop_reroll')).toBeDefined();
  });

  it('uses champion category context for named champion grants, not bracketed items', () => {
    expect(assignment('da_18_heatedrivalry', 'champion_obtain')).toBeDefined();
    expect(assignment('da_solargift18', 'champion_obtain')).toBeDefined();
    for (const id of ['da_18_earlyfix', 'da_18_fieldofmice', 'da_18_mitosis', 'snapshot_157_3ed870773960', 'da_artifactinate18', 'da_bloodandiron18']) {
      expect(assignment(id, 'champion_obtain')).toBeUndefined();
    }
  });

  it('separates actual star-up actions from static star-level references', () => {
    for (const id of ['da_18_starfall', 'da_boostershot18', 'da_moonlightritual18']) {
      expect(assignment(id, 'champion_star_up')).toBeDefined();
    }
    expect(assignment('da_apprentice18', 'champion_star_level')).toBeDefined();
    expect(assignment('da_apprentice18', 'champion_star_up')).toBeUndefined();
    expect(generated.conceptDraft.assignments.filter(x => x.conceptKey === 'champion_star_up')).toHaveLength(3);
  });

  it('covers explicit round timing without treating second-based timing as a stage', () => {
    for (const id of ['da_18_fieldofmice', 'da_barter18', 'da_18_starfall', 'snapshot_136_c467ccd546d7', 'snapshot_147_2dc94df4e3a5']) {
      expect(assignment(id, 'time_stage')).toBeDefined();
    }
    for (const id of ['da_18_radiantize', 'da_herosentrance18', 'da_natureswrath18', 'da_quicken18']) {
      expect(assignment(id, 'time_stage')).toBeUndefined();
    }
  });

  it('keeps shield as the generic concept for shield reduction', () => {
    expect(assignment('da_petrifyshields18', 'shield')).toBeDefined();
    expect(TAXONOMY.find(x => x.key === 'shield')?.description).toContain('削减护盾');
  });

  it('keeps query expansion and record aliases separate and preserves phrases', () => {
    const synonyms = generated.synonymDraft;
    expect(Array.isArray(synonyms.queryExpansionGroups)).toBe(true);
    expect(synonyms.recordAliases).toEqual([]);
    const duplicator = synonyms.queryExpansionGroups.find(x => x.key === 'champion_duplicator_terms');
    expect(duplicator?.aliases).toContainEqual({ term: 'Champion Duplicator', language: 'en' });
    expect(duplicator?.aliases).not.toContainEqual(expect.objectContaining({ term: 'Champion' }));
    const health = synonyms.queryExpansionGroups.find(x => x.key === 'health_terms');
    expect(health?.aliases.map(x => x.term)).toEqual(expect.arrayContaining(['HP', '生命值', '血量']));
    expect(health?.conceptKeys).toBeUndefined();
  });

  it('only reports cross-group aliases as actual collisions', () => {
    const related: QueryGroup[] = [
      { key: 'reroll', canonicalTerm: '刷新', conceptKeys: ['shop_reroll', 'free_reroll'], aliases: [{ term: 'roll', language: 'en' }], evidence: 'test rule', intrinsicRisks: [], reviewStatus: 'draft_candidate' },
    ];
    expect(detectAliasCollisions(related)).toEqual([]);
    const groups: QueryGroup[] = [
      { key: 'gain', canonicalTerm: 'coin', conceptKeys: ['gold_gain'], aliases: [{ term: 'coin', language: 'en' }], evidence: 'test rule', intrinsicRisks: [], reviewStatus: 'draft_candidate' },
      { key: 'payment', canonicalTerm: 'coin', conceptKeys: ['gold_payment'], aliases: [{ term: 'coin', language: 'en' }], evidence: 'test rule', intrinsicRisks: [], reviewStatus: 'draft_candidate' },
    ];
    expect(detectAliasCollisions(groups)).toEqual([{ alias: 'coin', groupKeys: ['gain', 'payment'], conceptKeys: ['gold_gain', 'gold_payment'], reviewStatus: 'needs_review' }]);
    expect(generated.synonymDraft.actualAliasCollisions).toEqual([]);
    expect(generated.synonymDraft.intrinsicAliasRisks).not.toContainEqual(expect.objectContaining({ risk: 'single_letter_alias:D' }));
  });

  it('reports review workload metrics from the actual generated collections', () => {
    const { summary, reviewGroups, actualAliasCollisions } = generated.report;
    const reviewItems = Object.values(reviewGroups).flat();
    expect(summary.highConfidenceAssignments + summary.needsReviewAssignments).toBe(summary.conceptCandidateAssignments);
    expect(summary.reviewItems).toBe(reviewItems.length);
    expect(summary.uniqueWispsWithReviewItems).toBe(new Set(reviewItems.map(x => x.wispId)).size);
    expect(summary.actualAliasCollisions).toBe(actualAliasCollisions.length);
    expect(summary.riskyQueryExpansionGroups).toBe(generated.synonymDraft.queryExpansionGroups.filter(x => x.intrinsicRisks.length).length);
    expect(summary.reviewGroupCounts).toEqual(Object.fromEntries(Object.entries(reviewGroups).map(([key, items]) => [key, items.length])));
    expect(summary.assignmentsByConcept).toEqual(Object.fromEntries(TAXONOMY.map(({ key }) => [key, generated.conceptDraft.assignments.filter(x => x.conceptKey === key).length])));
    expect(Object.keys(summary.assignmentsByConcept)).toEqual([...Object.keys(summary.assignmentsByConcept)].sort());
  });

  it('does not alter production search fields', () => {
    expect(dataset.records).toHaveLength(169);
    expect(dataset.records.every(w => w.searchConcepts.length === 0 && w.synonyms.length === 0)).toBe(true);
    const publicDataset = JSON.parse(readFileSync('public/data/wisps.json', 'utf8')) as WispDataset;
    expect(publicDataset.records.every(w => w.searchConcepts.length === 0 && w.synonyms.length === 0)).toBe(true);
  });
});
