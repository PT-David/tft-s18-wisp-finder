import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type Raw = Record<string, unknown>;
const root = resolve(import.meta.dirname, '../..');
const load = async (path: string) => JSON.parse(await readFile(resolve(root, path), 'utf8')) as Raw;
const loadOptional = async (path: string) => readFile(resolve(root, path), 'utf8').then((value) => JSON.parse(value) as Raw).catch(() => undefined);
const stable = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const slug = (value: string) => value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const hashId = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 12);
const stripTags = (value: string) => value.replace(/<[^>]+>/g, '').trim();
const identity = (value: unknown) => String(value ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/gu, '');
const bigrams = (value: unknown) => { const clean = identity(value); return new Set([...clean].slice(0, -1).map((char, index) => char + clean[index + 1])); };
const similarity = (a: unknown, b: unknown) => { const left = bigrams(a); const right = bigrams(b); const overlap = [...left].filter((item) => right.has(item)).length; return left.size + right.size ? (2 * overlap) / (left.size + right.size) : 0; };
export const variantKind = (api: string): 'base' | 'upgrade' | 'prismatic' => /prismatic/i.test(api) ? 'prismatic' : /upgrade/i.test(api) ? 'upgrade' : 'base';
const baseApi = (api: string) => variantKind(api) === 'base';

function stages(labels: string[]) {
  const label = labels.find((item) => item.startsWith('回合：'));
  const matches = [...(label ?? '').matchAll(/(\d+)-(\d+)\s*~\s*(\d+)-(\d+)/g)];
  return matches.map((match) => ({ start: { stage: +match[1]!, round: +match[2]! }, end: { stage: +match[3]!, round: +match[4]! } }));
}

async function main() {
  const datatft = await load('data/raw/18.1/datatft-wisps-zh.json');
  const cdEn = await load('data/raw/18.1/communitydragon-wisps-en.json');
  const cdZh = await load('data/raw/18.1/communitydragon-wisps-zh.json');
  const opgg = await load('data/raw/18.1/opgg-wisps-corpus.json');
  const lolchess = await load('data/raw/18.1/lolchess-fetch-status.json');
  const opggImported = await loadOptional('data/raw/18.1/opgg-wisps-zh.json');
  const lolchessImported = await loadOptional('data/raw/18.1/lolchess-wisps.json');
  const seed = await load('data/wisps_18.1.json');
  const enByApi = new Map((cdEn.records as Raw[]).map((item) => [item.apiName, item]));
  const zhByName = new Map<string, Raw[]>();
  for (const item of cdZh.records as Raw[]) {
    const list = zhByName.get(item.name as string) ?? [];
    list.push(item); zhByName.set(item.name as string, list);
  }
  const at = datatft.retrievedAt as string;
  const dtSource = { sourceId: datatft.sourceId, verifiedAt: at, confidence: 'community_high_confidence' };
  const cdSource = { sourceId: cdEn.sourceId, verifiedAt: cdEn.upstreamModifiedAt, confidence: 'client_data' };
  const cdZhSource = { sourceId: cdZh.sourceId, verifiedAt: cdZh.upstreamModifiedAt, confidence: 'client_data' };
  const records = (datatft.records as Raw[]).map((raw) => {
    const nameZh = raw.nameZh as string;
    const candidates = zhByName.get(nameZh) ?? [];
    const base = candidates.find((item) => baseApi(item.apiName as string)) ?? candidates[0];
    const en = base ? enByApi.get(base.apiName) : undefined;
    const riotId = base?.apiName as string | undefined;
    const nameEn = (en?.name as string | undefined) ?? nameZh;
    const id = riotId ? riotId.toLowerCase().replace(/[^a-z0-9]+/g, '_') : `snapshot_${String(raw.sourceIndex).padStart(3, '0')}_${slug(nameEn) || hashId(nameZh)}`;
    const labels = raw.labelsZh as string[];
    const stageRanges = stages(labels);
    const requirementLabels = labels.filter((item) => !item.startsWith('回合：'));
    const category = raw.category === 'goldxp' ? 'gold_xp' : raw.category;
    const upgrade = candidates.find((item) => /upgrade/i.test(item.apiName as string));
    const prismatic = candidates.find((item) => /prismatic/i.test(item.apiName as string));
    const hasDistinctUpgrade = Boolean(base && upgrade && stripTags(String(base.desc)) !== stripTags(String(upgrade.desc)));
    const sources: Record<string, unknown> = {
      id: riotId ? cdSource : dtSource, riotId: riotId ? cdSource : dtSource,
      nameEn: en ? cdSource : dtSource, nameZh: base ? cdZhSource : dtSource, category: dtSource, cost: dtSource,
      stageRanges: dtSource, effects: dtSource,
      requirements: dtSource, oncePerGame: dtSource, reofferCooldownShops: dtSource, patch: dtSource,
    };
    return {
      id, riotId: riotId ?? null, nameZh, nameEn, category, cost: raw.cost,
      stageRanges,
      effects: { normal: stripTags(raw.effectZh as string), blossom: hasDistinctUpgrade && raw.upgrade ? stripTags((raw.upgrade as Raw).effectZh as string) : null, prismatic: raw.prismatic ? stripTags((raw.prismatic as Raw).effectZh as string) : null },
      requirements: requirementLabels.map((textZh) => ({ type: 'source_text', textZh, machineEvaluable: false })),
      oncePerGame: { status: 'unknown' }, reofferCooldownShops: { status: 'unknown' },
      searchConcepts: [], synonyms: [], sources, patch: '18.1',
    };
  }).sort((a, b) => a.id.localeCompare(b.id, 'en'));

  const missingRiotId = records.filter((record) => !record.riotId).map((record) => ({ id: record.id, nameZh: record.nameZh, reason: 'No exact zh_cn client-name match; fuzzy matching was not accepted.' }));
  const cdNames = new Set((cdZh.records as Raw[]).map((item) => item.name as string));
  const dtNames = new Set(records.map((item) => item.nameZh));
  const communityOnly = [...cdNames].filter((name) => !dtNames.has(name)).sort();
  const opggObservation = (opgg.humanReviewObservation ?? {}) as Raw;
  const opggCount = (opgg.recordCount ?? opggObservation.recordCount ?? 0) as number;
  const opggCategoryCounts = (opgg.categoryCounts ?? opggObservation.categoryCounts ?? {}) as Raw;
  const lolchessObservation = lolchess.humanReviewObservation as Raw;
  const lolchessPrismaticCount = lolchessObservation.prismaticBlossomsOnlyCount as number;
  const opggRows = (opgg.records ?? opggImported?.records ?? []) as Raw[];
  const lolchessRows = (lolchessImported?.records ?? lolchess.records) as Raw[];
  const dataset = { patch: '18.1', datasetStatus: 'audited_snapshot_not_production_ready', productionReady: false, verifiedAt: at, records };
  const categoryCounts = Object.fromEntries(['champion','combat','misc','shop','gold_xp','risky','item'].map((category) => [category, records.filter((r) => r.category === category).length]));
  const coverage = {
    patch: '18.1', productionReady: false,
    sourceRecordCounts: { datatft: (datatft.records as Raw[]).length, communitydragonEnVariants: (cdEn.records as Raw[]).length, communitydragonZhVariants: (cdZh.records as Raw[]).length, opggHumanObserved: opggCount, opggExtracted: opggRows.length, lolchess: lolchessRows.length },
    unionByAcceptedSkeleton: records.length + communityOnly.length, intersectionByExactLocalizedName: records.length - missingRiotId.length,
    normalizedCount: records.length, withRiotId: records.length - missingRiotId.length, withChineseName: records.length, chinesePlaceholderCount: 0,
    categoryCounts, startingStageCounts: Object.fromEntries([2,3,4,5,6,7,8].map((stage) => [stage, records.filter((r) => r.stageRanges[0]?.start.stage === stage).length])),
    withBlossom: records.filter((r) => r.effects.blossom).length, withPrismatic: records.filter((r) => r.effects.prismatic).length,
    withRequirements: records.filter((r) => r.requirements.length).length, oncePerGameConfirmedTrue: 0, oncePerGameUnknown: records.length,
    withReofferCooldownShops: 0, criticalFieldsMissing: missingRiotId.length, unresolvedCriticalConflicts: 1, unmatchedCount: missingRiotId.length + communityOnly.length,
  };
  const conflict = (conflictType: string, severity: string, field: string, sourceA: string, sourceB: string, valueA: unknown, valueB: unknown, blocksProductionReady: boolean, note: string) => ({ conflictType, severity, blocksProductionReady, wispIdentity: 'corpus', field, sourceA, sourceB, valueA, valueB, sourceTimestamps: { sourceA: at, sourceB: null }, priorityReasoning: 'Differences are reported from snapshots; no count is hard-coded as an acceptance target.', resolution: 'needs_review', note });
  const conflicts = [
    conflict('source_access', 'critical', 'LoLCHESS structured skeleton', 'datatft_18_1_20260828', 'lolchess_wisps_18_1', records.length, 'cloud_fetch_blocked', true, 'The public source exists, but this execution path received an AWS WAF challenge.'),
    conflict('corpus_count', 'critical', 'corpus size', String(datatft.sourceId), String(opgg.sourceId), records.length, opggCount, true, 'All OP.GG identities are extracted; the 31 additions require corpus-policy and required-field review before promotion.'),
    conflict('category_counts', 'high', 'category distribution', String(datatft.sourceId), String(opgg.sourceId), categoryCounts, opggCategoryCounts, true, 'Record-level matching found no category disagreement in the 169-row intersection; the aggregate difference comes from OP.GG-only rows.'),
    conflict('blossom_coverage', 'high', 'Blossom coverage', 'datatft_18_1_20260828', 'communitydragon_live_18_1_20260827', (datatft.records as Raw[]).filter((r) => r.upgrade).length, records.filter((r) => r.effects.blossom).length, true, 'DataTFT renders an upgrade block for every row; production now requires a distinct client Upgrade variant.'),
    conflict('prismatic_coverage', 'high', 'Prismatic coverage', 'datatft_18_1_20260828', 'lolchess_human_observation', records.filter((r) => r.effects.prismatic).length, lolchessPrismaticCount, true, 'The LoLCHESS public page observation says 11 Prismatic Blossoms Only; record-level comparison remains required.'),
    conflict('knowledge_state', 'medium', 'oncePerGame/reofferCooldownShops', 'seed_regression', 'production_snapshots', 'some confirmed examples', 'unknown in current production sources', false, 'Unknown is now represented explicitly instead of false/null.'),
    conflict('source_membership', 'high', 'DataTFT-only / CommunityDragon-only', 'datatft_18_1_20260828', 'communitydragon_live_18_1_20260827', missingRiotId.length, communityOnly.length, true, 'Exact-name association remains incomplete; fuzzy matches are not silently accepted.'),
  ];
  coverage.unresolvedCriticalConflicts = conflicts.filter((item) => item.resolution === 'needs_review' && item.blocksProductionReady).length;
  const unmatched = { lolchessOnly: [], communityDragonOnly: communityOnly, dataTftOnly: missingRiotId, withoutRiotId: missingRiotId, withoutChineseMatch: communityOnly, fuzzyNameOnly: missingRiotId, unknownCategory: records.filter((r) => !r.category).map((r) => r.id), other: [] };
  const schemaGaps = [{ field: 'minimumAffordableGold', issue: 'DataTFT exposes cost but not all affordability rules.', affectedCount: records.length, resolution: 'Field omitted in production; seed fixtures retain independently asserted values.', recommendation: 'Add a derived-lower-bound state only if the UI later needs to expose that distinction.' }];
  const seedRecords = seed.records as Raw[];
  const productionByEn = new Map(records.map((record) => [record.nameEn.toLowerCase(), record]));
  const seedRegression = seedRecords.map((fixture) => { const production = productionByEn.get((fixture.nameEn as string).toLowerCase()); return { nameEn: fixture.nameEn, matched: Boolean(production), productionId: production?.id ?? null, differences: production ? ['nameZh','cost','stageRanges','effects','requirements','oncePerGame'].filter((field) => JSON.stringify(fixture[field]) !== JSON.stringify((production as unknown as Raw)[field])) : [] }; });
  const opggDifference = opggCount - records.length;
  const productionNames = new Map(records.flatMap((record) => [[identity(record.nameEn), record], [identity(record.nameZh), record]] as const));
  const matched = new Map<number, typeof records[number]>(); const usedProduction = new Set<string>();
  opggRows.forEach((raw, index) => { const record = productionNames.get(identity(raw.sourceKey)) ?? productionNames.get(identity(raw.name ?? raw.nameLocalized)); if (record && !usedProduction.has(record.id)) { matched.set(index, record); usedProduction.add(record.id); } });
  const edges = opggRows.flatMap((raw, index) => matched.has(index) ? [] : records.filter((record) => !usedProduction.has(record.id)).map((record) => ({ index, record, score: similarity(raw.effect, record.effects.normal) + (String(raw.category).toLowerCase().replace('goldxp', 'gold_xp') === record.category ? .25 : 0) + (raw.cost === record.cost ? .15 : 0) }))).sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id));
  for (const edge of edges) if (!matched.has(edge.index) && !usedProduction.has(edge.record.id)) { matched.set(edge.index, edge.record); usedProduction.add(edge.record.id); }
  const opMatched = [...matched].map(([index, production]) => ({ raw: opggRows[index]!, production, matchMethod: productionNames.get(identity(opggRows[index]!.sourceKey)) === production || productionNames.get(identity(opggRows[index]!.name)) === production ? 'exact_name_or_key' : 'effect_category_cost_alias_candidate' }));
  const opOnly = opggRows.map((raw, index) => ({ raw, index })).filter(({ index }) => !matched.has(index)).map(({ raw }) => ({ record: raw, classification: raw.appearanceCondition ? 'C' : 'A', reason: raw.appearanceCondition ? 'OP.GG exposes a record-level conditional Wisp absent from DataTFT; corpus-policy review is required.' : 'OP.GG exposes this record in its current All Wisps catalog with cost and effect, but DataTFT has no corresponding row.' }));
  const matchedProductionIds = new Set(opMatched.map((item) => item.production!.id));
  const categoryDiscrepancies = opMatched.filter(({ raw, production }) => String(raw.category).toLowerCase().replace('goldxp', 'gold_xp') !== production.category).map(({ raw, production }) => ({ productionId: production.id, dataTft: production.category, opgg: raw.category }));
  const corpusDiff = { dataTftOnly: records.filter((record) => !matchedProductionIds.has(record.id)).map(({ id, nameEn, nameZh }) => ({ id, nameEn, nameZh })), opggOnly: opOnly, intersection: opMatched.map((item) => ({ productionId: item.production.id, opggKey: item.raw.sourceKey, opggName: item.raw.name, matchMethod: item.matchMethod })), aliasCandidates: opMatched.filter((item) => item.matchMethod.includes('alias')).map((item) => ({ productionId: item.production.id, dataTftName: item.production.nameZh, opggKey: item.raw.sourceKey, opggName: item.raw.name })), categoryDiscrepancies, categoryCountBySource: { datatft: categoryCounts, opgg: opggCategoryCounts }, matchedByExactId: [], matchedByExactEnglishName: opMatched.filter((item) => item.matchMethod === 'exact_name_or_key').map((item) => item.production.id), matchedByExactChineseName: [], needsReview: opOnly, excludedFromProduction: opOnly, classificationCounts: Object.fromEntries(['A','B','C','D','E','F'].map((code) => [code, opOnly.filter((item) => item.classification === code).length])), reason: `All ${opggCount} OP.GG rows were parsed. The normalized corpus remains ${records.length}: the ${opOnly.length} record-level differences are retained as A/C review evidence rather than automatically promoted without timing/provenance fields required by the production schema.` };
  const cdPrismatic = [...new Set((cdEn.records as Raw[]).filter((r) => /prismatic/i.test(r.apiName as string)).map((r) => r.name as string))].sort();
  const dtPrismatic = records.filter((r) => r.effects.prismatic).map((r) => r.nameEn).sort();
  const lolPrismatic = lolchessRows.filter((raw) => raw.prismatic).map((raw) => String(raw.nameEn ?? raw.name)).sort();
  const prismaticAudit = { dataTft: dtPrismatic, dataTftCount: dtPrismatic.length, lolchess: lolPrismatic, lolchessHumanObservedCount: lolchessPrismaticCount, communityDragon: cdPrismatic, communityDragonCount: cdPrismatic.length, allThreeAgree: dtPrismatic.filter((name) => cdPrismatic.includes(name) && lolPrismatic.includes(name)), intersectionDataTftCommunityDragon: dtPrismatic.filter((name) => cdPrismatic.includes(name)), dataTftCommunityDragonOnly: dtPrismatic.filter((name) => cdPrismatic.includes(name) && !lolPrismatic.includes(name)), c1Only: dtPrismatic.filter((name) => !cdPrismatic.includes(name)), lolchessOnly: lolPrismatic.filter((name) => !dtPrismatic.includes(name)), chosenStatus: 'needs_review', reason: lolchessRows.length ? 'Record identities imported; definition/content differences still require reviewed resolutions.' : 'LoLCHESS record identities were not available from the blocked cloud fetch; no attempt was made to force either count.', needsReview: [...new Set([...dtPrismatic, ...lolPrismatic])] };
  const variantAudit = { totalVariants: (cdEn.records as Raw[]).length, baseVariants: (cdEn.records as Raw[]).filter((r) => variantKind(r.apiName as string) === 'base').length, upgradeVariants: (cdEn.records as Raw[]).filter((r) => variantKind(r.apiName as string) === 'upgrade').length, prismaticVariants: (cdEn.records as Raw[]).filter((r) => variantKind(r.apiName as string) === 'prismatic').length, uniqueDisplayNames: new Set((cdEn.records as Raw[]).map((r) => r.name)).size, normalizedWithDistinctBlossom: records.filter((r) => r.effects.blossom).length };
  await mkdir(resolve(root, 'data/normalized'), { recursive: true }); await mkdir(resolve(root, 'reports'), { recursive: true });
  const corpusReconciliation = { corpusDefinition: 'All live-patch Wisps that can actually be offered in a normal or rules-authorized Wisp slot; upgrade/prismatic variants, inactive/internal records, and aliases are not separate corpus entries.', sources: [{ source: 'communitydragon', rawCount: (cdEn.records as Raw[]).length, acceptedBaseCount: variantAudit.baseVariants, matchedToProduction: records.length - missingRiotId.length, unmatched: communityOnly, excluded: variantAudit.upgradeVariants + variantAudit.prismaticVariants, exclusionReasons: ['Upgrade and Prismatic variants are field variants, not separate base corpus rows.'] }, { source: 'datatft', rawCount: records.length, acceptedBaseCount: records.length, matchedToProduction: records.length, unmatched: [], excluded: 0, exclusionReasons: [] }, { source: 'opgg', rawCount: opggRows.length, observedCount: opggCount, acceptedBaseCount: opMatched.length, matchedToProduction: opMatched.length, unmatched: opOnly, excluded: 0, exclusionReasons: ['No row is excluded without record-level activation/alias evidence.'] }, { source: 'lolchess', rawCount: lolchessRows.length, acceptedBaseCount: lolchessRows.length, matchedToProduction: lolchessRows.filter((raw) => productionNames.has(String(raw.nameEn ?? raw.name).toLowerCase())).length, unmatched: lolchessRows.filter((raw) => !productionNames.has(String(raw.nameEn ?? raw.name).toLowerCase())), excluded: 0, exclusionReasons: [] }] };
  for (const [path, value] of [['data/normalized/wisps_18.1.json', dataset], ['public/data/wisps.json', dataset], ['reports/data-coverage-18.1.json', coverage], ['reports/data-conflicts-18.1.json', conflicts], ['reports/data-unmatched-18.1.json', unmatched], ['reports/data-schema-gaps-18.1.json', schemaGaps], ['reports/seed-regression-18.1.json', seedRegression], ['reports/data-corpus-diff-18.1.json', corpusDiff], ['reports/data-corpus-reconciliation-18.1.json', corpusReconciliation], ['reports/data-prismatic-audit-18.1.json', prismaticAudit], ['reports/data-communitydragon-variants-18.1.json', variantAudit]] as const) await writeFile(resolve(root, path), stable(value));
  const audit = `# TFT 18.1 Wisp data audit\n\n- Snapshot: ${at}; OP.GG retrieved ${opgg.retrievedAt}.\n- Corpus definition: all live-patch Wisps that can actually be offered in a normal or rules-authorized Wisp slot. Upgrade/Prismatic variants, inactive/internal records, and aliases are not separate entries.\n- OP.GG: HTTP ${opgg.httpStatus}, SHA-256 ${opgg.sha256}, ${opggCount} parsed rows. Category counts: ${JSON.stringify(opggCategoryCounts)}. This replaces the obsolete blocked observation.\n- Reconciliation: ${opMatched.length} OP.GG/DataTFT intersection, ${opOnly.length} OP.GG-only, ${records.length - matchedProductionIds.size} DataTFT-only. The OP.GG-only rows are individually classified: ${JSON.stringify(Object.fromEntries(['A','B','C','D','E','F'].map((code) => [code, opOnly.filter((item) => item.classification === code).length])))}. A means a catalogued live-shaped row missing from DataTFT; C means a conditional corpus-policy difference.\n- Normalized remains ${records.length}, after evidence review rather than a 200-count assumption: the 31 rows are not promoted until their timing and production-required provenance can be established.\n- CommunityDragon: ${(cdZh.records as Raw[]).length} variants (${variantAudit.baseVariants} base, ${variantAudit.upgradeVariants} Upgrade, ${variantAudit.prismaticVariants} Prismatic); exact localized-name intersection ${coverage.intersectionByExactLocalizedName}.\n- Riot/client ID coverage: ${coverage.withRiotId}/${records.length}; Chinese-name coverage: ${records.length}/${records.length}.\n- Blossom: ${coverage.withBlossom}; Mitosis remains null because its client Upgrade text is not distinct. Prismatic: DataTFT ${dtPrismatic.length}, CommunityDragon ${cdPrismatic.length}, LoLCHESS human observation ${lolchessPrismaticCount}.\n- LoLCHESS ordinary GET was attempted once and received HTTP ${lolchess.httpStatus} AWS WAF protection; no bypass was attempted. The browser snapshot importer remains the fallback.\n- oncePerGame and reofferCooldownShops remain explicit unknown knowledge states; minimumAffordableGold remains omitted.\n- **Production ready: no.** The build remains deterministic and offline from committed snapshots.\n`;
  await writeFile(resolve(root, 'reports/data-audit-18.1.md'), audit);
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
