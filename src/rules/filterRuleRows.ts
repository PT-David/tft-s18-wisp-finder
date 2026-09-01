import type { WispCategory } from '../domain/types';
import { normalizeSearchText } from '../search/searchEngine';
import type { WispRuleRow } from './rulePageModel';

export interface RuleIndexFilter {
  query: string;
  category?: WispCategory;
  specialOnly: boolean;
}

export function filterRuleRows(rows: readonly WispRuleRow[], filter: RuleIndexFilter): readonly WispRuleRow[] {
  const query = normalizeSearchText(filter.query);
  return rows.filter((row) => {
    const nameMatches = !query || normalizeSearchText(row.nameZh).includes(query) || normalizeSearchText(row.nameEn).includes(query);
    return nameMatches && (!filter.category || row.category === filter.category) && (!filter.specialOnly || row.hasSpecialRules);
  });
}
