export type CatalogDeltaClassification =
  | 'existing_base_identity_already_in_production'
  | 'missing_base_identity_candidate'
  | 'upgrade_or_variant_of_base_identity'
  | 'renamed_or_relocalized_existing_identity'
  | 'obsolete_or_non_base_catalog_row'
  | 'unresolved';

export interface CatalogRow { sourceIndex: number; nameEn?: string; nameZh?: string; stableIdentity?: string }
export interface ClientIdentity { apiName: string; name: string; nameZh?: string }
export interface ProductionIdentity { id: string; riotId?: string; nameEn?: string; nameZh?: string }
export interface ReviewedIdentityMapping { productionId: string; communityDragonId?: string | null; canonicalNameEn?: string | null; dataTftNameZh?: string | null }
export interface ClassifiedDeltaRow { affectsC4Cluster?: string | null; classification: CatalogDeltaClassification; communityDragon?: { baseApiName?: string | null } }

export const normalizeCatalogName = (value: unknown) => String(value ?? '').normalize('NFKD').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\p{L}\p{N}]/gu, '');
const zhKey = (row: CatalogRow) => normalizeCatalogName(row.nameZh);
const counts = (rows: CatalogRow[]) => rows.reduce((map, row) => map.set(zhKey(row), (map.get(zhKey(row)) ?? 0) + 1), new Map<string, number>());
const sameSharedNames = (left: CatalogRow, right: CatalogRow) => Boolean(left.nameZh && right.nameZh && zhKey(left) === zhKey(right));

/** Aligns identities without ever treating the rendered ordinal as an ID. */
export function alignCatalogRows(oldRows: CatalogRow[], freshRows: CatalogRow[]) {
  const oldNameCounts = counts(oldRows); const freshNameCounts = counts(freshRows);
  const claimedFresh = new Set<number>(); const ambiguousFreshIndices = new Set<number>();
  const mappings = oldRows.map((oldRow) => {
    const stableCandidates = oldRow.stableIdentity ? freshRows.filter((row) => row.stableIdentity === oldRow.stableIdentity) : [];
    const nameCandidates = freshRows.filter((row) => sameSharedNames(oldRow, row));
    const namedIsUnique = Boolean(zhKey(oldRow) && oldNameCounts.get(zhKey(oldRow)) === 1 && freshNameCounts.get(zhKey(oldRow)) === 1);
    const matched = stableCandidates.length === 1 ? stableCandidates[0] : namedIsUnique ? nameCandidates[0] : undefined;
    if (!matched && (stableCandidates.length > 1 || nameCandidates.length > 1 || (nameCandidates.length === 1 && !namedIsUnique))) {
      const candidates = [...new Set([...stableCandidates, ...nameCandidates].map((row) => row.sourceIndex))].sort((a, b) => a - b);
      candidates.forEach((index) => ambiguousFreshIndices.add(index));
      return { status: 'ambiguous' as const, oldIndex: oldRow.sourceIndex, freshIndex: null, candidateFreshIndices: candidates, evidence: ['Name-only alignment rejected because the normalized shared-locale key is not unique in both catalogs.'] };
    }
    if (!matched || claimedFresh.has(matched.sourceIndex)) return { status: 'old_only' as const, oldIndex: oldRow.sourceIndex, freshIndex: null, evidence: ['No unique, unclaimed stable-identity or shared-locale display-name match.'] };
    claimedFresh.add(matched.sourceIndex);
    const renamed = stableCandidates.length === 1 && !sameSharedNames(oldRow, matched);
    return {
      status: renamed ? 'renamed' as const : oldRow.sourceIndex === matched.sourceIndex ? 'unchanged' as const : 'shifted' as const,
      oldIndex: oldRow.sourceIndex, freshIndex: matched.sourceIndex,
      evidence: stableCandidates.length === 1 ? [`Unique stable client/source identity ${oldRow.stableIdentity} matches.`] : ['Normalized Chinese display-name key is unique in both old and fresh catalogs and matches exactly.'],
    };
  });
  const ambiguousFresh = freshRows.filter((row) => ambiguousFreshIndices.has(row.sourceIndex));
  const freshOnly = freshRows.filter((row) => !claimedFresh.has(row.sourceIndex) && !ambiguousFreshIndices.has(row.sourceIndex));
  const uniqueOldKeys = [...oldNameCounts.values()].filter((value) => value === 1).length;
  const uniqueFreshKeys = [...freshNameCounts.values()].filter((value) => value === 1).length;
  return {
    mappings, freshOnly, ambiguousFresh,
    sharedLocaleNameUniqueness: { locale: 'zh', oldUniqueKeys: uniqueOldKeys, oldRowCount: oldRows.length, freshUniqueKeys: uniqueFreshKeys, freshRowCount: freshRows.length, allOldKeysUnique: uniqueOldKeys === oldRows.length, allFreshKeysUnique: uniqueFreshKeys === freshRows.length },
    summary: {
      unchangedRows: mappings.filter((row) => row.status === 'unchanged').length,
      renamedRows: mappings.filter((row) => row.status === 'renamed').length,
      shiftedRows: mappings.filter((row) => row.status === 'shifted').length,
      oldOnlyRows: mappings.filter((row) => row.status === 'old_only').length,
      freshOnlyRows: freshOnly.length,
      ambiguousRows: mappings.filter((row) => row.status === 'ambiguous').length + ambiguousFresh.length,
    },
  };
}

export function clientFamily(apiName: string) { return apiName.replace(/_(?:Upgrade|Prismatic)$/i, ''); }
export function isVariantApiName(apiName: string) { return /_(?:Upgrade|Prismatic)$/i.test(apiName); }

export function classifyCatalogRow(row: CatalogRow, clients: ClientIdentity[], production: ProductionIdentity[], reviewedMappings: ReviewedIdentityMapping[] = []) {
  const name = normalizeCatalogName(row.nameEn ?? row.nameZh);
  const matchingClients = clients.filter((item) => normalizeCatalogName(item.name) === name && (!row.nameZh || !item.nameZh || normalizeCatalogName(item.nameZh) === normalizeCatalogName(row.nameZh)));
  if (!matchingClients.length) return { classification: 'unresolved' as const, baseIdentityKey: null, productionMatches: [], reviewedMappingMatches: [] };
  const bases = matchingClients.filter((item) => !isVariantApiName(item.apiName));
  const client = matchingClients.length === 1 ? matchingClients[0]! : bases.length === 1 ? bases[0]! : undefined;
  if (!client) return { classification: 'unresolved' as const, baseIdentityKey: null, productionMatches: [], reviewedMappingMatches: [] };
  const family = clientFamily(client.apiName);
  const reviewedMappingMatches = reviewedMappings.filter((mapping) =>
    normalizeCatalogName(mapping.communityDragonId) === normalizeCatalogName(family)
    || normalizeCatalogName(mapping.communityDragonId) === normalizeCatalogName(client.apiName),
  ).map((mapping) => mapping.productionId).filter((id) => production.some((item) => item.id === id));
  const directMatches = production.filter((item) =>
    normalizeCatalogName(item.riotId) === normalizeCatalogName(family)
    || normalizeCatalogName(item.nameEn) === name
    || normalizeCatalogName(item.nameZh) === normalizeCatalogName(row.nameZh),
  ).map((item) => item.id);
  const productionMatches = [...new Set([...directMatches, ...reviewedMappingMatches])].sort((a, b) => a.localeCompare(b, 'en'));
  if (isVariantApiName(client.apiName)) return { classification: 'upgrade_or_variant_of_base_identity' as const, baseIdentityKey: family, client, productionMatches, reviewedMappingMatches };
  return { classification: productionMatches.length ? 'existing_base_identity_already_in_production' as const : 'missing_base_identity_candidate' as const, baseIdentityKey: family, client, productionMatches, reviewedMappingMatches };
}

export function deriveC4PriorityImpact(clusterId: string, sourceIdentity: string, mappings: Array<{ oldIndex: number; freshIndex: number | null; status: string }>, changedRows: ClassifiedDeltaRow[]) {
  if (clusterId === 'C4I-001') {
    const continuity = mappings.find((row) => row.oldIndex === 139);
    if (continuity?.status === 'unchanged' && continuity.freshIndex === 139) return { impact: 'supported' as const, note: 'Old Chinese row 139 maps uniquely to fresh Chinese row 139, preserving the A2 same-source continuity premise.' };
    if (continuity && ['shifted', 'renamed', 'old_only'].includes(continuity.status)) return { impact: 'weakened' as const, note: `A2 row-139 continuity is no longer exact (${continuity.status}).` };
    return { impact: 'unresolved' as const, note: 'No exact old-row-139 to fresh-row-139 continuity mapping is established.' };
  }
  const row = changedRows.find((item) => item.affectsC4Cluster === clusterId);
  if (!row || row.classification === 'unresolved' || !row.communityDragon?.baseApiName) return { impact: 'unresolved' as const, note: `No resolved fresh-only base row currently supports ${sourceIdentity}.` };
  if (row.classification === 'existing_base_identity_already_in_production') return { impact: 'weakened' as const, note: 'A reviewed or direct production target contradicts the A2 missing-production hypothesis.' };
  if (row.classification === 'missing_base_identity_candidate' && !isVariantApiName(row.communityDragon.baseApiName)) return { impact: 'supported' as const, note: 'A corresponding fresh-only row resolves to an unsuffixed client base and remains absent from production after reviewed-mapping checks.' };
  return { impact: 'unresolved' as const, note: `Classification ${row.classification} does not support the A2 missing-production hypothesis.` };
}
