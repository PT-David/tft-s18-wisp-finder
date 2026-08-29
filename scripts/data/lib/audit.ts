export type RequirementFact = { type: string; operator?: string; value?: number | boolean };
type RequirementAuditRow = { identity: string; [key: string]: unknown };

export function confirmedCorpusMinimum(productionCount: number, unmatchedProductionCount: number, confirmedIncompleteExternalCount: number): number {
  return productionCount + Math.max(0, confirmedIncompleteExternalCount - unmatchedProductionCount);
}

export function requirementFacts(values: unknown): RequirementFact[] {
  const joined = (Array.isArray(values) ? values : []).map((value) => typeof value === 'string' ? value : String((value as Record<string, unknown>).textEn ?? (value as Record<string, unknown>).textZh ?? '')).join('; ').toLowerCase();
  const facts: RequirementFact[] = [];
  const addMatches = (type: string, patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = joined.match(pattern);
      if (match) { facts.push({ type, operator: '>=', value: Number(match[1]) }); break; }
    }
  };
  addMatches('gold', [/(?:at least\s*)?(\d+)\s*gold\b/i, /(?:至少拥有?\s*)?(\d+)\s*金币/i]);
  addMatches('player_health', [/(?:at least\s*)?(\d+)\s*(?:player\s*)?(?:health|hp)\b/i, /生命值(?:至少|高于)?\s*(\d+)/i, /(?:至少拥有?\s*)?(\d+)\s*(?:玩家)?生命值/i]);
  addMatches('level', [/(?:level|等级(?:达到)?)\s*(\d+)/i]);
  addMatches('board_count', [/(?:at least|至少|不少于)\s*(\d+)\s*(?:[^;]{0,20})(?:on board|在场|弈子)/i]);
  if (/(?:trait active|羁绊.*激活|激活.*羁绊)/i.test(joined)) facts.push({ type: 'trait_active', value: true });
  return facts;
}

export function requirementsManualReview(presenceConflict: RequirementAuditRow[], structuredConflict: RequirementAuditRow[], semanticReviewRequired: RequirementAuditRow[]) {
  const byIdentity = new Map<string, { row: RequirementAuditRow; reviewReasons: string[] }>();
  const add = (rows: RequirementAuditRow[], reason: string) => rows.forEach((row) => {
    const item = byIdentity.get(row.identity) ?? { row, reviewReasons: [] };
    if (!item.reviewReasons.includes(reason)) item.reviewReasons.push(reason);
    byIdentity.set(row.identity, item);
  });
  add(presenceConflict, 'presence_conflict');
  add(structuredConflict, 'structured_conflict');
  add(semanticReviewRequired, 'semantic_review_required');
  return [...byIdentity.values()];
}
