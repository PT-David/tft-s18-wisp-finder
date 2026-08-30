import type { RuntimeSearchLexicon, Wisp } from '../domain/types';

export type SearchField = 'nameExact' | 'namePrefix' | 'name' | 'effect' | 'requirement' | 'synonym' | 'concept';
export type SearchMatchType = 'direct' | 'queryExpansion' | 'concept';
export type SearchFieldPath =
  | 'nameZh' | 'nameEn'
  | 'effects.normal' | 'effects.blossom' | 'effects.prismatic'
  | `requirements.${number}.textZh` | `requirements.${number}.textEn`
  | `synonyms.${number}`;
export interface SearchTextRange { start: number; end: number }
export interface SearchMatch {
  clauseIndex: number;
  queryTerm: string;
  matchedTerm?: string;
  matchType: SearchMatchType;
  scoreField: SearchField;
  fieldPath?: SearchFieldPath;
  score: number;
  /** Raw-field UTF-16 offsets, half-open and directly consumable by String.prototype.slice(). */
  ranges: readonly SearchTextRange[];
  conceptKey?: string;
}
export interface SearchHit { wisp: Wisp; score: number; matchedFields: readonly SearchField[]; matches: readonly SearchMatch[] }

export function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface NormalizedSearchIndex {
  normalized: string;
  /** Per-normalized-UTF-16-code-unit raw spans. Never use normalized offsets as raw offsets. */
  rawStarts: readonly number[];
  rawEnds: readonly number[];
}

/**
 * Builds a normalization index without changing search normalization semantics. Combining
 * marks travel with their base character; punctuation and whitespace spans collapse onto
 * the normalized space. If an unusual cross-cluster NFKC case cannot be represented, the
 * normalized value remains correct and callers safely return no ranges.
 */
export function normalizeSearchTextWithMap(raw: string): NormalizedSearchIndex {
  const units: Array<{ text: string; start: number; end: number }> = [];
  for (let offset = 0; offset < raw.length;) {
    const start = offset;
    const first = String.fromCodePoint(raw.codePointAt(offset)!);
    offset += first.length;
    let text = first;
    while (offset < raw.length) {
      const next = String.fromCodePoint(raw.codePointAt(offset)!);
      if (!/^\p{M}$/u.test(next)) break;
      text += next; offset += next.length;
    }
    units.push({ text, start, end: offset });
  }

  const output: string[] = []; const rawStarts: number[] = []; const rawEnds: number[] = [];
  let pendingSpace: { start: number; end: number } | undefined;
  for (const unit of units) {
    const transformed = unit.text.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ');
    for (const character of transformed) {
      if (/^\s$/u.test(character)) {
        pendingSpace = pendingSpace ? { start: pendingSpace.start, end: unit.end } : { start: unit.start, end: unit.end };
        continue;
      }
      if (pendingSpace && output.length) {
        output.push(' '); rawStarts.push(pendingSpace.start); rawEnds.push(pendingSpace.end);
      }
      pendingSpace = undefined;
      output.push(character);
      for (let index = 0; index < character.length; index += 1) {
        rawStarts.push(unit.start); rawEnds.push(unit.end);
      }
    }
  }
  const mapped = output.join('');
  const normalized = normalizeSearchText(raw);
  return mapped === normalized ? { normalized, rawStarts, rawEnds } : { normalized, rawStarts: [], rawEnds: [] };
}

export function findNormalizedSearchRanges(raw: string, term: string): SearchTextRange[] {
  const index = normalizeSearchTextWithMap(raw); const normalizedTerm = normalizeSearchText(term);
  if (!normalizedTerm || !index.rawStarts.length) return [];
  const ranges: SearchTextRange[] = [];
  for (let at = index.normalized.indexOf(normalizedTerm); at >= 0; at = index.normalized.indexOf(normalizedTerm, at + normalizedTerm.length)) {
    const start = index.rawStarts[at]; const end = index.rawEnds[at + normalizedTerm.length - 1];
    if (start === undefined || end === undefined || start >= end) continue;
    const range = { start, end };
    if (normalizeSearchText(raw.slice(start, end)) === normalizedTerm && !ranges.some(previous => range.start < previous.end)) ranges.push(range);
  }
  return ranges;
}

export function tokenizeQuery(query: string): string[] {
  return [...new Set(normalizeSearchText(query).split(' ').filter(Boolean))];
}

export interface QueryClause { source: string; expansions: readonly string[]; conceptKeys: readonly string[] }
const phraseTokens = (value: string): string[] => normalizeSearchText(value).split(' ').filter(Boolean);

/** Groups the longest matching synonym phrases into one AND clause. */
export function buildQueryClauses(query: string, lexicon: RuntimeSearchLexicon): QueryClause[] {
  const tokens = phraseTokens(query);
  const semantics = new Map<string, { expansions: Set<string>; conceptKeys: Set<string> }>();
  const add = (phrase: string, expansions: readonly string[], conceptKeys: readonly string[]) => {
    const normalized = normalizeSearchText(phrase); if (!normalized) return;
    const current = semantics.get(normalized) ?? { expansions: new Set<string>(), conceptKeys: new Set<string>() };
    expansions.map(normalizeSearchText).filter(Boolean).forEach(item => current.expansions.add(item));
    conceptKeys.map(item => item.trim()).filter(Boolean).forEach(item => current.conceptKeys.add(item));
    semantics.set(normalized, current);
  };
  for (const group of lexicon.queryExpansionGroups) for (const alias of group.aliases) add(alias, group.aliases, group.conceptKeys);
  for (const concept of lexicon.concepts) add(concept.labelZh, [concept.labelZh], [concept.key]);
  const aliases = [...semantics].map(([phrase, value]) => ({ phrase, expansions: [...value.expansions].sort(), conceptKeys: [...value.conceptKeys].sort() }))
    .sort((a, b) => phraseTokens(b.phrase).length - phraseTokens(a.phrase).length || a.phrase.localeCompare(b.phrase, 'en'));
  const clauses: QueryClause[] = [];
  for (let index = 0; index < tokens.length;) {
    const match = aliases.find(({ phrase }) => {
      const tokensInPhrase = phraseTokens(phrase);
      return tokensInPhrase.every((token, offset) => tokens[index + offset] === token);
    });
    if (match) {
      clauses.push({ source: match.phrase, expansions: match.expansions, conceptKeys: match.conceptKeys });
      index += phraseTokens(match.phrase).length;
    } else {
      clauses.push({ source: tokens[index]!, expansions: [tokens[index]!], conceptKeys: [] });
      index += 1;
    }
  }
  return clauses;
}

interface IndexedSurface { raw: string; normalized: string; path: SearchFieldPath }
interface IndexFields { names: IndexedSurface[]; effects: IndexedSurface[]; requirements: IndexedSurface[]; synonyms: IndexedSurface[]; concepts: string[] }
function indexWisp(wisp: Wisp): IndexFields {
  const surface = (raw: string, path: SearchFieldPath): IndexedSurface => ({ raw, normalized: normalizeSearchText(raw), path });
  const effects: IndexedSurface[] = [surface(wisp.effects.normal, 'effects.normal')];
  if (wisp.effects.blossom) effects.push(surface(wisp.effects.blossom, 'effects.blossom'));
  if (wisp.effects.prismatic) effects.push(surface(wisp.effects.prismatic, 'effects.prismatic'));
  const requirements = wisp.requirements.flatMap((requirement, index) => {
    const fields = [surface(requirement.textZh, `requirements.${index}.textZh`)];
    if (requirement.textEn) fields.push(surface(requirement.textEn, `requirements.${index}.textEn`));
    return fields;
  });
  return {
    names: [surface(wisp.nameZh, 'nameZh'), surface(wisp.nameEn, 'nameEn')], effects, requirements,
    synonyms: wisp.synonyms.map((alias, index) => surface(alias, `synonyms.${index}`)),
    concepts: wisp.searchConcepts.map(normalizeSearchText),
  };
}

const surfaceMatch = (clauseIndex: number, clause: QueryClause, candidate: IndexedSurface, term: string, score: number, scoreField: SearchField, matchType: 'direct' | 'queryExpansion', exact = false): SearchMatch => ({
  clauseIndex, queryTerm: clause.source, matchedTerm: term, matchType, scoreField, fieldPath: candidate.path, score,
  ranges: exact && candidate.normalized === term ? [{ start: 0, end: candidate.raw.length }] : findNormalizedSearchRanges(candidate.raw, term),
});

function scoreClause(clause: QueryClause, fields: IndexFields, clauseIndex: number): SearchMatch | undefined {
  const { source, expansions } = clause;
  let candidate = fields.names.find(item => item.normalized === source);
  if (candidate) return surfaceMatch(clauseIndex, clause, candidate, source, 1000, 'nameExact', 'direct', true);
  candidate = fields.names.find(item => item.normalized.startsWith(source));
  if (candidate) return surfaceMatch(clauseIndex, clause, candidate, source, 700, 'namePrefix', 'direct');
  candidate = fields.names.find(item => item.normalized.includes(source));
  if (candidate) return surfaceMatch(clauseIndex, clause, candidate, source, 500, 'name', 'direct');
  candidate = fields.effects.find(item => item.normalized.includes(source));
  if (candidate) return surfaceMatch(clauseIndex, clause, candidate, source, 300, 'effect', 'direct');
  candidate = fields.requirements.find(item => item.normalized.includes(source));
  if (candidate) return surfaceMatch(clauseIndex, clause, candidate, source, 220, 'requirement', 'direct');
  candidate = fields.synonyms.find(item => item.normalized.includes(source));
  if (candidate) return surfaceMatch(clauseIndex, clause, candidate, source, 140, 'synonym', 'direct');
  const surfaces = [...fields.names, ...fields.effects, ...fields.requirements, ...fields.synonyms];
  for (const term of expansions.filter(term => term !== source)) {
    candidate = surfaces.find(item => item.normalized.includes(term));
    if (candidate) return surfaceMatch(clauseIndex, clause, candidate, term, 140, 'synonym', 'queryExpansion');
  }
  const conceptSet = new Set(fields.concepts);
  const conceptKey = clause.conceptKeys.find(key => conceptSet.has(normalizeSearchText(key)));
  if (conceptKey) return { clauseIndex, queryTerm: source, matchType: 'concept', scoreField: 'concept', score: 100, ranges: [], conceptKey };
  return undefined;
}

/** Searches without mutating/filtering the caller's Candidate Pool. Query tokens use AND semantics. */
export function searchWisps(pool: readonly Wisp[], query: string, lexicon: RuntimeSearchLexicon): SearchHit[] {
  const clauses = buildQueryClauses(query, lexicon);
  if (!clauses.length) return pool.map((wisp) => ({ wisp, score: 0, matchedFields: [], matches: [] }));
  return pool.flatMap((wisp, order) => {
    const fields = indexWisp(wisp);
    const matches = clauses.map((clause, clauseIndex) => scoreClause(clause, fields, clauseIndex));
    if (matches.some(match => !match)) return [];
    const winningMatches = matches as SearchMatch[];
    const matchedFields = [...new Set(winningMatches.map(match => match.scoreField))];
    // The stable order penalty belongs to the hit, never to an individual clause match.
    return [{ wisp, score: winningMatches.reduce((sum, item) => sum + item.score, 0) - order / 10000, matchedFields, matches: winningMatches }];
  }).sort((a, b) => b.score - a.score);
}
