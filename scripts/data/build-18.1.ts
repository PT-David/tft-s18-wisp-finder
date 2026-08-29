import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalClientKey, reconcileRecords } from './lib/reconcile';

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
    conflict('corpus_count', 'critical', 'corpus size', String(datatft.sourceId), String(opgg.sourceId), records.length, opggCount, true, 'Source counts are not treated as an intersection. Only strong identity matches establish overlap; corpus membership and production completeness are separate states.'),
    conflict('category_counts', 'high', 'category distribution', String(datatft.sourceId), String(opgg.sourceId), categoryCounts, opggCategoryCounts, true, 'Aggregate category differences are retained independently from identity matching.'),
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
  const reconciliationInput = records.map((record) => ({ id: record.id, riotId: record.riotId, nameEn: record.nameEn, nameZh: record.nameZh, category: String(record.category), cost: Number(record.cost), effect: record.effects.normal }));
  const reconciliation = reconcileRecords(opggRows, reconciliationInput, cdEn.records as unknown as Array<{ apiName: string; name?: string }>);
  const methodCounts = Object.fromEntries(['exact_client_key','exact_english_name','exact_chinese_name','reviewed_alias'].map((method) => [method, reconciliation.confirmedMatches.filter((match) => match.matchMethod === method).length]));
  const dataTftOnlyConfirmed = records.filter(({ id }) => !reconciliation.matchedProduction.has(id)).map(({ id, nameEn, nameZh, riotId }) => ({ id, nameEn, nameZh, riotId }));
  const opggUnmatched = opggRows.map((record, index) => ({ record, index })).filter(({ index }) => !reconciliation.matchedOpgg.has(index));
  const clientSupportedUnlinked = opggUnmatched.filter(({ record }) => { const key = canonicalClientKey(record.sourceKey); return key && reconciliation.clientByKey.has(key); }).map(({ record }) => { const key = canonicalClientKey(record.sourceKey)!; const client = reconciliation.clientByKey.get(key)!; return { record, corpusMembership: 'confirmed', productionRecordStatus: 'identity_link_unresolved', evidence: { opggCurrentCatalog: true, canonicalClientKey: key, communityDragonApiName: client.apiName, communityDragonVariantKind: 'base' }, reason: 'OP.GG and CommunityDragon confirm this corpus identity, but they do not prove it is distinct from every unmatched DataTFT row.' }; });
  const supportedKeys = new Set(clientSupportedUnlinked.map(({ record }) => record.sourceKey));
  const unresolvedOpgg = opggUnmatched.map(({ record }) => ({ record, classification: 'F', corpusMembership: supportedKeys.has(record.sourceKey) ? 'confirmed_identity_unlinked' : 'unresolved', reason: supportedKeys.has(record.sourceKey) ? 'A CommunityDragon base identity confirms corpus membership, but the DataTFT identity link remains unresolved.' : 'No strong cross-source identity establishes whether this is distinct from an unmatched DataTFT row.' }));
  const opggOnlyConfirmed: unknown[] = [];
  const confirmedCorpusButIncomplete = clientSupportedUnlinked;
  coverage.unmatchedCount = unresolvedOpgg.length + dataTftOnlyConfirmed.length;
  coverage.unionByAcceptedSkeleton = records.length;
  const categoryDiscrepancies = reconciliation.confirmedMatches.flatMap((match) => { const raw = opggRows.find((row) => row.sourceKey === match.opggSourceKey)!; const production = records.find((row) => row.id === match.productionId)!; return String(raw.category).toLowerCase().replace('goldxp', 'gold_xp') === production.category ? [] : [{ productionId: production.id, dataTft: production.category, opgg: raw.category }]; });
  const corpusDiff = { confirmedIntersection: reconciliation.confirmedMatches.length, confirmedMatches: reconciliation.confirmedMatches, candidateMatches: reconciliation.candidateMatches, opggOnlyConfirmed, dataTftOnlyConfirmed, ambiguous: reconciliation.ambiguous, unresolved: { opgg: unresolvedOpgg, dataTft: dataTftOnlyConfirmed }, confirmedCorpusButIncomplete, categoryDiscrepancies, categoryCountBySource: { datatft: categoryCounts, opgg: opggCategoryCounts }, matchMethodCounts: methodCounts, classificationCounts: Object.fromEntries(['A','B','C','D','E','F'].map((code) => [code, unresolvedOpgg.filter((item) => item.classification === code).length])), corpusEstimate: { confirmedMinimum: records.length, unresolvedOpgg: unresolvedOpgg.length, normalizedProductionCount: records.length }, reason: 'Only client identity, unique exact names, or reviewed aliases enter the confirmed intersection. A client-supported unlinked identity is not counted as OP.GG-only because it may alias an unmatched DataTFT row.' };
  const cdPrismatic = [...new Set((cdEn.records as Raw[]).filter((r) => /prismatic/i.test(r.apiName as string)).map((r) => r.name as string))].sort();
  const dtPrismatic = records.filter((r) => r.effects.prismatic).map((r) => r.nameEn).sort();
  const lolPrismatic = lolchessRows.filter((raw) => raw.prismatic).map((raw) => String(raw.nameEn ?? raw.name)).sort();
  const prismaticAudit = { dataTft: dtPrismatic, dataTftCount: dtPrismatic.length, lolchess: lolPrismatic, lolchessHumanObservedCount: lolchessPrismaticCount, communityDragon: cdPrismatic, communityDragonCount: cdPrismatic.length, allThreeAgree: dtPrismatic.filter((name) => cdPrismatic.includes(name) && lolPrismatic.includes(name)), intersectionDataTftCommunityDragon: dtPrismatic.filter((name) => cdPrismatic.includes(name)), dataTftCommunityDragonOnly: dtPrismatic.filter((name) => cdPrismatic.includes(name) && !lolPrismatic.includes(name)), c1Only: dtPrismatic.filter((name) => !cdPrismatic.includes(name)), lolchessOnly: lolPrismatic.filter((name) => !dtPrismatic.includes(name)), chosenStatus: 'needs_review', reason: lolchessRows.length ? 'Record identities imported; definition/content differences still require reviewed resolutions.' : 'LoLCHESS record identities were not available from the blocked cloud fetch; no attempt was made to force either count.', needsReview: [...new Set([...dtPrismatic, ...lolPrismatic])] };
  const variantAudit = { totalVariants: (cdEn.records as Raw[]).length, baseVariants: (cdEn.records as Raw[]).filter((r) => variantKind(r.apiName as string) === 'base').length, upgradeVariants: (cdEn.records as Raw[]).filter((r) => variantKind(r.apiName as string) === 'upgrade').length, prismaticVariants: (cdEn.records as Raw[]).filter((r) => variantKind(r.apiName as string) === 'prismatic').length, uniqueDisplayNames: new Set((cdEn.records as Raw[]).map((r) => r.name)).size, normalizedWithDistinctBlossom: records.filter((r) => r.effects.blossom).length };
  await mkdir(resolve(root, 'data/normalized'), { recursive: true }); await mkdir(resolve(root, 'reports'), { recursive: true });
  const corpusReconciliation = { corpusDefinition: 'All live-patch Wisps actually offered in a normal or rules-authorized Wisp slot. Conditional appearance does not exclude a Wisp; only inactive/internal/non-offerable records, variants, and aliases are excluded with evidence.', confirmedCorpusMinimum: records.length, normalizedProductionCount: records.length, productionReady: false, matching: { confirmedIntersection: reconciliation.confirmedMatches.length, methodCounts, candidateCount: reconciliation.candidateMatches.length, ambiguousCount: reconciliation.ambiguous.length, unresolvedOpggCount: unresolvedOpgg.length, dataTftOnlyCount: dataTftOnlyConfirmed.length }, confirmedCorpusButIncomplete, sources: [{ source: 'communitydragon', rawCount: (cdEn.records as Raw[]).length, acceptedBaseCount: variantAudit.baseVariants, excludedVariants: variantAudit.upgradeVariants + variantAudit.prismaticVariants }, { source: 'datatft', rawCount: records.length, normalizedProductionCount: records.length }, { source: 'opgg', rawCount: opggRows.length, confirmedMatched: reconciliation.confirmedMatches.length, confirmedDistinctOnly: 0, clientSupportedUnlinked: confirmedCorpusButIncomplete.length, unresolved: unresolvedOpgg.length }, { source: 'lolchess', rawCount: lolchessRows.length, fetchStatus: lolchess.fetchStatus }] };
  const matchReview = { policy: { confirmedMethods: ['exact_client_key','exact_english_name','exact_chinese_name','reviewed_alias'], candidateSignalsNeverAutoConfirm: ['effect_similarity','name_similarity','category','cost','appearanceCondition'], ambiguityMargin: 0.1 }, candidateMatches: reconciliation.candidateMatches, ambiguous: reconciliation.ambiguous, unresolved: { opgg: unresolvedOpgg, dataTft: dataTftOnlyConfirmed } };
  for (const [path, value] of [['data/normalized/wisps_18.1.json', dataset], ['public/data/wisps.json', dataset], ['reports/data-coverage-18.1.json', coverage], ['reports/data-conflicts-18.1.json', conflicts], ['reports/data-unmatched-18.1.json', unmatched], ['reports/data-schema-gaps-18.1.json', schemaGaps], ['reports/seed-regression-18.1.json', seedRegression], ['reports/data-corpus-diff-18.1.json', corpusDiff], ['reports/data-corpus-reconciliation-18.1.json', corpusReconciliation], ['reports/data-match-review-18.1.json', matchReview], ['reports/data-prismatic-audit-18.1.json', prismaticAudit], ['reports/data-communitydragon-variants-18.1.json', variantAudit]] as const) await writeFile(resolve(root, path), stable(value));
  const audit = `# TFT 18.1 Wisp 数据审计\n\n- 快照：DataTFT ${at}；OP.GG ${opgg.retrievedAt}。\n- OP.GG：HTTP ${opgg.httpStatus}，SHA-256 ${opgg.sha256}，页面声明 ${opgg.declaredRecordCount ?? opggCount} 条，实际解析 ${opggCount} 条；分类合计 ${Object.values(opggCategoryCounts).reduce<number>((sum, value) => sum + Number(value), 0)}。\n- 旧算法会无阈值地耗尽两侧记录，因而人为制造 169/31/0；该结果已删除。新规则只有 client key、唯一英文名、唯一中文名和 reviewed alias 可以确认身份。\n- 确认交集：${reconciliation.confirmedMatches.length}（${JSON.stringify(methodCounts)}）；模糊候选 ${reconciliation.candidateMatches.length}，其中 ambiguous ${reconciliation.ambiguous.length}。候选不会进入确认交集。\n- 确认 OP.GG-only：${opggOnlyConfirmed.length}；确认 DataTFT-only：${dataTftOnlyConfirmed.length}；OP.GG unresolved：${unresolvedOpgg.length}。原 31 条差异结论已全部撤销并按当前强证据重新计算。\n- CommunityDragon 为 ${confirmedCorpusButIncomplete.length} 条未链接 OP.GG identity 提供 exact base client identity；它确认 corpus 身份，但不能证明这些记录与 17 条 DataTFT unmatched rows 相互独立，因此 confirmed OP.GG-only 仍为 0。\n- appearanceCondition 只作为需求字段，绝不再决定 A/C 或排除。规则授权的条件 Wisp 仍属于 corpus。\n- 当前可证实 corpus 下限为 ${records.length}；normalized production 也是 ${records.length}。另有 ${confirmedCorpusButIncomplete.length} 个已确认 corpus identity 尚未完成 DataTFT/production 身份链接，不能重复计数。\n- Blossom ${coverage.withBlossom}；Mitosis 的非独立 Upgrade 仍为 null。Knowledge<T>、字段 provenance、seed/production 分离均保持不变。\n- LoLCHESS 普通 GET 收到 HTTP ${lolchess.httpStatus} AWS WAF；未绕过，browser snapshot importer 仍为 fallback。\n- **Production ready：否。** 当前仍需人工审核 ${reconciliation.candidateMatches.length} 个 OP.GG candidate group 与 ${dataTftOnlyConfirmed.length} 个 DataTFT unmatched rows；离线构建保持确定性。\n`;
  await writeFile(resolve(root, 'reports/data-audit-18.1.md'), audit);
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
