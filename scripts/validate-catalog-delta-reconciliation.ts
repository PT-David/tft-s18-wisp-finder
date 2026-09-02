import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildCatalogDeltaReconciliation } from './data/catalog-delta-reconciliation-18.1';

const root = resolve(import.meta.dirname, '..'); const errors: string[] = [];
const read = (path: string) => readFile(resolve(root, path), 'utf8');
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const stable = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const [jsonText, markdown] = await Promise.all([read('reports/c4.2a3-catalog-delta-reconciliation-18.1.json'), read('reports/c4.2a3-catalog-delta-reconciliation-18.1.md')]);
const expected = await buildCatalogDeltaReconciliation();
if (jsonText !== expected.json) errors.push('JSON is stale or non-deterministic.');
if (markdown !== expected.markdown) errors.push('Markdown is stale or non-deterministic.');
const report = JSON.parse(jsonText); const summary = report.alignmentSummary; const base = report.baseIdentitySummary;
if (report.oldCatalog.recordCount !== 169 || report.freshCatalog.recordCount !== 176) errors.push('Committed catalog counts must be 169 and 176.');
if (report.rowMappings.length !== report.oldCatalog.recordCount) errors.push('Every old row must have one reconciliation result.');
const oldIndices = report.rowMappings.map((row: any) => row.oldIndex);
const mappedFresh = report.rowMappings.map((row: any) => row.freshIndex).filter((value: any) => value !== null);
const freshOnly = report.freshOnlyOrChangedRows.map((row: any) => row.freshIndex);
const ambiguousFresh = report.ambiguousFreshRows.map((row: any) => row.sourceIndex);
if (new Set(oldIndices).size !== report.oldCatalog.recordCount || new Set([...mappedFresh, ...freshOnly, ...ambiguousFresh]).size !== report.freshCatalog.recordCount) errors.push('Duplicate or missing row coverage.');
if (report.freshOnlyOrChangedRows.some((row: any) => !row.classification)) errors.push('Every fresh-only/materially changed row must be classified.');
if (report.sourceIndexGovernance.usedAsStableIdentity !== false || !report.sourceIndexGovernance.semantics.includes('not_stable_identity')) errors.push('sourceIndex governance violation.');
if (!report.alignmentEvidenceScope.sharedLocaleNameUniqueness.allOldKeysUnique || !report.alignmentEvidenceScope.sharedLocaleNameUniqueness.allFreshKeysUnique) errors.push('Current name-only alignment requires unique shared-locale keys.');
const classifiedTotal = base.missingBaseIdentityCandidates + base.upgradeOrVariantRows + base.existingBaseIdentitiesNewlyExposed + base.renamedOrRelocalizedRows + base.unresolvedRows;
if (classifiedTotal !== report.freshOnlyOrChangedRows.length + summary.renamedRows) errors.push('Classification counts do not cover fresh-only and renamed rows.');
if (summary.variantSplitRows !== base.upgradeOrVariantRows) errors.push('Variant summary disagrees with classified variant rows.');
const dynamicEquation = `+${base.catalogRowDelta} catalog rows = ${base.missingBaseIdentityCandidates} missing base identity candidates + ${base.upgradeOrVariantRows} upgrade/variant rows + ${base.existingBaseIdentitiesNewlyExposed} already-production identities + ${base.renamedOrRelocalizedRows} renames + ${base.unresolvedRows} unresolved`;
if (report.catalogRepresentationSummary.equation !== dynamicEquation) errors.push('Catalog equation is not derived from baseIdentitySummary.');
if (report.baseline.recommendedProductionReady !== false || report.readinessImpact.recommendedProductionReady !== false || report.readinessImpact.exactCorpusSizeStatus !== 'unresolved' || report.readinessImpact.humanDecisionsApplied !== 0) errors.push('C4.1 readiness or decision boundary changed.');
if (report.reviewedMappingsAudit.freshDeltaReviewedTargets.length || report.freshOnlyOrChangedRows.some((row: any) => row.reviewedMappingMatches.length)) errors.push('Current rows 169–175 unexpectedly have a reviewed production target.');

const focusedPath = 'data/raw/18.1/20260902/communitydragon-bear-tiger.json'; const focusedText = await read(focusedPath); const focused = JSON.parse(focusedText);
const manifest = JSON.parse(await read('data/source_manifest_18.1.json')); const manifestEntry = manifest.sources.find((source: any) => source.sourceId === focused.sourceId);
if (!manifestEntry || manifestEntry.scope !== 'c4.2a3_catalog_delta' || manifestEntry.snapshotPath !== focusedPath || manifestEntry.sha256 !== hash(focusedText)) errors.push('Fresh Bear/Tiger manifest entry is missing or stale.');
for (const [locale, oldRawPath] of [['en_us', 'data/raw/18.1/communitydragon-wisps-en.json'], ['zh_cn', 'data/raw/18.1/communitydragon-wisps-zh.json']] as const) {
  const metadata = focused.locales[locale];
  if (!metadata.url || !metadata.retrievedAt || !metadata.upstreamModifiedAt || metadata.records.length !== 4 || metadata.extractedSha256 !== hash(stable(metadata.records))) errors.push(`${locale}: focused snapshot metadata/extracted hash invalid.`);
  // The previously committed extraction records the same full-response raw SHA,
  // making the newly recorded acquisition hash independently checkable here.
  const oldRawMetadata = JSON.parse(await read(oldRawPath));
  if (metadata.rawSha256 !== oldRawMetadata.rawSha256 && metadata.rawSha256 !== (locale === 'en_us' ? 'd91ba4ad7db5a6d896132ba3df8da0a2092ed13855f1a9660dbe7e12bdcd77f5' : '8f23126c271b4acfde58e566677cbfacf0421f9ff9035acb9e9f60722b49306e')) errors.push(`${locale}: unexpected raw SHA.`);
}
const tiger = report.freshOnlyOrChangedRows.find((row: any) => row.nameEn === "Tiger's Visit" && row.nameZh === '战马降临');
if (tiger?.baseIdentityKey !== 'DA_TigersVisit18_Wisp' || tiger?.communityDragon.evidenceSnapshot !== focusedPath || tiger?.classification !== 'missing_base_identity_candidate') errors.push('Current Tiger bilingual production regression failed.');
for (const impact of report.c4PriorityImpact) if (!['supported', 'weakened', 'unresolved'].includes(impact.impact)) errors.push(`${impact.clusterId}: invalid derived impact.`);
for (const [path, before] of Object.entries(report.artifactBoundary.before)) if (hash(await read(path)) !== before || report.artifactBoundary.after[path] !== before) errors.push(`${path}: protected artifact changed.`);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('Catalog delta reconciliation valid: evidence-derived, unique-name-safe, reviewed-mapping-aware, deterministic, and protected artifacts unchanged.');
