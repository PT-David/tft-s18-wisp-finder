import type { Wisp } from '../domain/types';

export type SearchField = 'nameExact' | 'namePrefix' | 'name' | 'effect' | 'requirement' | 'synonym' | 'concept';
export interface SearchHit { wisp: Wisp; score: number; matchedFields: readonly SearchField[] }
export type SynonymGroups = readonly (readonly string[])[];

// A deliberately small bootstrap vocabulary. The complete reviewed lexicon is a data-stage deliverable.
export const BASE_SYNONYMS: SynonymGroups = [
  ['生命值', '血量', 'hp', 'health'],
  ['阵亡', '死亡'],
  ['击杀', 'takedown'],
  ['刷新', '重随', 'reroll'],
  ['经验', '经验值', 'xp', 'experience'],
  ['复制器', '英雄复制器', 'champion duplicator'],
  ['法术强度', '法强'],
  ['攻击速度', '攻速'],
  ['真实伤害', '真伤'],
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

export interface QueryClause { source: string; expansions: readonly string[] }
const phraseTokens = (value: string): string[] => normalizeSearchText(value).split(' ').filter(Boolean);

/** Groups the longest matching synonym phrases into one AND clause. */
export function buildQueryClauses(query: string, groups: SynonymGroups = BASE_SYNONYMS): QueryClause[] {
  const tokens = phraseTokens(query);
  const aliases = groups.flatMap((group) => group.map((item) => ({
    phrase: normalizeSearchText(item), group: [...new Set(group.map(normalizeSearchText).filter(Boolean))],
  }))).sort((a, b) => phraseTokens(b.phrase).length - phraseTokens(a.phrase).length);
  const clauses: QueryClause[] = [];
  for (let index = 0; index < tokens.length;) {
    const match = aliases.find(({ phrase }) => {
      const tokensInPhrase = phraseTokens(phrase);
      return tokensInPhrase.every((token, offset) => tokens[index + offset] === token);
    });
    if (match) {
      clauses.push({ source: match.phrase, expansions: match.group });
      index += phraseTokens(match.phrase).length;
    } else {
      clauses.push({ source: tokens[index]!, expansions: [tokens[index]!] });
      index += 1;
    }
  }
  return clauses;
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

function scoreClause(clause: QueryClause, fields: IndexFields): { score: number; field?: SearchField } {
  const { source, expansions } = clause;
  if (fields.names.includes(source)) return { score: 1000, field: 'nameExact' };
  if (fields.names.some((name) => name.startsWith(source))) return { score: 700, field: 'namePrefix' };
  if (fields.names.some((name) => name.includes(source))) return { score: 500, field: 'name' };
  if (fields.effects.some((text) => text.includes(source))) return { score: 300, field: 'effect' };
  if (fields.requirements.some((text) => text.includes(source))) return { score: 220, field: 'requirement' };
  if (fields.synonyms.some((text) => text.includes(source))) return { score: 140, field: 'synonym' };
  if (fields.concepts.some((text) => text.includes(source))) return { score: 100, field: 'concept' };
  const alternatives = expansions.filter((term) => term !== source);
  if (alternatives.some((term) => [...fields.names, ...fields.effects, ...fields.requirements, ...fields.synonyms].some((text) => text.includes(term)))) return { score: 140, field: 'synonym' };
  if (alternatives.some((term) => fields.concepts.some((text) => text.includes(term)))) return { score: 100, field: 'concept' };
  return { score: 0 };
}

/** Searches without mutating/filtering the caller's Candidate Pool. Query tokens use AND semantics. */
export function searchWisps(pool: readonly Wisp[], query: string, synonymGroups: SynonymGroups = BASE_SYNONYMS): SearchHit[] {
  const clauses = buildQueryClauses(query, synonymGroups);
  if (!clauses.length) return pool.map((wisp) => ({ wisp, score: 0, matchedFields: [] }));
  return pool.flatMap((wisp, order) => {
    const fields = indexWisp(wisp);
    const matches = clauses.map((clause) => scoreClause(clause, fields));
    if (matches.some(({ score }) => score === 0)) return [];
    const matchedFields = [...new Set(matches.flatMap(({ field }) => field ? [field] : []))];
    return [{ wisp, score: matches.reduce((sum, item) => sum + item.score, 0) - order / 10000, matchedFields }];
  }).sort((a, b) => b.score - a.score);
}
