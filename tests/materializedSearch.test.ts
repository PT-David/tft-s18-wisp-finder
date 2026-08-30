import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { WispDataset } from '../src/domain/types';
import type { DecisionOverlay } from '../scripts/validate-search-lexicon-decisions';
import { effectiveAssignments, materializeReviewedSearch, normalizedJson, sha256, type ConceptDraft, type SynonymDraft } from '../scripts/data/lib/materialized-search';

const files = {
  bytes: readFileSync('data/normalized/wisps_18.1.json'),
  concepts: JSON.parse(readFileSync('data/overrides/18.1/search-concepts.draft.json', 'utf8')) as ConceptDraft,
  synonyms: JSON.parse(readFileSync('data/overrides/18.1/synonyms.draft.json', 'utf8')) as SynonymDraft,
  decisions: JSON.parse(readFileSync('data/reviews/18.1/search-lexicon-decisions.json', 'utf8')) as DecisionOverlay,
};
const dataset = JSON.parse(files.bytes.toString()) as WispDataset;

describe('reviewed search materialization', () => {
  it.each([
    ['missing decision', (d: DecisionOverlay) => d.assignmentDecisions.pop()],
    ['duplicate decision', (d: DecisionOverlay) => d.assignmentDecisions.push({ ...d.assignmentDecisions[0]! })],
    ['stale review', (d: DecisionOverlay) => { d.metadata.reviewedAgainstInputSha256 = 'stale'; }],
  ])('refuses %s', (_, mutate) => {
    const decisions = structuredClone(files.decisions); mutate(decisions);
    expect(() => materializeReviewedSearch(dataset, files.bytes, files.concepts, files.synonyms, decisions)).toThrow();
  });

  it('refuses a newly generated, unreviewed assignment', () => {
    const concepts = structuredClone(files.concepts);
    concepts.assignments.push({ wispId: dataset.records[0]!.id, conceptKey: 'gold_payment' });
    expect(() => materializeReviewedSearch(dataset, files.bytes, concepts, files.synonyms, files.decisions)).toThrow(/no manual review/);
  });

  it.each([
    ['a duplicate generated group key', (synonyms: SynonymDraft, _decisions: DecisionOverlay) => synonyms.queryExpansionGroups.push({ ...structuredClone(synonyms.queryExpansionGroups[0]!), key: ` ${synonyms.queryExpansionGroups[0]!.key.toUpperCase()} ` })],
    ['a duplicate approved alias', (_synonyms: SynonymDraft, decisions: DecisionOverlay) => decisions.queryExpansionDecisions[0]!.approved.push(` ${decisions.queryExpansionDecisions[0]!.approved[0]!.toUpperCase()} `)],
    ['an unknown synonym concept key', (synonyms: SynonymDraft, _decisions: DecisionOverlay) => synonyms.queryExpansionGroups[0]!.conceptKeys!.push('unknown_concept')],
    ['a duplicate synonym concept key', (synonyms: SynonymDraft, _decisions: DecisionOverlay) => synonyms.queryExpansionGroups[0]!.conceptKeys!.push(synonyms.queryExpansionGroups[0]!.conceptKeys![0]!)],
    ['an unreviewed record alias', (synonyms: SynonymDraft, _decisions: DecisionOverlay) => synonyms.recordAliases.push({ wispId: dataset.records[0]!.id, aliases: ['synthetic alias'] })],
  ])('refuses %s', (_, mutate) => {
    const synonyms = structuredClone(files.synonyms);
    const decisions = structuredClone(files.decisions);
    mutate(synonyms, decisions);
    expect(() => materializeReviewedSearch(dataset, files.bytes, files.concepts, synonyms, decisions)).toThrow();
  });

  it('implements approved, rejected, and modified actions', () => {
    const base = files.decisions.assignmentDecisions.slice(0, 3).map(item => ({ ...item }));
    base[0]!.action = 'approved'; base[1]!.action = 'rejected';
    base[2]!.action = 'modified'; base[2]!.replacementConceptKey = files.concepts.taxonomy.find(item => item.key !== base[2]!.conceptKey)!.key;
    const set = effectiveAssignments({ ...files.decisions, assignmentDecisions: base });
    expect(set.has(`${base[0]!.wispId}\0${base[0]!.conceptKey}`)).toBe(true);
    expect(set.has(`${base[1]!.wispId}\0${base[1]!.conceptKey}`)).toBe(false);
    expect(set.has(`${base[2]!.wispId}\0${base[2]!.conceptKey}`)).toBe(false);
    expect(set.has(`${base[2]!.wispId}\0${base[2]!.replacementConceptKey}`)).toBe(true);
  });

  it('preserves production membership, review sets, aliases, and core data', () => {
    const result = materializeReviewedSearch(dataset, files.bytes, files.concepts, files.synonyms, files.decisions);
    expect(result.searchConcepts.assignmentCount).toBe(289);
    expect(result.searchConcepts.records.map(item => item.wispId)).toEqual([...dataset.records.map(item => item.id)].sort((a,b) => a.localeCompare(b, 'en')));
    expect(new Set(result.searchConcepts.records.flatMap(item => item.conceptKeys.map(key => `${item.wispId}\0${key}`)))).toEqual(effectiveAssignments(files.decisions));
    expect(result.searchConcepts.taxonomy.map(item => item.key)).not.toContain('survival_duration');
    expect(result.searchConcepts.taxonomy.map(item => item.key)).toContain('survival_condition');
    const aliases = result.synonyms.queryExpansionGroups.flatMap(group => group.aliases).map(alias => alias.toLocaleLowerCase());
    expect(aliases).not.toEqual(expect.arrayContaining(['d','roll','妮蔻','ap','ad','as','cc']));
    expect(result.synonyms.recordAliases).toEqual([]);
    expect(result.wisps.records.every(record => record.synonyms.length === 0)).toBe(true);
    const strip = (data: WispDataset) => ({ ...data, records: data.records.map(({ searchConcepts: _a, synonyms: _b, ...record }) => record) });
    expect(strip(result.wisps)).toEqual(strip(dataset));
    expect(sha256(files.bytes)).toBe('a7fdf375bc36f0f164a36912af4ca22c1671ede0ba94ae3e8ce3c8bbdee9abe7');
    expect(readFileSync('public/data/wisps.json', 'utf8')).toBe(files.bytes.toString());
    const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim();
    const groupKeys = result.synonyms.queryExpansionGroups.map(group => normalize(group.groupKey));
    expect(new Set(groupKeys).size).toBe(groupKeys.length);
    const taxonomy = new Set(result.searchConcepts.taxonomy.map(item => item.key));
    for (const group of result.synonyms.queryExpansionGroups) {
      expect(new Set(group.aliases.map(normalize)).size).toBe(group.aliases.length);
      expect(new Set(group.conceptKeys).size).toBe(group.conceptKeys.length);
      expect(group.conceptKeys.every(key => taxonomy.has(key))).toBe(true);
    }
  });

  it('is byte-for-byte deterministic', () => {
    const first = materializeReviewedSearch(dataset, files.bytes, files.concepts, files.synonyms, files.decisions);
    const second = materializeReviewedSearch(dataset, files.bytes, files.concepts, files.synonyms, files.decisions);
    expect(normalizedJson(first.searchConcepts)).toBe(normalizedJson(second.searchConcepts));
    expect(normalizedJson(first.synonyms)).toBe(normalizedJson(second.synonyms));
    expect(normalizedJson(first.wisps)).toBe(normalizedJson(second.wisps));
  });
});
