import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateDecisionOverlay, type DecisionOverlay } from '../scripts/validate-search-lexicon-decisions';
import { BASE_SYNONYMS, normalizeSearchText } from '../src/search/searchEngine';

const decisions = JSON.parse(readFileSync('data/reviews/18.1/search-lexicon-decisions.json', 'utf8')) as DecisionOverlay;
const concepts = JSON.parse(readFileSync('data/overrides/18.1/search-concepts.draft.json', 'utf8'));
const synonyms = JSON.parse(readFileSync('data/overrides/18.1/synonyms.draft.json', 'utf8'));
const normalizeAlias = (alias: string) => normalizeSearchText(alias).trim();
const canonicalGroups = (groups: readonly (readonly string[])[]) => groups
  .map(group => [...new Set(group.map(normalizeAlias))].sort())
  .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const flattenedAliases = (groups: readonly (readonly string[])[]) =>
  [...new Set(groups.flat().map(normalizeAlias))].sort();

describe('manual search lexicon decision overlay', () => {
  it('matches current generated metadata and approved aliases', () => {
    expect(validateDecisionOverlay(decisions, concepts, synonyms)).toEqual([]);
    expect(decisions.assignmentDecisions).toEqual([]);
  });
  it('requires exactly one manual decision for every generated query group', () => {
    const extraGroup = structuredClone(synonyms);
    extraGroup.queryExpansionGroups.push({
      key: 'synthetic_unreviewed_terms', canonicalTerm: 'synthetic', aliases: [{ term: 'synthetic', language: 'en' }],
      evidence: 'synthetic validator fixture', intrinsicRisks: [], reviewStatus: 'draft_candidate',
    });
    expect(validateDecisionOverlay(decisions, concepts, extraGroup)).toContainEqual(
      'query expansion group has no manual review decision: synthetic_unreviewed_terms',
    );

    const duplicate = structuredClone(decisions);
    duplicate.queryExpansionDecisions.push(structuredClone(duplicate.queryExpansionDecisions[0]!));
    expect(validateDecisionOverlay(duplicate, concepts, synonyms)).toContainEqual(
      `duplicate query expansion group decision: ${duplicate.queryExpansionDecisions[0]!.groupKey}`,
    );
  });
  it('keeps runtime bootstrap synonym groups exactly equal to manually approved groups', () => {
    const approvedGroups = decisions.queryExpansionDecisions.map(group => group.approved);
    expect(canonicalGroups(BASE_SYNONYMS)).toEqual(canonicalGroups(approvedGroups));
    expect(flattenedAliases(BASE_SYNONYMS)).toEqual(flattenedAliases(approvedGroups));
    for (const rejected of ['d', 'roll', '妮蔻', 'ap', 'ad', 'as', 'cc']) expect(flattenedAliases(BASE_SYNONYMS)).not.toContain(rejected);
  });
  it('detects semantic regrouping even when the flattened vocabulary is unchanged', () => {
    const approvedGroups = decisions.queryExpansionDecisions.map(group => group.approved);
    const regrouped = BASE_SYNONYMS.map(group => [...group]);
    [regrouped[0]![0], regrouped[1]![0]] = [regrouped[1]![0]!, regrouped[0]![0]!];

    expect(flattenedAliases(regrouped)).toEqual(flattenedAliases(approvedGroups));
    expect(canonicalGroups(regrouped)).not.toEqual(canonicalGroups(approvedGroups));
  });
  it('generator does not target the manually maintained decisions file', () => {
    const generatorEntry = readFileSync('scripts/data/generate-search-lexicon-18.1.ts', 'utf8');
    expect(generatorEntry).not.toContain('search-lexicon-decisions.json');
  });
  it('detects stale generator and input reviews', () => {
    const staleVersion = structuredClone(decisions); staleVersion.metadata.reviewedAgainstGeneratorVersion = 'old';
    expect(validateDecisionOverlay(staleVersion, concepts, synonyms)).toContainEqual(expect.stringContaining('generator version changed'));
    const staleInput = structuredClone(decisions); staleInput.metadata.reviewedAgainstInputSha256 = 'old';
    expect(validateDecisionOverlay(staleInput, concepts, synonyms)).toContainEqual(expect.stringContaining('normalized input SHA changed'));
  });
  it('accepts future approved, rejected, and modified assignment decisions with reasons', () => {
    const original = concepts.assignments[0] as { wispId: string; conceptKey: string };
    const second = concepts.assignments.find((item: { wispId: string; conceptKey: string }) =>
      item.wispId !== original.wispId || item.conceptKey !== original.conceptKey) as { wispId: string; conceptKey: string };
    const third = concepts.assignments.find((item: { wispId: string; conceptKey: string }) =>
      item.wispId !== original.wispId && item.wispId !== second.wispId) as { wispId: string; conceptKey: string };
    const replacementConceptKey = concepts.taxonomy.find((item: { key: string }) => item.key !== third.conceptKey).key as string;
    const synthetic = structuredClone(decisions);
    synthetic.assignmentDecisions = [
      { ...original, action: 'approved', reason: 'synthetic approval' },
      { ...second, action: 'rejected', reason: 'synthetic rejection' },
      { ...third, action: 'modified', reason: 'synthetic modification', replacementConceptKey },
    ];
    expect(validateDecisionOverlay(synthetic, concepts, synonyms)).toEqual([]);
    expect(decisions.assignmentDecisions).toEqual([]);
  });
  it('rejects malformed, duplicate, unknown, and invalid assignment decisions', () => {
    const original = concepts.assignments[0] as { wispId: string; conceptKey: string };
    const replacementConceptKey = concepts.taxonomy.find((item: { key: string }) => item.key !== original.conceptKey).key as string;
    const invalid = structuredClone(decisions) as unknown as DecisionOverlay;
    invalid.assignmentDecisions = [
      { ...original, action: 'approved', reason: '', replacementConceptKey },
      { ...original, action: 'rejected', reason: 'duplicate' },
      { wispId: 'unknown_wisp', conceptKey: 'unknown_concept', action: 'invalid' as 'approved', reason: 'invalid action' },
      { ...original, action: 'modified', reason: 'missing replacement' },
      { ...original, action: 'modified', reason: 'same replacement', replacementConceptKey: original.conceptKey },
      { ...original, action: 'modified', reason: 'unknown replacement', replacementConceptKey: 'unknown_concept' },
    ];
    const errors = validateDecisionOverlay(invalid, concepts, synonyms);
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('duplicate assignment decision'),
      expect.stringContaining('assignment decision not found in draft'),
      expect.stringContaining('invalid assignment decision action'),
      expect.stringContaining('assignment decision lacks reason'),
      expect.stringContaining('approved assignment decision must not have replacementConceptKey'),
      expect.stringContaining('modified assignment decision requires replacementConceptKey'),
      expect.stringContaining('replacement concept must differ from original'),
      expect.stringContaining('unknown replacement taxonomy key'),
    ]));
  });
  it.each([['reroll_terms', 'D'], ['reroll_terms', 'roll'], ['champion_duplicator_terms', '妮蔻']])('records rejected alias %s/%s with a reason', (groupKey, alias) => {
    const rejection = decisions.queryExpansionDecisions.find(x => x.groupKey === groupKey)?.rejected.find(x => x.alias === alias);
    expect(rejection?.reason).toBeTruthy();
  });
  it('keeps death, kill, and health semantics isolated', () => {
    const death = synonyms.queryExpansionGroups.find((x: { key: string }) => x.key === 'death_terms');
    const kill = synonyms.queryExpansionGroups.find((x: { key: string }) => x.key === 'kill_terms');
    const health = synonyms.queryExpansionGroups.find((x: { key: string }) => x.key === 'health_terms');
    expect(death.conceptKeys).toBeUndefined();
    expect(kill.conceptKeys).toEqual(['kill_takedown']);
    expect(health.conceptKeys).toBeUndefined();
  });
});
