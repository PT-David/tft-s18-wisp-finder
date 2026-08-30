import type { RuntimeSearchLexicon, Wisp } from '../domain/types';
import { buildCandidatePool, type CandidateCriteria } from '../filter/candidates';
import { calculateEqualWeight } from '../probability/equalWeight';
import { searchWisps, type SearchHit } from '../search/searchEngine';

export interface QueryResult {
  candidatePool: Wisp[];
  displayedResults: SearchHit[];
  probability: ReturnType<typeof calculateEqualWeight>;
}

export function runQuery(wisps: readonly Wisp[], criteria: CandidateCriteria, query: string, lexicon: RuntimeSearchLexicon): QueryResult {
  const candidatePool = buildCandidatePool(wisps, criteria);
  const displayedResults = searchWisps(candidatePool, query, lexicon);
  const targetIds = new Set(displayedResults.map(({ wisp }) => wisp.id));
  return { candidatePool, displayedResults, probability: calculateEqualWeight(candidatePool, targetIds) };
}
