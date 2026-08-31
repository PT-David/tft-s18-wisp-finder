import type { RuntimeSearchLexicon, Wisp } from '../domain/types';
import type { SearchFieldPath, SearchMatch, SearchMatchType } from '../search/searchEngine';

export interface SearchMatchReasonView {
  matchType: SearchMatchType;
  text: string;
}

const fieldLabel = (path: SearchFieldPath | undefined): string => {
  if (path === 'nameZh') return '中文名';
  if (path === 'nameEn') return '英文名';
  if (path === 'effects.normal') return '普通';
  if (path === 'effects.blossom') return 'Blossom';
  if (path === 'effects.prismatic') return 'Prismatic';
  if (path?.startsWith('requirements.')) return '条件';
  if (path?.startsWith('synonyms.')) return '别名';
  return '匹配';
};

/** Reads the exact source field identified by structured search metadata. */
export function readSearchField(wisp: Wisp, path: SearchFieldPath | undefined): string | undefined {
  if (path === 'nameZh' || path === 'nameEn') return wisp[path];
  if (path === 'effects.normal') return wisp.effects.normal;
  if (path === 'effects.blossom') return wisp.effects.blossom ?? undefined;
  if (path === 'effects.prismatic') return wisp.effects.prismatic ?? undefined;
  const requirement = path?.match(/^requirements\.(\d+)\.(textZh|textEn)$/);
  if (requirement) return wisp.requirements[Number(requirement[1])]?.[requirement[2] as 'textZh' | 'textEn'];
  const alias = path?.match(/^synonyms\.(\d+)$/);
  if (alias) return wisp.synonyms[Number(alias[1])];
  return undefined;
}

export function toSearchMatchReasonView(wisp: Wisp, match: SearchMatch, lexicon: RuntimeSearchLexicon): SearchMatchReasonView {
  if (match.matchType === 'concept') {
    const label = lexicon.concepts.find(({ key }) => key === match.conceptKey)?.labelZh ?? match.queryTerm;
    return { matchType: match.matchType, text: `概念：${label}` };
  }

  const raw = readSearchField(wisp, match.fieldPath);
  const first = match.ranges[0];
  const rangedText = raw !== undefined && first && first.start >= 0 && first.end > first.start && first.end <= raw.length
    ? raw.slice(first.start, first.end)
    : undefined;
  const surface = rangedText || match.matchedTerm || match.queryTerm;
  const prefix = match.matchType === 'queryExpansion' ? '同义·' : '';
  return { matchType: match.matchType, text: `${prefix}${fieldLabel(match.fieldPath)}：${surface}` };
}
