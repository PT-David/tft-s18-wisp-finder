import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { WispDataset } from '../src/domain/types';
import { assertRuntimeSearchCompatibility, parseRuntimeSearchLexicon } from '../src/data/searchLexiconRepository';
const concepts = JSON.parse(readFileSync('data/materialized/18.1/search-concepts.json', 'utf8'));
const synonyms = JSON.parse(readFileSync('data/materialized/18.1/synonyms.json', 'utf8'));
const dataset = JSON.parse(readFileSync('data/materialized/18.1/wisps.json', 'utf8')) as WispDataset;
const seedDataset = JSON.parse(readFileSync('data/wisps_18.1.json', 'utf8')) as WispDataset;
describe('runtime reviewed search lexicon parsing', () => {
  it('preserves reviewed structured semantics', () => {
    const lexicon = parseRuntimeSearchLexicon(concepts, synonyms);
    expect(lexicon).toMatchObject({ patch: '18.1', sourceGeneratorVersion: 'c2.1-v8', normalizedRecordCount: 169, assignmentCount: 289 });
    expect(lexicon.conceptMembership).toHaveLength(169); expect(lexicon.recordAliases).toEqual([]);
    expect(lexicon.concepts).toHaveLength(40); expect(lexicon.queryExpansionGroups).toHaveLength(10);
    expect(lexicon.queryExpansionGroups.find(group => group.groupKey === 'health_terms')?.conceptKeys).toEqual([]);
    expect(lexicon.queryExpansionGroups.find(group => group.groupKey === 'death_terms')?.conceptKeys).toEqual([]);
  });
  it.each([
    ['unsupported schema', (c: any, _s: any) => { c.schemaVersion = 999; }],
    ['patch mismatch', (_c: any, s: any) => { s.patch = '18.2'; }],
    ['metadata mismatch', (_c: any, s: any) => { s.reviewedAgainstInputSha256 = 'stale'; }],
    ['duplicate taxonomy', (c: any, _s: any) => { c.taxonomy.push({ ...c.taxonomy[0] }); }],
  ])('rejects %s', (_, mutate) => { const c = structuredClone(concepts); const s = structuredClone(synonyms); mutate(c, s); expect(() => parseRuntimeSearchLexicon(c, s)).toThrow(); });

  it('accepts the reviewed production dataset and lexicon', () => expect(() => assertRuntimeSearchCompatibility(dataset, parseRuntimeSearchLexicon(concepts, synonyms))).not.toThrow());

  it.each([
    ['10-record seed versus 169-record lexicon', (data: WispDataset, _lexicon: ReturnType<typeof parseRuntimeSearchLexicon>) => { data.records = structuredClone(seedDataset.records); }],
    ['Wisp identity mismatch', (_data: WispDataset, lexicon: ReturnType<typeof parseRuntimeSearchLexicon>) => { lexicon.conceptMembership[0]!.wispId = 'different_wisp'; }],
    ['concept membership mismatch', (data: WispDataset, _lexicon: ReturnType<typeof parseRuntimeSearchLexicon>) => { data.records[0]!.searchConcepts = ['champion_star_level']; }],
    ['unknown dataset concept', (data: WispDataset, _lexicon: ReturnType<typeof parseRuntimeSearchLexicon>) => { data.records[0]!.searchConcepts = ['unknown_concept']; }],
    ['assignment count mismatch', (_data: WispDataset, lexicon: ReturnType<typeof parseRuntimeSearchLexicon>) => { lexicon.assignmentCount += 1; }],
  ])('rejects dataset compatibility failure: %s', (_, mutate) => {
    const data = structuredClone(dataset); const lexicon = structuredClone(parseRuntimeSearchLexicon(concepts, synonyms));
    mutate(data, lexicon); expect(() => assertRuntimeSearchCompatibility(data, lexicon)).toThrow();
  });
});
