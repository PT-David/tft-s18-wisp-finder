import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { frozenBundleSha256, sha256, stableSerialize, type Json } from './lib/c4.2b3-required-fields';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFile(resolve(root, path), 'utf8');
const paths = {
  b2f: 'data/reviews/18.1/c4.2b2-field-evidence.json', b2: 'data/reviews/18.1/c4.2b-field-decisions.json',
  b3f: 'data/reviews/18.1/c4.2b3-required-field-evidence.json', b3: 'data/reviews/18.1/c4.2b3-required-field-decisions.json',
  manifest: 'data/source_manifest_18.1.json', html: 'data/raw/18.1/20260903/opgg-zh-cn.html',
  parsed: 'data/raw/18.1/20260903/opgg-final-blockers.json', out: 'data/reviews/18.1/c4.2b4-final-field-evidence.json',
};
const [b2ft, b2t, b3ft, b3t, manifestText, html] = await Promise.all([paths.b2f, paths.b2, paths.b3f, paths.b3, paths.manifest, paths.html].map(read));
const b2f = JSON.parse(b2ft), b3f = JSON.parse(b3ft), manifest = JSON.parse(manifestText);

const row = (key: string) => {
  const marker = `\\"key\\":\\"${key}\\"`;
  const matches = [...html.matchAll(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))];
  if (matches.length !== 1) throw new Error(`expected exactly one ${key} row, found ${matches.length}`);
  const start = html.lastIndexOf('{', matches[0]!.index);
  const end = html.indexOf('}', matches[0]!.index);
  if (start < 0 || end < 0) throw new Error(`incomplete ${key} row`);
  const parsedRow = JSON.parse(html.slice(start, end + 1).replaceAll('\\"', '"'));
  if (parsedRow.key !== key) throw new Error(`parsed the wrong row for ${key}`);
  return parsedRow;
};
const parsed = { schemaVersion: 1, sourceId: 'opgg_set18_wisps_20260903_targeted', url: 'https://op.gg/zh-cn/tft/set/18', locale: 'zh_cn', retrievedAt: '2026-09-03T11:27:39Z', upstreamModifiedAt: 'unknown', fetchStatus: 'http_200_targeted_parse', records: [row('TigersVisit'), row('Snacktime')] };
await writeFile(resolve(root, paths.parsed), stableSerialize(parsed));
const canonicalSource = manifest.sources.find((source: Json) => source.sourceId === parsed.sourceId);
if (!canonicalSource) throw new Error(`${parsed.sourceId} is absent from the canonical source manifest`);
const source = structuredClone(canonicalSource);
const b3targets = new Map<string, Json>(b3f.reviewTargets.map((target: Json) => [`${target.communityDragonId}:${target.field}`, target]));
const origin = (key: string) => (b3targets.get(key)?.evidence ?? []).map((evidence: Json) => ({ ...evidence, evidenceId: `B4-${evidence.evidenceId}`, originB3EvidenceId: evidence.evidenceId }));
const fresh = (id: string, field: string, rawValue: Json, value: Json, parsedRecordKey: string, parsedField: string) => ({
  evidenceId: id, sourceId: source.sourceId, tier: source.tier, confidence: source.confidence, useFor: source.useFor,
  sourceLocaleCoverage: source.locale, valueLocale: source.locale, retrievedAt: source.retrievedAt,
  sourceArtifact: source.sourceArtifact, parsedArtifact: source.parsedArtifact, field, parsedRecordKey, parsedField,
  rawValue, normalizedInterpretation: value, comparisonValue: value, proposedProductionValue: value, supports: [], conflictsWith: [],
});
const tiger = parsed.records[0], snack = parsed.records[1];
const specs: [string, string, Json[]][] = [
  ['DA_TigersVisit18_Wisp', 'requirements', origin('DA_TigersVisit18_Wisp:requirements').concat(fresh('B4-Tiger-requirements-opgg', 'requirements', tiger.condition, [{ type: 'source_text', textZh: tiger.condition, machineEvaluable: false }], 'TigersVisit', 'condition'))],
  ['DA_TigersVisit18_Wisp', 'category', [fresh('B4-Tiger-category-opgg', 'category', { category: tiger.category, categoryLabel: tiger.categoryLabel }, tiger.category.toLowerCase(), 'TigersVisit', 'category')]],
  ['DA_BearsVisit18', 'requirements', origin('DA_BearsVisit18:requirements')], ['DA_BearsVisit18', 'category', []],
  ['DA_Snacktime18', 'cost', origin('DA_Snacktime18:cost').concat(fresh('B4-Snacktime-cost-opgg', 'cost', snack.cost, snack.cost, 'Snacktime', 'cost'))],
];
const frozen: Json = {
  schemaVersion: 1, patch: '18.1', reviewStage: 'C4.2B4', lifecycle: 'frozen_final_supplemental_decision_time_evidence',
  frozenFrom: { b2FrozenPath: paths.b2f, b2FrozenSha256: sha256(b2ft), b2FrozenBundleSha256: b2f.bundleSha256, b2OverlayPath: paths.b2, b2OverlaySha256: sha256(b2t), b3FrozenPath: paths.b3f, b3FrozenSha256: sha256(b3ft), b3FrozenBundleSha256: b3f.bundleSha256, b3OverlayPath: paths.b3, b3OverlaySha256: sha256(b3t), b3DecisionSha256: JSON.parse(b3t).decisionSha256, productionRecordCount: 169 },
  acquisition: { scope: 'five_final_blockers_only', newSources: 1, leagueOfGraphs: 'live retrieval blocked by HTTP 403; no observation admitted' },
  reviewTargets: specs.map(([communityDragonId, field, evidence]) => { const prior = b3targets.get(`${communityDragonId}:${field}`); return { communityDragonId, nameEn: prior.nameEn, nameZh: prior.nameZh, field, b2ReviewId: prior.b2ReviewId, b2DecisionId: prior.b2DecisionId, b3Disposition: 'unresolved', evidence }; }),
  decisionTimeSourceCatalog: { frozenAt: parsed.retrievedAt, sources: [source] },
  sourceCatalogBinding: { canonicalManifestPath: paths.manifest, canonicalManifestSha256: sha256(manifestText), catalogSha256: '' }, bundleSha256: '',
};
frozen.sourceCatalogBinding.catalogSha256 = sha256(stableSerialize(frozen.decisionTimeSourceCatalog));
frozen.bundleSha256 = frozenBundleSha256(frozen);
await writeFile(resolve(root, paths.out), stableSerialize(frozen));
console.log(`Generated B4 evidence ${frozen.bundleSha256}`);
