import type { Wisp } from '../domain/types';

export type SearchField = 'nameExact' | 'namePrefix' | 'name' | 'effect' | 'requirement' | 'synonym' | 'concept';
export interface SearchHit { wisp: Wisp; score: number; matchedFields: readonly SearchField[] }
export type SynonymGroups = readonly (readonly string[])[];

// A deliberately small bootstrap vocabulary. The complete reviewed lexicon is a data-stage deliverable.
export const BASE_SYNONYMS: SynonymGroups = [
  ['生命值', '血量', 'hp'],
  ['阵亡', '死亡'],
  ['刷新', 'reroll', 'roll', 'd'],
  ['经验', 'xp'],
  ['复制器', '妮蔻', 'champion duplicator'],
];

export function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeQuery(query: string): string[] {
  return [...new Set(normalizeSearchText(query).split(' ').filter(Boolean))];
}

function expansionsFor(token: string, groups: SynonymGroups): string[] {
  const group = groups.find((items) => items.some((item) => normalizeSearchText(item) === token));
  return group ? [...new Set(group.map(normalizeSearchText).filter(Boolean))] : [token];
}

interface IndexFields { names: string[]; effects: string[]; requirements: string[]; synonyms: string[]; concepts: string[] }
function indexWisp(wisp: Wisp): IndexFields {
  return {
    names: [wisp.nameZh, wisp.nameEn].map(normalizeSearchText),
    effects: [wisp.effects.normal, wisp.effects.blossom, wisp.effects.prismatic].filter((v): v is string => Boolean(v)).map(normalizeSearchText),
    requirements: wisp.requirements.flatMap((r) => [r.textZh, r.textEn].filter((v): v is string => Boolean(v))).map(normalizeSearchText),
    synonyms: wisp.synonyms.map(normalizeSearchText),
    concepts: wisp.searchConcepts.map(normalizeSearchText),
  };
}

function scoreToken(token: string, expanded: readonly string[], fields: IndexFields): { score: number; field?: SearchField } {
  if (fields.names.includes(token)) return { score: 1000, field: 'nameExact' };
  if (fields.names.some((name) => name.startsWith(token))) return { score: 700, field: 'namePrefix' };
  if (fields.names.some((name) => name.includes(token))) return { score: 500, field: 'name' };
  if (expanded.some((term) => fields.effects.some((text) => text.includes(term)))) return { score: 300, field: 'effect' };
  if (expanded.some((term) => fields.requirements.some((text) => text.includes(term)))) return { score: 220, field: 'requirement' };
  if (expanded.some((term) => fields.synonyms.some((text) => text.includes(term)))) return { score: 140, field: 'synonym' };
  if (expanded.some((term) => fields.concepts.some((text) => text.includes(term)))) return { score: 100, field: 'concept' };
  return { score: 0 };
}

/** Searches without mutating/filtering the caller's Candidate Pool. Query tokens use AND semantics. */
export function searchWisps(pool: readonly Wisp[], query: string, synonymGroups: SynonymGroups = BASE_SYNONYMS): SearchHit[] {
  const tokens = tokenizeQuery(query);
  if (!tokens.length) return pool.map((wisp) => ({ wisp, score: 0, matchedFields: [] }));
  return pool.flatMap((wisp, order) => {
    const fields = indexWisp(wisp);
    const matches = tokens.map((token) => scoreToken(token, expansionsFor(token, synonymGroups), fields));
    if (matches.some(({ score }) => score === 0)) return [];
    const matchedFields = [...new Set(matches.flatMap(({ field }) => field ? [field] : []))];
    return [{ wisp, score: matches.reduce((sum, item) => sum + item.score, 0) - order / 10000, matchedFields }];
  }).sort((a, b) => b.score - a.score);
}
