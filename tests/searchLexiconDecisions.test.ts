import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { summarizeAssignmentReview, validateDecisionOverlay, type DecisionOverlay } from '../scripts/validate-search-lexicon-decisions';
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
    expect(summarizeAssignmentReview(decisions, concepts)).toEqual({
      generatedAssignments: 289,
      assignmentDecisions: 289,
      approved: 289,
      rejected: 0,
      modified: 0,
      unreviewed: 0,
      staleDecisions: 0,
    });
    expect(decisions.assignmentDecisions.map(({ wispId, conceptKey }) => `${wispId}\0${conceptKey}`)).toEqual(
      concepts.assignments.map(({ wispId, conceptKey }: { wispId: string; conceptKey: string }) => `${wispId}\0${conceptKey}`),
    );
  });
  it('keeps generator confidence independent from final manual approval', () => {
    const needsReview = concepts.assignments.filter((item: { confidence: string }) => item.confidence === 'needs_review');
    expect(needsReview).toHaveLength(16);
    for (const assignment of needsReview) {
      expect(decisions.assignmentDecisions.find(item =>
        item.wispId === assignment.wispId && item.conceptKey === assignment.conceptKey,
      )?.action).toBe('approved');
    }
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
  it('accepts the assignment decision schema independently of generator confidence', () => {
    const synthetic = structuredClone(decisions);
    const [approved, rejected, modified] = synthetic.assignmentDecisions;
    approved!.action = 'approved'; approved!.reason = 'synthetic approval';
    rejected!.action = 'rejected'; rejected!.reason = 'synthetic rejection';
    modified!.action = 'modified'; modified!.reason = 'synthetic modification';
    modified!.replacementConceptKey = concepts.taxonomy.find((item: { key: string }) => item.key !== modified!.conceptKey).key;
    expect(validateDecisionOverlay(synthetic, concepts, synonyms)).toEqual([]);
  });
  it('rejects malformed, duplicate, unknown, and invalid assignment decisions', () => {
    const original = concepts.assignments[0] as { wispId: string; conceptKey: string };
    const replacementConceptKey = concepts.taxonomy.find((item: { key: string }) => item.key !== original.conceptKey).key as string;
    const invalid = structuredClone(decisions) as unknown as DecisionOverlay;
    invalid.assignmentDecisions.push(
      { ...original, action: 'approved', reason: '', replacementConceptKey },
      { ...original, action: 'rejected', reason: 'duplicate' },
      { wispId: 'unknown_wisp', conceptKey: 'unknown_concept', action: 'invalid' as 'approved', reason: 'invalid action' },
      { ...original, action: 'modified', reason: 'missing replacement' },
      { ...original, action: 'modified', reason: 'same replacement', replacementConceptKey: original.conceptKey },
      { ...original, action: 'modified', reason: 'unknown replacement', replacementConceptKey: 'unknown_concept' },
    );
    const errors = validateDecisionOverlay(invalid, concepts, synonyms);
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringContaining('duplicate assignment decision'),
      expect.stringContaining('assignment decision not found in draft'),
      expect.stringContaining('unknown Wisp in assignment decision'),
      expect.stringContaining('unknown concept in assignment decision'),
      expect.stringContaining('invalid assignment decision action'),
      expect.stringContaining('assignment decision lacks reason'),
      expect.stringContaining('approved assignment decision must not have replacementConceptKey'),
      expect.stringContaining('modified assignment decision requires replacementConceptKey'),
      expect.stringContaining('replacement concept must differ from original'),
      expect.stringContaining('unknown replacement taxonomy key'),
    ]));
  });
  it('rejects missing, stale, and duplicate assignment review coverage', () => {
    const missing = structuredClone(decisions);
    const removed = missing.assignmentDecisions.pop()!;
    expect(validateDecisionOverlay(missing, concepts, synonyms)).toContainEqual(
      `generated assignment has no manual review decision: ${removed.wispId}/${removed.conceptKey}`,
    );

    const stale = structuredClone(decisions);
    const assigned = new Set(concepts.assignments.map((item: { wispId: string; conceptKey: string }) => `${item.wispId}\0${item.conceptKey}`));
    const existingWisp = concepts.assignments[0].wispId as string;
    const unusedConcept = concepts.taxonomy.find((item: { key: string }) => !assigned.has(`${existingWisp}\0${item.key}`)).key as string;
    stale.assignmentDecisions.push({ wispId: existingWisp, conceptKey: unusedConcept, action: 'approved', reason: 'synthetic stale decision' });
    expect(validateDecisionOverlay(stale, concepts, synonyms)).toContainEqual(
      `assignment decision not found in draft: ${existingWisp}/${unusedConcept}`,
    );

    const duplicate = structuredClone(decisions);
    duplicate.assignmentDecisions.push(structuredClone(duplicate.assignmentDecisions[0]!));
    expect(validateDecisionOverlay(duplicate, concepts, synonyms)).toContainEqual(expect.stringContaining('duplicate assignment decision'));
  });
  it('rejects a generated assignment change even when stale metadata is manually synchronized', () => {
    const changedConcepts = structuredClone(concepts);
    const changedSynonyms = structuredClone(synonyms);
    const synchronizedDecisions = structuredClone(decisions);
    changedConcepts.generatorVersion = 'synthetic-next-version';
    changedSynonyms.generatorVersion = 'synthetic-next-version';
    synchronizedDecisions.metadata.reviewedAgainstGeneratorVersion = 'synthetic-next-version';
    changedConcepts.assignments.push({
      wispId: 'synthetic_new_wisp', conceptKey: concepts.taxonomy[0].key,
      evidence: [], confidence: 'candidate_high_confidence', reviewFlags: [],
    });
    expect(validateDecisionOverlay(synchronizedDecisions, changedConcepts, changedSynonyms)).toContainEqual(
      `generated assignment has no manual review decision: synthetic_new_wisp/${concepts.taxonomy[0].key}`,
    );
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
