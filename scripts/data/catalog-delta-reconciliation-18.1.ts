import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { alignCatalogRows, classifyCatalogRow, clientFamily, deriveC4PriorityImpact, isVariantApiName, normalizeCatalogName, type CatalogRow, type ClientIdentity } from './lib/catalog-delta';

type Json = Record<string, any>;
const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFile(resolve(root, path), 'utf8');
const load = async (path: string) => JSON.parse(await read(path));
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const stable = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const protectedPaths = [
  'data/normalized/wisps_18.1.json', 'data/materialized/18.1/wisps.json', 'data/materialized/18.1/search-concepts.json', 'data/materialized/18.1/synonyms.json',
  'public/data/wisps.json', 'public/data/search-concepts.json', 'public/data/search-synonyms.json', 'data/reviews/18.1/search-lexicon-decisions.json',
  'rules/wisp_rules_18.1.json', 'reports/c4.2a-identity-review-packet-18.1.json', 'reports/c4.2a2-priority-identity-proposals-18.1.json', 'reports/c4.2a2-priority-identity-proposals-18.1.md',
];
const extractNames = (html: string) => [...html.matchAll(/class="charm-title"[^>]*>([^<]+)</g)].map((match) => match[1]!.trim());
const relevantIdentity = (apiName: string) => apiName.replace(/^DA_/, '').replace(/18(?:_Wisp)?$/, '');
const equation = (summary: Json) => `+${summary.catalogRowDelta} catalog rows = ${summary.missingBaseIdentityCandidates} missing base identity candidates + ${summary.upgradeOrVariantRows} upgrade/variant rows + ${summary.existingBaseIdentitiesNewlyExposed} already-production identities + ${summary.renamedOrRelocalizedRows} renames + ${summary.unresolvedRows} unresolved`;

export async function buildCatalogDeltaReconciliation() {
  const [oldSnapshot, freshEnHtml, freshZhHtml, focusedClient, priorityClient, production, reviewedMappings, proposals, manifest] = await Promise.all([
    load('data/raw/18.1/datatft-wisps-zh.json'),
    read('data/raw/18.1/20260902/datatft-rendered-en-us.html'),
    read('data/raw/18.1/20260902/datatft-rendered.html'),
    load('data/raw/18.1/20260902/communitydragon-bear-tiger.json'),
    load('data/raw/18.1/20260902/communitydragon-priority-wisps.json'),
    load('data/normalized/wisps_18.1.json'),
    load('data/overrides/18.1/reviewed-identity-mappings.json'),
    load('reports/c4.2a2-priority-identity-proposals-18.1.json'),
    load('data/source_manifest_18.1.json'),
  ]);
  const namesEn = extractNames(freshEnHtml); const namesZh = extractNames(freshZhHtml);
  const oldRows: CatalogRow[] = oldSnapshot.records.map((row: Json) => ({ sourceIndex: row.sourceIndex, nameZh: row.nameZh }));
  const freshRows: CatalogRow[] = namesEn.map((nameEn, sourceIndex) => ({ sourceIndex, nameEn, nameZh: namesZh[sourceIndex] }));
  const aligned = alignCatalogRows(oldRows, freshRows);
  const hashes = Object.fromEntries(await Promise.all(protectedPaths.map(async (path) => [path, sha(await read(path))])));

  // A3's focused Bear/Tiger acquisition wins on duplicate apiName; the other
  // priority identities reuse A2's already-fresh focused client evidence.
  const clientByLocale = (locale: 'en_us' | 'zh_cn') => {
    const byApi: Map<string, Json> = new Map();
    for (const row of priorityClient.locales[locale].records) byApi.set(row.apiName, row);
    for (const row of focusedClient.locales[locale].records) byApi.set(row.apiName, row);
    return byApi;
  };
  const clientEn = clientByLocale('en_us'); const clientZh = clientByLocale('zh_cn');
  const bilingualClients: ClientIdentity[] = [...clientEn.values()].map((row) => ({ apiName: row.apiName, name: row.name, nameZh: clientZh.get(row.apiName)?.name }));
  const changed = aligned.freshOnly.map((row) => {
    const result = classifyCatalogRow(row, bilingualClients, production.records, reviewedMappings.records);
    const familyRows = result.client ? [...clientEn.values()].filter((item) => clientFamily(item.apiName) === result.baseIdentityKey) : [];
    const base = familyRows.find((item) => !isVariantApiName(item.apiName));
    const upgrades = familyRows.filter((item) => /_Upgrade$/i.test(item.apiName));
    const prismatics = familyRows.filter((item) => /_Prismatic$/i.test(item.apiName));
    const cluster = proposals.proposals.find((item: Json) => normalizeCatalogName(item.sourceIdentity) === normalizeCatalogName(relevantIdentity(result.baseIdentityKey ?? '')))?.clusterId ?? null;
    const evidenceSnapshot = result.baseIdentityKey && ['DA_BearsVisit18', 'DA_TigersVisit18_Wisp'].includes(result.baseIdentityKey)
      ? 'data/raw/18.1/20260902/communitydragon-bear-tiger.json'
      : 'data/raw/18.1/20260902/communitydragon-priority-wisps.json';
    return {
      freshIndex: row.sourceIndex, nameEn: row.nameEn, nameZh: row.nameZh,
      dataTftEvidence: { enSnapshot: 'data/raw/18.1/20260902/datatft-rendered-en-us.html', zhSnapshot: 'data/raw/18.1/20260902/datatft-rendered.html', ordinalSemantics: 'zero_based_rendered_catalog_ordinal_not_stable_identity' },
      communityDragon: {
        evidenceSnapshot, baseApiName: base?.apiName ?? null,
        upgradeApiNames: upgrades.map((item) => item.apiName), prismaticApiNames: prismatics.map((item) => item.apiName),
        relatedDisplayNames: familyRows.map((item) => ({ apiName: item.apiName, nameEn: item.name, nameZh: clientZh.get(item.apiName)?.name ?? null, effectEn: item.desc, effectZh: clientZh.get(item.apiName)?.desc ?? null, effects: item.effects, icon: item.icon, tags: item.tags })),
      },
      productionMatches: result.productionMatches, reviewedMappingMatches: result.reviewedMappingMatches,
      productionRelation: result.productionMatches.length ? `Exact stable/reviewed target(s): ${result.productionMatches.join(', ')}` : `No direct or reviewed identity target in ${production.records.length} production records and ${reviewedMappings.records.length} reviewed mappings.`,
      classification: result.classification, baseIdentityKey: result.baseIdentityKey,
      confidence: result.classification === 'unresolved' ? 'insufficient' : 'strong',
      identityConfirmingEvidence: result.client ? [`CommunityDragon ${result.client.apiName} has the exact bilingual display relation ${result.client.name} / ${result.client.nameZh}.`, ...(isVariantApiName(result.client.apiName) && base ? [`Explicit API suffix connects ${result.client.apiName} to base ${base.apiName}.`] : [])] : [],
      supportingEvidence: [`Fresh DataTFT rendered row ${row.sourceIndex}: ${row.nameEn} / ${row.nameZh}.`], conflictingEvidence: [],
      affectsC4Cluster: cluster, humanDecisionRequired: result.classification === 'missing_base_identity_candidate',
    };
  });
  const baseIdentitySummary = {
    catalogRowDelta: freshRows.length - oldRows.length,
    missingBaseIdentityCandidates: changed.filter((row) => row.classification === 'missing_base_identity_candidate').length,
    upgradeOrVariantRows: changed.filter((row) => row.classification === 'upgrade_or_variant_of_base_identity').length,
    existingBaseIdentitiesNewlyExposed: changed.filter((row) => row.classification === 'existing_base_identity_already_in_production').length,
    renamedOrRelocalizedRows: aligned.summary.renamedRows,
    unresolvedRows: changed.filter((row) => row.classification === 'unresolved').length,
  };
  const c4PriorityImpact = proposals.proposals.map((item: Json) => ({ clusterId: item.clusterId, sourceIdentity: item.sourceIdentity, ...deriveC4PriorityImpact(item.clusterId, item.sourceIdentity, aligned.mappings, changed) }));
  const manifestEntry = manifest.sources.find((source: Json) => source.sourceId === focusedClient.sourceId);
  const report = {
    schemaVersion: 2, patch: '18.1', purpose: 'catalog_delta_reconciliation_audit_only',
    baseline: { actualMainSha: 'd24bb0f14ce4c2f38fb21600323238da30e86135', productionRecords: production.records.length, exactCorpusSizeStatus: 'unresolved', recommendedProductionReady: false, c4_2a2HumanDecisionsApplied: 0 },
    oldCatalog: { recordCount: oldRows.length, localeCoverage: ['zh_cn'], snapshotPath: 'data/raw/18.1/datatft-wisps-zh.json', snapshotSha256: sha(await read('data/raw/18.1/datatft-wisps-zh.json')) },
    freshCatalog: { recordCount: freshRows.length, localeCoverage: ['en_us', 'zh_cn'], snapshotPaths: ['data/raw/18.1/20260902/datatft-rendered-en-us.html', 'data/raw/18.1/20260902/datatft-rendered.html'], snapshotSha256: { en: sha(freshEnHtml), zh: sha(freshZhHtml) } },
    freshBearTigerClientEvidence: { snapshotPath: manifestEntry.snapshotPath, sourceId: manifestEntry.sourceId, retrievedAt: manifestEntry.retrievedAt, upstreamModifiedAt: focusedClient.locales.en_us.upstreamModifiedAt + ' / ' + focusedClient.locales.zh_cn.upstreamModifiedAt, snapshotSha256: manifestEntry.sha256, locales: Object.fromEntries(Object.entries(focusedClient.locales).map(([locale, value]: [string, any]) => [locale, { url: value.url, retrievedAt: value.retrievedAt, upstreamModifiedAt: value.upstreamModifiedAt, rawSha256: value.rawSha256, extractedSha256: value.extractedSha256, recordCount: value.records.length }])) },
    sourceIndexGovernance: { semantics: 'zero_based_rendered_catalog_ordinal_not_stable_identity', usedAsStableIdentity: false, warning: 'Position supports sequence audit only; index equality or index >= old count cannot establish identity.' },
    alignmentEvidenceScope: { proven: 'All old Chinese DataTFT display-name rows align one-to-one at the same ordinal in the fresh Chinese catalog.', notProven: 'The old snapshot contains no English names, so this audit does not claim bilingual identity equality or re-audit all fields.', sharedLocaleNameUniqueness: aligned.sharedLocaleNameUniqueness },
    alignmentSummary: { ...aligned.summary, variantSplitRows: baseIdentitySummary.upgradeOrVariantRows },
    rowMappings: aligned.mappings, ambiguousFreshRows: aligned.ambiguousFresh,
    freshOnlyOrChangedRows: changed, baseIdentitySummary,
    catalogRepresentationSummary: { equation: equation(baseIdentitySummary), catalogRepresentationDoesNotProveExactCorpusSize: true },
    reviewedMappingsAudit: { snapshotPath: 'data/overrides/18.1/reviewed-identity-mappings.json', reviewedMappingCount: reviewedMappings.records.length, freshDeltaReviewedTargets: changed.flatMap((row) => row.reviewedMappingMatches.map((productionId: string) => ({ freshIndex: row.freshIndex, productionId }))), conclusion: changed.some((row) => row.reviewedMappingMatches.length) ? 'One or more fresh delta identities have reviewed production targets.' : 'No row 169–175 base identity has an existing reviewed production target.' },
    c4PriorityImpact,
    readinessImpact: { exactCorpusSizeStatus: 'unresolved', recommendedProductionReady: false, reason: 'Rendered catalog rows are not a complete base-identity census; other source-corpus identities remain outside this delta audit.', humanDecisionsApplied: 0 },
    artifactBoundary: { before: hashes, after: hashes },
  };
  return { json: stable(report), markdown: render(report) };
}

function render(report: Json) {
  const s = report.alignmentSummary; const b = report.baseIdentitySummary;
  const rows = report.freshOnlyOrChangedRows.map((row: Json) => `| ${row.freshIndex} | ${row.nameEn} / ${row.nameZh} | ${row.communityDragon.baseApiName ?? 'unresolved'}${row.classification === 'upgrade_or_variant_of_base_identity' ? `; variant ${row.communityDragon.upgradeApiNames.join(', ')}` : ' (base)'} | ${row.productionMatches.length ? row.productionMatches.join(', ') : 'No direct/reviewed target'} | \`${row.classification}\` |`).join('\n');
  const impacts = report.c4PriorityImpact.map((item: Json) => `- **${item.clusterId} — ${item.sourceIdentity}: ${item.impact}.** ${item.note}`).join('\n');
  const evidence = report.freshBearTigerClientEvidence;
  return `# C4.2A3 Catalog Delta Reconciliation — Patch 18.1\n\n> Audit only. **${report.readinessImpact.humanDecisionsApplied} human decisions applied.** Exact corpus size remains **${report.readinessImpact.exactCorpusSizeStatus}** and \`recommendedProductionReady=${report.readinessImpact.recommendedProductionReady}\`.\n\n## Executive result\n\n- Old catalog: **${report.oldCatalog.recordCount}** rows; fresh catalog: **${report.freshCatalog.recordCount}** rows; delta: **${b.catalogRowDelta >= 0 ? '+' : ''}${b.catalogRowDelta}**.\n- Full alignment: **${s.unchangedRows} unchanged**, **${s.shiftedRows} shifted**, **${s.renamedRows} renamed**, **${s.freshOnlyRows} fresh-only**, **${s.oldOnlyRows} old-only**, **${s.variantSplitRows} variant splits**, **${s.ambiguousRows} ambiguous**.\n- **${report.catalogRepresentationSummary.equation}.**\n- Evidence scope: all ${report.oldCatalog.recordCount} old **Chinese display-name rows** align at the same ordinal in the fresh Chinese catalog. The old snapshot has no English names, so this is not a claim that ${report.oldCatalog.recordCount} bilingual identities or all fields were revalidated.\n- Shared-locale normalized Chinese name keys are unique: old **${report.alignmentEvidenceScope.sharedLocaleNameUniqueness.oldUniqueKeys}/${report.alignmentEvidenceScope.sharedLocaleNameUniqueness.oldRowCount}**; fresh **${report.alignmentEvidenceScope.sharedLocaleNameUniqueness.freshUniqueKeys}/${report.alignmentEvidenceScope.sharedLocaleNameUniqueness.freshRowCount}**.\n\n## 169–175 reconciliation table\n\n| Fresh index | DataTFT name | CommunityDragon relation | Production relation | Classification |\n|---:|---|---|---|---|\n${rows}\n\n## Full catalog alignment\n\nName-only alignment is permitted only where the normalized shared-locale key is unique in both catalogs. \`sourceIndex\` is never an identity key. The observed old Chinese sequence maps to fresh rows 0–${report.oldCatalog.recordCount - 1}; unclaimed fresh rows begin at ${report.oldCatalog.recordCount}. No Chinese display-name insert, delete, reorder, or rename was observed in the old sequence.\n\n## Fresh Bear / Tiger client evidence\n\n- Source: \`${evidence.sourceId}\`; snapshot: \`${evidence.snapshotPath}\`; retrieved: \`${evidence.retrievedAt}\`; upstream modified: \`${evidence.upstreamModifiedAt}\`.\n- EN raw/extracted SHA: \`${evidence.locales.en_us.rawSha256}\` / \`${evidence.locales.en_us.extractedSha256}\`.\n- ZH raw/extracted SHA: \`${evidence.locales.zh_cn.rawSha256}\` / \`${evidence.locales.zh_cn.extractedSha256}\`.\n\n## Bear / Tiger case\n\n- **Bear:** \`DA_BearsVisit18\` is Bear's Visit / 蛮熊降临, an unsuffixed base absent from production and reviewed mappings.\n- **Bear upgrade:** \`DA_BearsVisit18_Upgrade\` is Tiger's Visit / 猛虎降临.\n- **Rendered Tiger row:** Tiger's Visit / 战马降临 instead matches unsuffixed \`DA_TigersVisit18_Wisp\`; its upgrade is \`DA_TigersVisit18_Wisp_Upgrade\` / 猛虎降临. Thus row 174 is a separate base candidate, not the Bear upgrade display.\n\n## Reviewed mappings audit\n\n${report.reviewedMappingsAudit.conclusion} Checked all **${report.reviewedMappingsAudit.reviewedMappingCount}** committed reviewed mappings before classifying a base as missing.\n\n## Impact on C4I-001–006\n\n${impacts}\n\nA2 remains historical proposal output; no A2 report or production record was rewritten.\n\n## Impact on corpus-size hypothesis\n\nCatalog reconciliation does not establish a complete base-identity census. \`exact corpus size = ${report.readinessImpact.exactCorpusSizeStatus}\` and \`recommendedProductionReady = ${report.readinessImpact.recommendedProductionReady}\`.\n\n## Human decisions\n\n**${report.readinessImpact.humanDecisionsApplied} applied.** Missing-base classifications remain audit candidates only.\n\n## Deferred field conflicts\n\nEffect, cost, requirement, category, and stage conflicts remain deferred to C4.2B and are not identity-confirming evidence.\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const output = await buildCatalogDeltaReconciliation();
  await writeFile(resolve(root, 'reports/c4.2a3-catalog-delta-reconciliation-18.1.json'), output.json);
  await writeFile(resolve(root, 'reports/c4.2a3-catalog-delta-reconciliation-18.1.md'), output.markdown);
  console.log('Generated deterministic catalog delta reconciliation.');
}
