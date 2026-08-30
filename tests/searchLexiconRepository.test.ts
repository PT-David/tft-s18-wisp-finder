import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRuntimeSearchLexicon } from '../src/data/searchLexiconRepository';
const concepts = JSON.parse(readFileSync('data/materialized/18.1/search-concepts.json', 'utf8'));
const synonyms = JSON.parse(readFileSync('data/materialized/18.1/synonyms.json', 'utf8'));
describe('runtime reviewed search lexicon parsing', () => {
  it('preserves reviewed structured semantics', () => {
    const lexicon = parseRuntimeSearchLexicon(concepts, synonyms);
    expect(lexicon).toMatchObject({ patch: '18.1', sourceGeneratorVersion: 'c2.1-v8', normalizedRecordCount: 169 });
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
});
