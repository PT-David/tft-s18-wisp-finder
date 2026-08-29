export type MatchMethod = 'exact_client_key' | 'exact_english_name' | 'exact_chinese_name' | 'reviewed_alias';

export interface ReconcileRecord {
  id: string; riotId?: string | null; nameEn: string; nameZh: string; category?: string; cost?: number;
  effect?: string;
}
export interface OpggRecord { sourceKey?: string; name?: string; category?: string; cost?: number; effect?: string; appearanceCondition?: string }
export interface ClientRecord { apiName: string; name?: string }

export const clientVariantKind = (apiName: string): 'base' | 'upgrade' | 'prismatic' =>
  /prismatic/i.test(apiName) ? 'prismatic' : /upgrade/i.test(apiName) ? 'upgrade' : 'base';

/**
 * Riot Wisp ids use DA_, an optional 18_ namespace, and an optional trailing
 * set number around a stable key (for example DA_18_Mitosis or DA_Hireling18).
 * Variant markers are deliberately rejected before normalization.
 */
export function canonicalClientKey(value: unknown): string | null {
  const raw = String(value ?? '');
  if (!raw || clientVariantKind(raw) !== 'base') return null;
  const normalized = raw.toLowerCase().replace(/^da_/, '').replace(/^18_/, '').replace(/18$/, '').replace(/[^a-z0-9]/g, '');
  return normalized || null;
}

const normalizedName = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]/gu, '');
const bigrams = (value: unknown) => { const clean = normalizedName(value); return new Set([...clean].slice(0, -1).map((char, index) => char + clean[index + 1])); };
const similarity = (a: unknown, b: unknown) => { const left = bigrams(a); const right = bigrams(b); const overlap = [...left].filter((item) => right.has(item)).length; return left.size + right.size ? (2 * overlap) / (left.size + right.size) : 0; };
const uniqueIndex = <T>(values: T[], key: (value: T) => string | null) => {
  const groups = new Map<string, T[]>();
  for (const value of values) { const id = key(value); if (id) groups.set(id, [...(groups.get(id) ?? []), value]); }
  return new Map([...groups].filter(([, rows]) => rows.length === 1).map(([id, rows]) => [id, rows[0]!]));
};

export function reconcileRecords(opgg: OpggRecord[], production: ReconcileRecord[], client: ClientRecord[], reviewedAliases: Record<string, string> = {}) {
  const clientBases = client.filter(({ apiName }) => clientVariantKind(apiName) === 'base');
  const clientByKey = uniqueIndex(clientBases, ({ apiName }) => canonicalClientKey(apiName));
  const productionByClient = uniqueIndex(production.filter(({ riotId }) => riotId), ({ riotId }) => canonicalClientKey(riotId));
  const english = uniqueIndex(production, ({ nameEn }) => normalizedName(nameEn));
  const chinese = uniqueIndex(production, ({ nameZh }) => normalizedName(nameZh));
  const productionById = new Map(production.map((row) => [row.id, row]));
  const confirmedMatches: Array<Record<string, unknown>> = [];
  const matchedOpgg = new Set<number>(); const matchedProduction = new Set<string>();
  const confirm = (index: number, row: ReconcileRecord | undefined, method: MatchMethod, evidence: Record<string, unknown>) => {
    if (!row || matchedOpgg.has(index) || matchedProduction.has(row.id)) return;
    const source = opgg[index]!; matchedOpgg.add(index); matchedProduction.add(row.id);
    confirmedMatches.push({ opggSourceKey: source.sourceKey, opggName: source.name, productionId: row.id, nameZh: row.nameZh, nameEn: row.nameEn, matchMethod: method, evidence, confidence: 'confirmed' });
  };
  opgg.forEach((row, index) => { const key = canonicalClientKey(row.sourceKey); const clientRow = key ? clientByKey.get(key) : undefined; if (clientRow) confirm(index, productionByClient.get(key!), 'exact_client_key', { canonicalClientKey: key, communityDragonApiName: clientRow.apiName, variantKind: 'base' }); });
  opgg.forEach((row, index) => confirm(index, english.get(normalizedName(row.sourceKey)), 'exact_english_name', { normalizedEnglishName: normalizedName(row.sourceKey), unique: true }));
  opgg.forEach((row, index) => confirm(index, chinese.get(normalizedName(row.name)), 'exact_chinese_name', { normalizedChineseName: normalizedName(row.name), unique: true }));
  opgg.forEach((row, index) => confirm(index, productionById.get(reviewedAliases[String(row.sourceKey)] ?? ''), 'reviewed_alias', { aliasTableKey: row.sourceKey, reviewed: true }));

  const remainingProduction = production.filter(({ id }) => !matchedProduction.has(id));
  const candidateMatches = opgg.flatMap((row, index) => {
    if (matchedOpgg.has(index)) return [];
    const candidates = remainingProduction.map((candidate) => {
      const effectSimilarity = similarity(row.effect, candidate.effect); const nameSimilarity = Math.max(similarity(row.sourceKey, candidate.nameEn), similarity(row.name, candidate.nameZh));
      const categoryMatch = String(row.category).toLowerCase().replace('goldxp', 'gold_xp') === candidate.category;
      const costMatch = row.cost === candidate.cost;
      return { productionId: candidate.id, nameEn: candidate.nameEn, nameZh: candidate.nameZh, effect: candidate.effect, category: candidate.category, cost: candidate.cost, score: effectSimilarity + nameSimilarity * .25 + (categoryMatch ? .15 : 0) + (costMatch ? .1 : 0), effectSimilarity, nameSimilarity, categoryMatch, costMatch };
    }).sort((a, b) => b.score - a.score || a.productionId.localeCompare(b.productionId)).slice(0, 3);
    const margin = candidates.length > 1 ? candidates[0]!.score - candidates[1]!.score : null;
    return [{ opggRecord: row, topCandidates: candidates, bestVsSecondMargin: margin, status: margin !== null && margin < .1 ? 'ambiguous' : 'candidate', reasonNotConfirmed: 'Similarity, category, cost, and appearance requirements are discovery evidence only; no strong identity or reviewed alias exists.' }];
  });
  const ambiguous = candidateMatches.filter(({ status }) => status === 'ambiguous');
  const unresolved = candidateMatches.filter(({ topCandidates }) => !topCandidates.length || topCandidates[0]!.score < .5);
  return { confirmedMatches, candidateMatches, ambiguous, unresolved, matchedOpgg, matchedProduction, clientByKey };
}
