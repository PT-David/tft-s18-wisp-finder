import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateDecisionOverlay, type DecisionOverlay } from '../scripts/validate-search-lexicon-decisions';

const decisions = JSON.parse(readFileSync('data/reviews/18.1/search-lexicon-decisions.json', 'utf8')) as DecisionOverlay;
const concepts = JSON.parse(readFileSync('data/overrides/18.1/search-concepts.draft.json', 'utf8'));
const synonyms = JSON.parse(readFileSync('data/overrides/18.1/synonyms.draft.json', 'utf8'));

describe('manual search lexicon decision overlay', () => {
  it('matches current generated metadata and approved aliases', () => {
    expect(validateDecisionOverlay(decisions, concepts, synonyms)).toEqual([]);
    expect(decisions.assignmentDecisions).toEqual([]);
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
