export type MatchMethod = 'exact_client_key' | 'exact_english_name' | 'exact_chinese_name' | 'reviewed_cross_source_identity';

export interface ReconcileRecord {
  id: string; riotId?: string | null; nameEn: string; nameZh: string; category?: string; cost?: number;
  effect?: string;
}
export interface OpggRecord { sourceKey?: string; name?: string; category?: string; cost?: number; effect?: string; appearanceCondition?: string }
export interface ClientRecord { apiName: string; name?: string; desc?: unknown; effects?: unknown; tags?: unknown; icon?: unknown; [key: string]: unknown }

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

const stableValue = (value: unknown): unknown => Array.isArray(value) ? value.map(stableValue) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stableValue(child)])) : value;
const stableJson = (value: unknown) => JSON.stringify(stableValue(value));
const hashPayload = (value: unknown) => {
  // A deterministic non-cryptographic audit fingerprint; identity safety is
  // decided from the full stable payload string, never from this hash alone.
  let hash = 2166136261;
  for (const char of stableJson(value)) { hash ^= char.codePointAt(0)!; hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export function auditAndDeduplicateClientRecords(records: ClientRecord[]) {
  const byApiName = new Map<string, ClientRecord[]>();
  for (const record of records) byApiName.set(record.apiName, [...(byApiName.get(record.apiName) ?? []), record]);
  const safeRecords: ClientRecord[] = []; const blockedApiNames = new Set<string>();
  const duplicateGroups: Array<Record<string, unknown>> = [];
  for (const [apiName, rows] of byApiName) {
    if (rows.length === 1) { safeRecords.push(rows[0]!); continue; }
    const rawPayloads = rows.map((row) => JSON.stringify(row));
    const stablePayloads = rows.map(stableJson);
    const payloadStatus = new Set(rawPayloads).size === 1 ? 'exact_duplicate' : new Set(stablePayloads).size === 1 ? 'equivalent_duplicate' : 'conflicting_duplicate';
    const safe = payloadStatus !== 'conflicting_duplicate';
    if (safe) safeRecords.push(rows[0]!); else blockedApiNames.add(apiName);
    duplicateGroups.push({ apiName, count: rows.length, kind: clientVariantKind(apiName), payloadStatus, hashes: stablePayloads.map((payload) => hashPayload(payload)), records: rows, ...(safe ? { chosenCanonicalRow: rows[0] } : { status: 'needs_review' }) });
  }
  const safeBases = safeRecords.filter(({ apiName }) => clientVariantKind(apiName) === 'base');
  const canonicalGroups = new Map<string, ClientRecord[]>();
  for (const record of safeBases) { const key = canonicalClientKey(record.apiName); if (key) canonicalGroups.set(key, [...(canonicalGroups.get(key) ?? []), record]); }
  const canonicalCollisions = [...canonicalGroups].filter(([, rows]) => new Set(rows.map(({ apiName }) => apiName)).size > 1).map(([canonicalKey, rows]) => ({ canonicalKey, rawApiNames: rows.map(({ apiName }) => apiName), records: rows, status: 'needs_review' }));
  const collisionKeys = new Set(canonicalCollisions.map(({ canonicalKey }) => canonicalKey));
  const baseIdentityIndex = new Map([...canonicalGroups].filter(([key, rows]) => !collisionKeys.has(key) && rows.length === 1).map(([key, rows]) => [key, rows[0]!]));
  const countKind = (kind: 'base' | 'upgrade' | 'prismatic', source = records) => source.filter(({ apiName }) => clientVariantKind(apiName) === kind).length;
  const uniqueByKind = (kind: 'base' | 'upgrade' | 'prismatic') => new Set(safeRecords.filter(({ apiName }) => clientVariantKind(apiName) === kind).map(({ apiName }) => apiName)).size;
  const audit = {
    rawRecordCount: records.length, rawBaseRows: countKind('base'), rawUpgradeRows: countKind('upgrade'), rawPrismaticRows: countKind('prismatic'),
    uniqueApiNames: byApiName.size, uniqueBaseApiNames: uniqueByKind('base'), uniqueUpgradeApiNames: uniqueByKind('upgrade'), uniquePrismaticApiNames: uniqueByKind('prismatic'), uniqueCanonicalBaseIdentities: baseIdentityIndex.size,
    duplicateGroups, canonicalCollisions, exactDuplicateGroupCount: duplicateGroups.filter(({ payloadStatus }) => payloadStatus === 'exact_duplicate').length,
    equivalentDuplicateGroupCount: duplicateGroups.filter(({ payloadStatus }) => payloadStatus === 'equivalent_duplicate').length,
    conflictingDuplicateGroupCount: duplicateGroups.filter(({ payloadStatus }) => payloadStatus === 'conflicting_duplicate').length,
    canonicalCollisionCount: canonicalCollisions.length, safelyDeduplicatedRowCount: duplicateGroups.filter(({ payloadStatus }) => payloadStatus !== 'conflicting_duplicate').reduce((sum, group) => sum + Number(group.count) - 1, 0), blockedApiNames: [...blockedApiNames],
  };
  return { safeRecords, baseIdentityIndex, audit };
}

export function reconcileRecords(opgg: OpggRecord[], production: ReconcileRecord[], client: ClientRecord[], reviewedAliases: Record<string, string> = {}) {
  const clientLayer = auditAndDeduplicateClientRecords(client);
  const clientByKey = clientLayer.baseIdentityIndex;
  const productionByClient = uniqueIndex(production.filter(({ riotId }) => riotId), ({ riotId }) => canonicalClientKey(riotId));
  const opggByClient = uniqueIndex(opgg, ({ sourceKey }) => canonicalClientKey(sourceKey));
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
  for (const [key, clientRow] of clientByKey) {
    const source = opggByClient.get(key); const target = productionByClient.get(key);
    if (source && target) confirm(opgg.indexOf(source), target, 'exact_client_key', { canonicalClientKey: key, communityDragonApiName: clientRow.apiName, variantKind: 'base' });
  }
  opgg.forEach((row, index) => confirm(index, english.get(normalizedName(row.sourceKey)), 'exact_english_name', { normalizedEnglishName: normalizedName(row.sourceKey), unique: true }));
  opgg.forEach((row, index) => confirm(index, chinese.get(normalizedName(row.name)), 'exact_chinese_name', { normalizedChineseName: normalizedName(row.name), unique: true }));
  opgg.forEach((row, index) => confirm(index, productionById.get(reviewedAliases[String(row.sourceKey)] ?? ''), 'reviewed_cross_source_identity', { mappingTableKey: row.sourceKey, reviewed: true }));

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
  return { confirmedMatches, candidateMatches, ambiguous, unresolved, matchedOpgg, matchedProduction, clientByKey, clientAudit: clientLayer.audit };
}
