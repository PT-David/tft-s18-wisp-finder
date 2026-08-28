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
  const opggObservation = opgg.humanReviewObservation as Raw;
  const opggCount = opggObservation.recordCount as number;
  const opggCategoryCounts = opggObservation.categoryCounts as Raw;
  const lolchessObservation = lolchess.humanReviewObservation as Raw;
  const lolchessPrismaticCount = lolchessObservation.prismaticBlossomsOnlyCount as number;
  const opggRows = (opggImported?.records ?? opgg.records) as Raw[];
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
    conflict('corpus_count', 'critical', 'corpus size', 'datatft_18_1_20260828', 'opgg_set18_wisps_20260828', records.length, opggCount, true, 'Record-level OP.GG export is required to classify the observed difference.'),
    conflict('category_counts', 'high', 'category distribution', 'datatft_18_1_20260828', 'opgg_set18_wisps_20260828', categoryCounts, opggCategoryCounts, true, 'Every category except Champion and Shop differs.'),
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
  const productionNames = new Map(records.flatMap((record) => [[record.nameEn.toLowerCase(), record], [record.nameZh.toLowerCase(), record]] as const));
  const opMatched = opggRows.map((raw) => ({ raw, production: productionNames.get(String(raw.nameEn ?? raw.name ?? raw.nameLocalized ?? '').toLowerCase()) })).filter((item) => item.production);
  const opOnly = opggRows.filter((raw) => !productionNames.has(String(raw.nameEn ?? raw.name ?? raw.nameLocalized ?? '').toLowerCase())).map((raw) => ({ record: raw, classification: 'F', reason: 'No exact ID/name match; explicit alias or activation evidence is required.' }));
  const matchedProductionIds = new Set(opMatched.map((item) => item.production!.id));
  const corpusDiff = { dataTftOnly: opggRows.length ? records.filter((record) => !matchedProductionIds.has(record.id)).map(({ id, nameEn, nameZh }) => ({ id, nameEn, nameZh })) : [], opggOnly: opOnly, intersection: opMatched.map((item) => ({ productionId: item.production!.id, name: item.raw.name ?? item.raw.nameEn })), categoryCountBySource: { datatft: categoryCounts, opgg: opggCategoryCounts }, matchedByExactId: [], matchedByExactEnglishName: opMatched.map((item) => item.production!.id), matchedByExactChineseName: [], needsReview: opggRows.length ? opOnly : [{ count: opggDifference, classification: 'F', reason: 'OP.GG record-level snapshot was blocked in this environment; individual identities cannot be responsibly invented.' }], excludedFromProduction: [], reason: `The normalized corpus remains the ${records.length} committed DataTFT rows because they are the only complete record-level skeleton available. This is provisional, not proof of completeness.` };
  const cdPrismatic = [...new Set((cdEn.records as Raw[]).filter((r) => /prismatic/i.test(r.apiName as string)).map((r) => r.name as string))].sort();
  const dtPrismatic = records.filter((r) => r.effects.prismatic).map((r) => r.nameEn).sort();
  const lolPrismatic = lolchessRows.filter((raw) => raw.prismatic).map((raw) => String(raw.nameEn ?? raw.name)).sort();
  const prismaticAudit = { dataTft: dtPrismatic, dataTftCount: dtPrismatic.length, lolchess: lolPrismatic, lolchessHumanObservedCount: lolchessPrismaticCount, communityDragon: cdPrismatic, communityDragonCount: cdPrismatic.length, allThreeAgree: dtPrismatic.filter((name) => cdPrismatic.includes(name) && lolPrismatic.includes(name)), intersectionDataTftCommunityDragon: dtPrismatic.filter((name) => cdPrismatic.includes(name)), dataTftCommunityDragonOnly: dtPrismatic.filter((name) => cdPrismatic.includes(name) && !lolPrismatic.includes(name)), c1Only: dtPrismatic.filter((name) => !cdPrismatic.includes(name)), lolchessOnly: lolPrismatic.filter((name) => !dtPrismatic.includes(name)), chosenStatus: 'needs_review', reason: lolchessRows.length ? 'Record identities imported; definition/content differences still require reviewed resolutions.' : 'LoLCHESS record identities were not available from the blocked cloud fetch; no attempt was made to force either count.', needsReview: [...new Set([...dtPrismatic, ...lolPrismatic])] };
  const variantAudit = { totalVariants: (cdEn.records as Raw[]).length, baseVariants: (cdEn.records as Raw[]).filter((r) => variantKind(r.apiName as string) === 'base').length, upgradeVariants: (cdEn.records as Raw[]).filter((r) => variantKind(r.apiName as string) === 'upgrade').length, prismaticVariants: (cdEn.records as Raw[]).filter((r) => variantKind(r.apiName as string) === 'prismatic').length, uniqueDisplayNames: new Set((cdEn.records as Raw[]).map((r) => r.name)).size, normalizedWithDistinctBlossom: records.filter((r) => r.effects.blossom).length };
  await mkdir(resolve(root, 'data/normalized'), { recursive: true }); await mkdir(resolve(root, 'reports'), { recursive: true });
  const corpusReconciliation = { corpusDefinition: 'All live-patch Wisps that can actually be offered in a normal or rules-authorized Wisp slot; upgrade/prismatic variants, inactive/internal records, and aliases are not separate corpus entries.', sources: [{ source: 'communitydragon', rawCount: (cdEn.records as Raw[]).length, acceptedBaseCount: variantAudit.baseVariants, matchedToProduction: records.length - missingRiotId.length, unmatched: communityOnly, excluded: variantAudit.upgradeVariants + variantAudit.prismaticVariants, exclusionReasons: ['Upgrade and Prismatic variants are field variants, not separate base corpus rows.'] }, { source: 'datatft', rawCount: records.length, acceptedBaseCount: records.length, matchedToProduction: records.length, unmatched: [], excluded: 0, exclusionReasons: [] }, { source: 'opgg', rawCount: opggRows.length, observedCount: opggCount, acceptedBaseCount: opMatched.length, matchedToProduction: opMatched.length, unmatched: opOnly, excluded: 0, exclusionReasons: ['No row is excluded without record-level activation/alias evidence.'] }, { source: 'lolchess', rawCount: lolchessRows.length, acceptedBaseCount: lolchessRows.length, matchedToProduction: lolchessRows.filter((raw) => productionNames.has(String(raw.nameEn ?? raw.name).toLowerCase())).length, unmatched: lolchessRows.filter((raw) => !productionNames.has(String(raw.nameEn ?? raw.name).toLowerCase())), excluded: 0, exclusionReasons: [] }] };
  for (const [path, value] of [['data/normalized/wisps_18.1.json', dataset], ['public/data/wisps.json', dataset], ['reports/data-coverage-18.1.json', coverage], ['reports/data-conflicts-18.1.json', conflicts], ['reports/data-unmatched-18.1.json', unmatched], ['reports/data-schema-gaps-18.1.json', schemaGaps], ['reports/seed-regression-18.1.json', seedRegression], ['reports/data-corpus-diff-18.1.json', corpusDiff], ['reports/data-corpus-reconciliation-18.1.json', corpusReconciliation], ['reports/data-prismatic-audit-18.1.json', prismaticAudit], ['reports/data-communitydragon-variants-18.1.json', variantAudit]] as const) await writeFile(resolve(root, path), stable(value));
  const audit = `# TFT 18.1 Wisp data audit\n\n- Snapshot: ${at}.\n- Corpus definition: all live-patch Wisps that can actually be offered in a normal or rules-authorized Wisp slot. Upgrade/Prismatic variants, inactive/internal records, and aliases are not separate entries.\n- Corpus status: DataTFT has ${records.length} committed rows; OP.GG human review observed ${opggCount}, but normal GETs to the zh-cn/zh-tw/en Set 18 pages received HTTP ${opgg.httpStatus} at this environment tunnel and therefore have no record-level identities. The observed ${opggDifference}-row difference remains individually unclassified (F: insufficient evidence).\n- CommunityDragon: ${(cdZh.records as Raw[]).length} variants (${variantAudit.baseVariants} base-shaped, ${variantAudit.upgradeVariants} Upgrade-shaped, ${variantAudit.prismaticVariants} Prismatic-shaped). Exact localized-name intersection: ${coverage.intersectionByExactLocalizedName}. The 163/169/200 counts reflect client base-shaped records, DataTFT displayed rows, and an OP.GG aggregate observation respectively; only record-level activation evidence can resolve their policy differences.\n- Normalized remains ${records.length}: it is the only committed complete record-level skeleton, not because completeness is proven. No production records were added or removed in this pass.\n- Riot/client ID coverage: ${coverage.withRiotId}/${records.length}; Chinese-name coverage: ${records.length}/${records.length}. The ${missingRiotId.length} fallback Chinese names cite DataTFT, not CommunityDragon.\n- Blossom: ${coverage.withBlossom}; Mitosis is null because its client Upgrade text is not distinct. Prismatic: DataTFT ${dtPrismatic.length}, CommunityDragon ${cdPrismatic.length}, LoLCHESS human observation ${lolchessPrismaticCount}; record-level LoLCHESS identities are still required.\n- LoLCHESS pageUpdatedAt remains null. 2026-08-26 is retained only as a public-index observation; it is not substituted for a date from page body.\n- oncePerGame and reofferCooldownShops remain explicit unknown knowledge states; minimumAffordableGold remains omitted. Requirements remain DataTFT-sourced until LoLCHESS rows can be compared.\n- Blocking unresolved conflicts: ${coverage.unresolvedCriticalConflicts}; unmatched entries: ${coverage.unmatchedCount}.\n- **Production ready: no.** Use the source-specific browser import commands documented in reports/browser-snapshot-needed-18.1.md, then rebuild offline.\n`;
  await writeFile(resolve(root, 'reports/data-audit-18.1.md'), audit);
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
