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

export const normalizeCatalogName = (value: unknown) => String(value ?? '').normalize('NFKD').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\p{L}\p{N}]/gu, '');

const sameNames = (left: CatalogRow, right: CatalogRow) => {
  const comparable = (['nameEn', 'nameZh'] as const).filter((key) => left[key] && right[key]);
  return comparable.length > 0 && comparable.every((key) => normalizeCatalogName(left[key]) === normalizeCatalogName(right[key]));
};

/** Aligns identities without ever treating the rendered ordinal as an ID. */
export function alignCatalogRows(oldRows: CatalogRow[], freshRows: CatalogRow[]) {
  const claimedFresh = new Set<number>();
  const mappings = oldRows.map((oldRow) => {
    const stable = oldRow.stableIdentity && freshRows.find((row) => !claimedFresh.has(row.sourceIndex) && row.stableIdentity === oldRow.stableIdentity);
    const named = stable ?? freshRows.find((row) => !claimedFresh.has(row.sourceIndex) && sameNames(oldRow, row));
    if (!named) return { status: 'old_only' as const, oldIndex: oldRow.sourceIndex, freshIndex: null, evidence: ['No unclaimed stable-identity, bilingual-name, or normalized-name match.'] };
    claimedFresh.add(named.sourceIndex);
    const renamed = Boolean(stable && !sameNames(oldRow, named));
    return { status: renamed ? 'renamed' as const : oldRow.sourceIndex === named.sourceIndex ? 'unchanged' as const : 'shifted' as const, oldIndex: oldRow.sourceIndex, freshIndex: named.sourceIndex, evidence: stable ? [`Stable client/source identity ${oldRow.stableIdentity} matches.`] : ['Exact bilingual/normalized display-name relation matches.'] };
  });
  const freshOnly = freshRows.filter((row) => !claimedFresh.has(row.sourceIndex));
  return { mappings, freshOnly, summary: { unchangedRows: mappings.filter((row) => row.status === 'unchanged').length, renamedRows: mappings.filter((row) => row.status === 'renamed').length, shiftedRows: mappings.filter((row) => row.status === 'shifted').length, oldOnlyRows: mappings.filter((row) => row.status === 'old_only').length, freshOnlyRows: freshOnly.length } };
}

export function clientFamily(apiName: string) { return apiName.replace(/_(?:Upgrade|Prismatic)$/i, ''); }
export function isVariantApiName(apiName: string) { return /_(?:Upgrade|Prismatic)$/i.test(apiName); }

export function classifyCatalogRow(row: CatalogRow, clients: ClientIdentity[], production: ProductionIdentity[]): { classification: CatalogDeltaClassification; baseIdentityKey: string | null; client?: ClientIdentity; productionMatches: string[] } {
  const name = normalizeCatalogName(row.nameEn ?? row.nameZh);
  const matchingClients = clients.filter((item) => normalizeCatalogName(item.name) === name && (!row.nameZh || !item.nameZh || normalizeCatalogName(item.nameZh) === normalizeCatalogName(row.nameZh)));
  if (!matchingClients.length) return { classification: 'unresolved', baseIdentityKey: null, productionMatches: [] };
  // Client data commonly gives base and upgrade the same display name. In that
  // case the unsuffixed record is the catalog's base identity; a distinct
  // upgrade display name (Bear/Tiger) resolves to the suffixed record alone.
  const bases = matchingClients.filter((item) => !isVariantApiName(item.apiName));
  const client = matchingClients.length === 1 ? matchingClients[0]! : bases.length === 1 ? bases[0]! : undefined;
  if (!client) return { classification: 'unresolved', baseIdentityKey: null, productionMatches: [] };
  const family = clientFamily(client.apiName);
  const productionMatches = production.filter((item) => normalizeCatalogName(item.riotId) === normalizeCatalogName(family) || normalizeCatalogName(item.nameEn) === name || normalizeCatalogName(item.nameZh) === normalizeCatalogName(row.nameZh)).map((item) => item.id);
  if (isVariantApiName(client.apiName)) return { classification: 'upgrade_or_variant_of_base_identity', baseIdentityKey: family, client, productionMatches };
  return { classification: productionMatches.length ? 'existing_base_identity_already_in_production' : 'missing_base_identity_candidate', baseIdentityKey: family, client, productionMatches };
}
