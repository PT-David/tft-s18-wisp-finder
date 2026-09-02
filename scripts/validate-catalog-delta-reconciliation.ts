import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildCatalogDeltaReconciliation } from './data/catalog-delta-reconciliation-18.1';

const root = resolve(import.meta.dirname, '..'); const errors: string[] = [];
const read = (path: string) => readFile(resolve(root, path), 'utf8');
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const [jsonText, markdown] = await Promise.all([read('reports/c4.2a3-catalog-delta-reconciliation-18.1.json'), read('reports/c4.2a3-catalog-delta-reconciliation-18.1.md')]);
const expected = await buildCatalogDeltaReconciliation();
if (jsonText !== expected.json) errors.push('JSON is stale or non-deterministic.');
if (markdown !== expected.markdown) errors.push('Markdown is stale or non-deterministic.');
const report = JSON.parse(jsonText); const summary = report.alignmentSummary;
if (report.oldCatalog.recordCount !== 169 || report.freshCatalog.recordCount !== 176) errors.push('Catalog counts must be 169 and 176.');
if (report.rowMappings.length !== 169 || report.freshOnlyOrChangedRows.length !== 7) errors.push('Every old/fresh row must be covered exactly once.');
const oldIndices = report.rowMappings.map((row: any) => row.oldIndex), mappedFresh = report.rowMappings.map((row: any) => row.freshIndex).filter((value: any) => value !== null), freshOnly = report.freshOnlyOrChangedRows.map((row: any) => row.freshIndex);
if (new Set(oldIndices).size !== 169 || new Set([...mappedFresh, ...freshOnly]).size !== 176) errors.push('Duplicate or missing row mapping.');
if (JSON.stringify(freshOnly) !== JSON.stringify([169, 170, 171, 172, 173, 174, 175]) || report.freshOnlyOrChangedRows.some((row: any) => !row.classification)) errors.push('Rows 169–175 must all be classified.');
if (report.sourceIndexGovernance.usedAsStableIdentity !== false || !report.sourceIndexGovernance.semantics.includes('not_stable_identity')) errors.push('sourceIndex governance violation.');
const bear = report.freshOnlyOrChangedRows.find((row: any) => row.nameEn === "Bear's Visit"), tiger = report.freshOnlyOrChangedRows.find((row: any) => row.nameEn === "Tiger's Visit");
if (bear?.communityDragon.baseApiName !== 'DA_BearsVisit18' || tiger?.baseIdentityKey !== 'DA_TigersVisit18_Wisp' || tiger?.communityDragon.baseApiName !== 'DA_TigersVisit18_Wisp' || tiger?.classification !== 'missing_base_identity_candidate') errors.push('Bear/Tiger bilingual client identity audit is inconsistent.');
if (report.baseIdentitySummary.missingBaseIdentityCandidates + report.baseIdentitySummary.upgradeOrVariantRows + report.baseIdentitySummary.existingBaseIdentitiesNewlyExposed + report.baseIdentitySummary.renamedOrRelocalizedRows + report.baseIdentitySummary.unresolvedRows !== 7 || summary.variantSplitRows !== 0) errors.push('Base plus upgrade accounting is inconsistent.');
if (report.baseline.recommendedProductionReady !== false || report.readinessImpact.recommendedProductionReady !== false || report.readinessImpact.exactCorpusSizeStatus !== 'unresolved' || report.readinessImpact.humanDecisionsApplied !== 0) errors.push('C4.1 readiness or decision boundary changed.');
for (const [path, before] of Object.entries(report.artifactBoundary.before)) if (hash(await read(path)) !== before || report.artifactBoundary.after[path] !== before) errors.push(`${path}: protected artifact changed.`);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('Catalog delta reconciliation valid: complete, deterministic, ordinal-safe, and production artifacts unchanged.');
