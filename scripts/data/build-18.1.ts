import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type Raw = Record<string, unknown>;
const root = resolve(import.meta.dirname, '../..');
const load = async (path: string) => JSON.parse(await readFile(resolve(root, path), 'utf8')) as Raw;
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
  const dataset = { patch: '18.1', datasetStatus: 'audited_snapshot_not_production_ready', productionReady: false, verifiedAt: at, records };
  const categoryCounts = Object.fromEntries(['champion','combat','misc','shop','gold_xp','risky','item'].map((category) => [category, records.filter((r) => r.category === category).length]));
  const coverage = {
    patch: '18.1', productionReady: false,
    sourceRecordCounts: { datatft: (datatft.records as Raw[]).length, communitydragonEnVariants: (cdEn.records as Raw[]).length, communitydragonZhVariants: (cdZh.records as Raw[]).length, opggHumanObserved: opggCount, opggExtracted: (opgg.records as Raw[]).length, lolchess: 0 },
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
  const corpusDiff = { dataTftOnly: [], opggOnly: [], intersection: [], categoryCountBySource: { datatft: categoryCounts, opgg: opggCategoryCounts }, matchedByExactId: [], matchedByExactEnglishName: [], matchedByExactChineseName: [], needsReview: [{ count: opggDifference, classification: 'F', reason: 'OP.GG record-level snapshot was blocked in this environment; individual identities cannot be responsibly invented.' }], excludedFromProduction: [], reason: `The normalized corpus remains the ${records.length} committed DataTFT rows because they are the only complete record-level skeleton available. This is provisional, not proof of completeness.` };
  const cdPrismatic = [...new Set((cdEn.records as Raw[]).filter((r) => /prismatic/i.test(r.apiName as string)).map((r) => r.name as string))].sort();
  const dtPrismatic = records.filter((r) => r.effects.prismatic).map((r) => r.nameEn).sort();
  const prismaticAudit = { dataTft: dtPrismatic, dataTftCount: dtPrismatic.length, lolchess: [], lolchessHumanObservedCount: lolchessPrismaticCount, communityDragon: cdPrismatic, communityDragonCount: cdPrismatic.length, intersectionDataTftCommunityDragon: dtPrismatic.filter((name) => cdPrismatic.includes(name)), c1Only: dtPrismatic.filter((name) => !cdPrismatic.includes(name)), lolchessOnly: [], chosenStatus: 'needs_review', reason: 'LoLCHESS record identities were not available from the blocked cloud fetch; no attempt was made to force either count.', needsReview: dtPrismatic };
  const variantAudit = { totalVariants: (cdEn.records as Raw[]).length, baseVariants: (cdEn.records as Raw[]).filter((r) => variantKind(r.apiName as string) === 'base').length, upgradeVariants: (cdEn.records as Raw[]).filter((r) => variantKind(r.apiName as string) === 'upgrade').length, prismaticVariants: (cdEn.records as Raw[]).filter((r) => variantKind(r.apiName as string) === 'prismatic').length, uniqueDisplayNames: new Set((cdEn.records as Raw[]).map((r) => r.name)).size, normalizedWithDistinctBlossom: records.filter((r) => r.effects.blossom).length };
  await mkdir(resolve(root, 'data/normalized'), { recursive: true }); await mkdir(resolve(root, 'reports'), { recursive: true });
  for (const [path, value] of [['data/normalized/wisps_18.1.json', dataset], ['public/data/wisps.json', dataset], ['reports/data-coverage-18.1.json', coverage], ['reports/data-conflicts-18.1.json', conflicts], ['reports/data-unmatched-18.1.json', unmatched], ['reports/data-schema-gaps-18.1.json', schemaGaps], ['reports/seed-regression-18.1.json', seedRegression], ['reports/data-corpus-diff-18.1.json', corpusDiff], ['reports/data-prismatic-audit-18.1.json', prismaticAudit], ['reports/data-communitydragon-variants-18.1.json', variantAudit]] as const) await writeFile(resolve(root, path), stable(value));
  const audit = `# TFT 18.1 Wisp data audit\n\n- Snapshot: ${at}.\n- Corpus status: DataTFT has ${records.length} committed rows; OP.GG human review observed ${opggCount}, but this environment received HTTP ${opgg.httpStatus} and therefore has no record-level OP.GG identities. The observed ${opggDifference}-row difference remains individually unclassified (F: insufficient evidence).\n- CommunityDragon: ${(cdZh.records as Raw[]).length} variants (${variantAudit.baseVariants} base-shaped, ${variantAudit.upgradeVariants} Upgrade-shaped, ${variantAudit.prismaticVariants} Prismatic-shaped; naming shapes may overlap). Exact localized-name intersection: ${coverage.intersectionByExactLocalizedName}.\n- Normalized remains ${records.length}: it is the only committed complete record-level skeleton, not because completeness is proven. No OP.GG-only row was automatically included or excluded.\n- Riot/client ID coverage: ${coverage.withRiotId}/${records.length}; Chinese-name coverage: ${records.length}/${records.length}. The ${missingRiotId.length} fallback Chinese names now cite DataTFT, not CommunityDragon.\n- Blossom: ${coverage.withBlossom}; Mitosis is null because its client Upgrade text is not distinct. Prismatic: DataTFT ${dtPrismatic.length}, CommunityDragon ${cdPrismatic.length}, LoLCHESS human observation ${lolchessPrismaticCount}; record-level LoLCHESS identities are still required.\n- oncePerGame and reofferCooldownShops are explicit unknown knowledge states for all production rows. minimumAffordableGold is omitted rather than inferred from cost.\n- Blocking unresolved conflicts: ${coverage.unresolvedCriticalConflicts}; unmatched entries: ${coverage.unmatchedCount}.\n- **Production ready: no.** Human/browser exports are still required for the OP.GG-only identities and LoLCHESS fields (name, category, stages, Blossom presence, Prismatic presence, requirements, once-per-game and cooldown).\n`;
  await writeFile(resolve(root, 'reports/data-audit-18.1.md'), audit);
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
