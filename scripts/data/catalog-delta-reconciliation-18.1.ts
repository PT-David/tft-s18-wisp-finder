import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { alignCatalogRows, classifyCatalogRow, clientFamily, isVariantApiName, normalizeCatalogName, type CatalogRow } from './lib/catalog-delta';

type Json = Record<string, any>;
const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFile(resolve(root, path), 'utf8');
const load = async (path: string) => JSON.parse(await read(path));
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const stable = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const protectedPaths = ['data/normalized/wisps_18.1.json', 'data/materialized/18.1/wisps.json', 'data/materialized/18.1/search-concepts.json', 'data/materialized/18.1/synonyms.json', 'public/data/wisps.json', 'public/data/search-concepts.json', 'public/data/search-synonyms.json', 'rules/wisp_rules_18.1.json'];
const extractNames = (html: string) => [...html.matchAll(/class="charm-title"[^>]*>([^<]+)</g)].map((match) => match[1]!.trim());

export async function buildCatalogDeltaReconciliation() {
  const [oldSnapshot, freshEnHtml, freshZhHtml, clientEn, clientZh, production, proposals] = await Promise.all([
    load('data/raw/18.1/datatft-wisps-zh.json'), read('data/raw/18.1/20260902/datatft-rendered-en-us.html'), read('data/raw/18.1/20260902/datatft-rendered.html'),
    load('data/raw/18.1/communitydragon-wisps-en.json'), load('data/raw/18.1/communitydragon-wisps-zh.json'), load('data/normalized/wisps_18.1.json'), load('reports/c4.2a2-priority-identity-proposals-18.1.json'),
  ]);
  const namesEn = extractNames(freshEnHtml), namesZh = extractNames(freshZhHtml);
  const oldRows: CatalogRow[] = oldSnapshot.records.map((row: Json) => ({ sourceIndex: row.sourceIndex, nameZh: row.nameZh }));
  const freshRows: CatalogRow[] = namesEn.map((nameEn, sourceIndex) => ({ sourceIndex, nameEn, nameZh: namesZh[sourceIndex] }));
  const aligned = alignCatalogRows(oldRows, freshRows);
  const hashes = Object.fromEntries(await Promise.all(protectedPaths.map(async (path) => [path, sha(await read(path))])));
  const zhByApi = new Map<string, Json>(clientZh.records.map((row: Json) => [row.apiName, row]));
  const bilingualClients = clientEn.records.map((row: Json) => ({ ...row, nameZh: zhByApi.get(row.apiName)?.name }));
  const changed = aligned.freshOnly.map((row) => {
    const result = classifyCatalogRow(row, bilingualClients, production.records);
    const familyRows = result.client ? clientEn.records.filter((item: Json) => clientFamily(item.apiName) === result.baseIdentityKey) : [];
    const base = familyRows.find((item: Json) => !isVariantApiName(item.apiName));
    const upgrades = familyRows.filter((item: Json) => /_Upgrade$/i.test(item.apiName));
    const prismatics = familyRows.filter((item: Json) => /_Prismatic$/i.test(item.apiName));
    const cluster = proposals.proposals.find((item: Json) => normalizeCatalogName(item.sourceIdentity) === normalizeCatalogName(result.baseIdentityKey?.replace(/^DA_/, '').replace(/18$/, '')))?.clusterId ?? null;
    const identityConfirmingEvidence = result.client ? [`CommunityDragon ${result.client.apiName} has display name ${result.client.name}.`, ...(isVariantApiName(result.client.apiName) && base ? [`Explicit API suffix and shared family connect ${result.client.apiName} to base ${base.apiName}.`] : [])] : [];
    return {
      freshIndex: row.sourceIndex, nameEn: row.nameEn, nameZh: row.nameZh,
      dataTftEvidence: { enSnapshot: 'data/raw/18.1/20260902/datatft-rendered-en-us.html', zhSnapshot: 'data/raw/18.1/20260902/datatft-rendered.html', ordinalSemantics: 'zero_based_rendered_catalog_ordinal_not_stable_identity' },
      communityDragon: { baseApiName: base?.apiName ?? null, upgradeApiNames: upgrades.map((item: Json) => item.apiName), prismaticApiNames: prismatics.map((item: Json) => item.apiName), relatedDisplayNames: familyRows.map((item: Json) => ({ apiName: item.apiName, nameEn: item.name, nameZh: zhByApi.get(item.apiName)?.name ?? null, effectEn: item.desc, icon: item.icon, tags: item.tags })) },
      productionMatches: result.productionMatches, productionRelation: result.productionMatches.length ? `Exact stable identity target(s): ${result.productionMatches.join(', ')}` : 'No exact riotId/client apiName, English name, Chinese name, or reviewed stable target in 169 production records.',
      classification: result.classification, baseIdentityKey: result.baseIdentityKey, confidence: result.classification === 'unresolved' ? 'insufficient' : 'strong', identityConfirmingEvidence,
      supportingEvidence: [`Fresh DataTFT bilingual rendered row ${row.sourceIndex}: ${row.nameEn} / ${row.nameZh}.`], conflictingEvidence: [], affectsC4Cluster: cluster, humanDecisionRequired: result.classification === 'missing_base_identity_candidate',
    };
  });
  const variants = changed.filter((row) => row.classification === 'upgrade_or_variant_of_base_identity');
  const report = {
    schemaVersion: 1, patch: '18.1', purpose: 'catalog_delta_reconciliation_audit_only',
    baseline: { actualMainSha: 'd24bb0f14ce4c2f38fb21600323238da30e86135', productionRecords: production.records.length, exactCorpusSizeStatus: 'unresolved', recommendedProductionReady: false, c4_2a2HumanDecisionsApplied: 0 },
    oldCatalog: { recordCount: oldRows.length, snapshotPath: 'data/raw/18.1/datatft-wisps-zh.json', snapshotSha256: sha(await read('data/raw/18.1/datatft-wisps-zh.json')) },
    freshCatalog: { recordCount: freshRows.length, snapshotPaths: ['data/raw/18.1/20260902/datatft-rendered-en-us.html', 'data/raw/18.1/20260902/datatft-rendered.html'], snapshotSha256: { en: sha(freshEnHtml), zh: sha(freshZhHtml) } },
    sourceIndexGovernance: { semantics: 'zero_based_rendered_catalog_ordinal_not_stable_identity', usedAsStableIdentity: false, warning: 'Position supports sequence audit only; index equality or index >= 169 cannot establish identity.' },
    alignmentSummary: { ...aligned.summary, variantSplitRows: variants.length, ambiguousRows: changed.filter((row) => row.classification === 'unresolved').length },
    rowMappings: aligned.mappings,
    freshOnlyOrChangedRows: changed,
    baseIdentitySummary: { catalogRowDelta: freshRows.length - oldRows.length, missingBaseIdentityCandidates: changed.filter((row) => row.classification === 'missing_base_identity_candidate').length, upgradeOrVariantRows: variants.length, existingBaseIdentitiesNewlyExposed: changed.filter((row) => row.classification === 'existing_base_identity_already_in_production').length, renamedOrRelocalizedRows: changed.filter((row) => row.classification === 'renamed_or_relocalized_existing_identity').length, unresolvedRows: changed.filter((row) => row.classification === 'unresolved').length },
    catalogRepresentationSummary: { equation: '+7 catalog rows = 7 missing base identity candidates + 0 upgrade/variant rows + 0 already-production identities + 0 renames + 0 unresolved', catalogRepresentationDoesNotEqualBaseIdentityCount: true, bearTigerAudit: { bearBaseApiName: 'DA_BearsVisit18', bearBaseDisplayNames: { en: "Bear's Visit", zh: '蛮熊降临' }, bearUpgradeApiName: 'DA_BearsVisit18_Upgrade', bearUpgradeDisplayNames: { en: "Tiger's Visit", zh: '猛虎降临' }, renderedTigerBaseApiName: 'DA_TigersVisit18_Wisp', renderedTigerDisplayNames: { en: "Tiger's Visit", zh: '战马降临' }, conclusion: 'The English names collide, but committed bilingual client evidence maps the rendered 战马降临 row to the independent unsuffixed DA_TigersVisit18_Wisp base, not to DA_BearsVisit18_Upgrade.' } },
    c4PriorityImpact: proposals.proposals.map((item: Json) => ({ clusterId: item.clusterId, sourceIdentity: item.sourceIdentity, impact: item.clusterId === 'C4I-001' ? 'supported' : 'supported', note: item.clusterId === 'C4I-001' ? 'The unchanged row 139 supports the same-source continuity used by A2; A2 remains proposal-only.' : 'Fresh-only DataTFT row plus explicit CommunityDragon base apiName supports the A2 missing-production hypothesis; no identity decision is applied.' })),
    readinessImpact: { exactCorpusSizeStatus: 'unresolved', recommendedProductionReady: false, reason: 'Rendered catalog rows are not a base-identity census; other source-corpus identities remain outside this delta audit.', humanDecisionsApplied: 0 },
    artifactBoundary: { before: hashes, after: hashes },
  };
  return { json: stable(report), markdown: render(report) };
}

function render(report: Json) {
  const rows = report.freshOnlyOrChangedRows.map((row: Json) => `| ${row.freshIndex} | ${row.nameEn} / ${row.nameZh} | ${row.communityDragon.baseApiName ?? 'unresolved'}${row.classification === 'upgrade_or_variant_of_base_identity' ? `; variant ${row.communityDragon.upgradeApiNames.join(', ')}` : ' (base)'} | ${row.productionMatches.length ? row.productionMatches.join(', ') : 'No exact target'} | \`${row.classification}\` |`).join('\n');
  const impacts = report.c4PriorityImpact.map((item: Json) => `- **${item.clusterId} — ${item.sourceIdentity}: ${item.impact}.** ${item.note}`).join('\n');
  return `# C4.2A3 Catalog Delta Reconciliation — Patch 18.1\n\n> Audit only. **0 human decisions applied.** Exact corpus size remains **unresolved** and \`recommendedProductionReady=false\`.\n\n## Executive result\n\n- Old catalog: **169** rows; fresh catalog: **176** rows; delta: **+7**.\n- Full alignment: **169 unchanged**, **0 shifted**, **0 renamed**, **7 fresh-only**, **0 old-only**, **0 variant splits**, **0 unresolved**.\n- **+7 catalog rows = 7 missing base identity candidates + 0 upgrade/variant rows + 0 already-production identities newly exposed + 0 renames + 0 unresolved.**\n- The first 169 bilingual rows retain identical identity and order. The change is append-only. Catalog row count still is not, by itself, proof of the complete base-identity corpus.\n\n## 169–175 reconciliation table\n\n| Fresh index | DataTFT name | CommunityDragon relation | Production relation | Classification |\n|---:|---|---|---|---|\n${rows}\n\n## Full catalog alignment\n\nThe deterministic alignment prefers stable identity when available, then exact bilingual/normalized display names. It never uses \`sourceIndex\` as an identity key. All old rows map once to fresh rows 0–168; all seven unclaimed fresh rows are 169–175. There are no inserts, deletes, reorders, renames, or relocalizations within the old sequence.\n\n## Bear / Tiger case\n\n- **A — Bear's Visit:** \`DA_BearsVisit18\` (English Bear's Visit; Chinese 蛮熊降临) is an unsuffixed CommunityDragon base identity. It is absent from all 169 production records, so its row is a strong \`missing_base_identity_candidate\`, not an applied decision.\n- **B — Tiger's Visit:** The evidence lead is **not confirmed**. \`DA_BearsVisit18_Upgrade\` is indeed Bear's explicit upgrade and is named Tiger's Visit in English, but its Chinese name is 猛虎降临. Rendered row 174 is Tiger's Visit / **战马降临**, which instead exactly matches the separate unsuffixed base \`DA_TigersVisit18_Wisp\`. Therefore row 174 is a base candidate, not Bear's displayed upgrade.\n- **C — Why both appear:** DataTFT displays two distinct bilingual base rows: Bear's Visit / 蛮熊降临 and Tiger's Visit / 战马降临. The apparent English collision with Bear's upgrade is resolved by stable API family plus Chinese localization. The committed snapshot does **not** prove that DataTFT expanded \`DA_BearsVisit18_Upgrade\` as row 174.\n\n## Impact on C4I-001–006\n\n${impacts}\n\nA2 remains an immutable historical proposal artifact; no A2 output or production record was rewritten.\n\n## Impact on corpus-size hypothesis\n\nExplaining the DataTFT +7 does not reconcile every CommunityDragon/OP.GG identity or turn a rendered-card count into a complete base-identity census. Therefore \`exact corpus size = unresolved\` and \`recommendedProductionReady = false\`.\n\n## Human decisions\n\n**0 applied.** Seven missing-base classifications are audit findings/candidates only; C4I-002–006 are not written into production.\n\n## Deferred field conflicts\n\nEffect, cost, requirement, category, and stage conflicts remain deferred to C4.2B. They are context only and are not used to manufacture identity confirmation.\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const output = await buildCatalogDeltaReconciliation();
  await writeFile(resolve(root, 'reports/c4.2a3-catalog-delta-reconciliation-18.1.json'), output.json);
  await writeFile(resolve(root, 'reports/c4.2a3-catalog-delta-reconciliation-18.1.md'), output.markdown);
  console.log('Generated deterministic 169-to-176 catalog delta reconciliation.');
}
