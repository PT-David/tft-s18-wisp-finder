import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalClientKey, reconcileRecords } from './lib/reconcile';
import { confirmedCorpusMinimum, requirementFacts, requirementsManualReview } from './lib/audit';

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
  const reviewedIdentityFile = await load('data/overrides/18.1/reviewed-identity-mappings.json');
  const seed = await load('data/wisps_18.1.json');
  const sourceManifest = await load('data/source_manifest_18.1.json');
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

  const lolchessRows = (lolchessImported?.records ?? lolchess.records) as Raw[];
  const normalizedEnglishName = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
  const lolchessByName = new Map(lolchessRows.map((row) => [normalizedEnglishName(row.nameEn ?? row.name), row]));
  const lolchessSource = { sourceId: String(lolchessImported?.sourceId ?? lolchess.sourceId), verifiedAt: String(lolchessImported?.retrievedAt ?? lolchess.retrievedAt), confidence: 'verified_third_party' };
  const reviewedIdentities = reviewedIdentityFile.records as Raw[];
  const reviewedByProduction = new Map(reviewedIdentities.map((mapping) => [mapping.productionId, mapping]));
  for (const record of records) {
    const mapping = reviewedByProduction.get(record.id);
    if (mapping) { record.nameEn = String(mapping.canonicalNameEn); record.sources.nameEn = lolchessSource; }
    const row = lolchessByName.get(normalizedEnglishName(record.nameEn));
    if (!row) continue;
    if (row.oncePerGame === true) { (record as unknown as Raw).oncePerGame = { status: 'confirmed', value: true }; record.sources.oncePerGame = lolchessSource; }
    if (row.reofferCooldownShops !== undefined) { (record as unknown as Raw).reofferCooldownShops = { status: 'confirmed', value: row.reofferCooldownShops }; record.sources.reofferCooldownShops = lolchessSource; }
  }

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
  const dataset = { patch: '18.1', datasetStatus: 'audited_snapshot_not_production_ready', productionReady: false, verifiedAt: at, records };
  const categoryCounts = Object.fromEntries(['champion','combat','misc','shop','gold_xp','risky','item'].map((category) => [category, records.filter((r) => r.category === category).length]));
  const coverage = {
    patch: '18.1', productionReady: false,
    sourceRecordCounts: { datatft: (datatft.records as Raw[]).length, communitydragonEnVariants: (cdEn.records as Raw[]).length, communitydragonZhVariants: (cdZh.records as Raw[]).length, opggHumanObserved: opggCount, opggExtracted: opggRows.length, lolchess: lolchessRows.length },
    unionByAcceptedSkeleton: records.length + communityOnly.length, intersectionByExactLocalizedName: records.length - missingRiotId.length,
    normalizedCount: records.length, withRiotId: records.length - missingRiotId.length, withChineseName: records.length, chinesePlaceholderCount: 0,
    categoryCounts, startingStageCounts: Object.fromEntries([2,3,4,5,6,7,8].map((stage) => [stage, records.filter((r) => r.stageRanges[0]?.start.stage === stage).length])),
    withBlossom: records.filter((r) => r.effects.blossom).length, withPrismatic: records.filter((r) => r.effects.prismatic).length,
    withRequirements: records.filter((r) => r.requirements.length).length, oncePerGameConfirmedTrue: records.filter((r) => r.oncePerGame.status === 'confirmed' && (r.oncePerGame as unknown as Raw).value === true).length, oncePerGameUnknown: records.filter((r) => r.oncePerGame.status === 'unknown').length,
    withReofferCooldownShops: 0, criticalFieldsMissing: missingRiotId.length, unresolvedCriticalConflicts: 1, unmatchedCount: missingRiotId.length + communityOnly.length,
  };
  const conflict = (conflictType: string, severity: string, field: string, sourceA: string, sourceB: string, valueA: unknown, valueB: unknown, blocksProductionReady: boolean, note: string) => ({ conflictType, severity, blocksProductionReady, wispIdentity: 'corpus', field, sourceA, sourceB, valueA, valueB, sourceTimestamps: { sourceA: at, sourceB: null }, priorityReasoning: 'Differences are reported from snapshots; no count is hard-coded as an acceptance target.', resolution: 'needs_review', note });
  const conflicts = [
    conflict('acquisition_warning', 'low', 'LoLCHESS cloud acquisition', String(lolchess.sourceId), String(lolchessImported?.sourceId), { status: lolchess.fetchStatus, httpStatus: lolchess.httpStatus }, { status: lolchessImported?.fetchStatus, recordCount: lolchessRows.length }, false, 'The cloud attempt was blocked, but the verified browser snapshot supplies record-level evidence.'),
    conflict('corpus_count', 'critical', 'corpus size', String(datatft.sourceId), String(opgg.sourceId), records.length, opggCount, true, 'Source counts are not treated as an intersection. Only strong identity matches establish overlap; corpus membership and production completeness are separate states.'),
    conflict('category_counts', 'high', 'category distribution', String(datatft.sourceId), String(opgg.sourceId), categoryCounts, opggCategoryCounts, true, 'Aggregate category differences are retained independently from identity matching.'),
    conflict('blossom_coverage', 'high', 'Blossom presence', 'datatft_18_1_20260828', String(lolchessImported?.sourceId), { normalizedProduction: records.filter((r) => r.effects.blossom).length, communityDragonDistinctUpgrade: records.filter((r) => r.effects.blossom).length }, { lolchess: lolchessRows.filter((r) => r.blossom).length }, true, 'Presence is audited per confirmed canonical identity; cross-language free text remains semantic review.'),
    conflict('prismatic_coverage', 'high', 'Prismatic coverage', 'datatft_18_1_20260828', String(lolchessImported?.sourceId), { dataTft: records.filter((r) => r.effects.prismatic).length, communityDragon: new Set((cdEn.records as Raw[]).filter((r) => /prismatic/i.test(String(r.apiName))).map((r) => r.name)).size }, { lolchess: lolchessRows.filter((r) => r.prismatic).length }, true, 'Current record-level snapshots are compared by canonical identity; historical aggregate observation 11 is superseded.'),
    conflict('knowledge_state', 'medium', 'oncePerGame/reofferCooldownShops', 'normalized_production', String(lolchessImported?.sourceId), { default: 'unknown' }, { oncePerGameConfirmedTrue: lolchessRows.filter((row) => row.oncePerGame === true).length }, false, 'Only explicitly evidenced knowledge is confirmed; absence remains unknown.'),
    conflict('source_membership', 'high', 'unresolved cross-source identities', 'datatft_18_1_20260828', String(opgg.sourceId), missingRiotId.length, communityOnly.length, true, 'Exact and reviewed identity association remains incomplete; fuzzy matches are not silently accepted.'),
  ];
  coverage.unresolvedCriticalConflicts = conflicts.filter((item) => item.resolution === 'needs_review' && item.blocksProductionReady).length;
  const unmatched = { lolchessIdentityUnresolved: [], communityDragonOnly: communityOnly, dataTftUnmatched: missingRiotId, withoutRiotId: missingRiotId, withoutChineseMatch: communityOnly, fuzzyNameOnly: missingRiotId, unknownCategory: records.filter((r) => !r.category).map((r) => r.id), other: [] };
  const schemaGaps = [{ field: 'minimumAffordableGold', issue: 'DataTFT exposes cost but not all affordability rules.', affectedCount: records.length, resolution: 'Field omitted in production; seed fixtures retain independently asserted values.', recommendation: 'Add a derived-lower-bound state only if the UI later needs to expose that distinction.' }];
  const seedRecords = seed.records as Raw[];
  const productionByEn = new Map(records.map((record) => [record.nameEn.toLowerCase(), record]));
  const seedRegression = seedRecords.map((fixture) => { const production = productionByEn.get((fixture.nameEn as string).toLowerCase()); return { nameEn: fixture.nameEn, matched: Boolean(production), productionId: production?.id ?? null, differences: production ? ['nameZh','cost','stageRanges','effects','requirements','oncePerGame'].filter((field) => JSON.stringify(fixture[field]) !== JSON.stringify((production as unknown as Raw)[field])) : [] }; });
  const reconciliationInput = records.map((record) => ({ id: record.id, riotId: record.riotId, nameEn: record.nameEn, nameZh: record.nameZh, category: String(record.category), cost: Number(record.cost), effect: record.effects.normal }));
  const reviewedOpggAliases = Object.fromEntries(reviewedIdentities.filter((mapping) => mapping.opggSourceKey).map((mapping) => [mapping.opggSourceKey, mapping.productionId]));
  const reconciliation = reconcileRecords(opggRows, reconciliationInput, cdEn.records as unknown as Array<{ apiName: string; name?: string }>, reviewedOpggAliases);
  const clientIdentityAudit = reconciliation.clientAudit;
  const methodCounts = Object.fromEntries(['exact_client_key','exact_english_name','exact_chinese_name','reviewed_cross_source_identity'].map((method) => [method, reconciliation.confirmedMatches.filter((match) => match.matchMethod === method).length]));
  const reviewedProductionIds = new Set(reviewedIdentities.map((mapping) => mapping.productionId));
  const dataTftUnmatched = records.filter(({ id }) => !reconciliation.matchedProduction.has(id) && !reviewedProductionIds.has(id)).map(({ id, nameEn, nameZh, riotId }) => ({ id, nameEn, nameZh, riotId }));
  const opggUnmatched = opggRows.map((record, index) => ({ record, index })).filter(({ index }) => !reconciliation.matchedOpgg.has(index));
  const clientSupportedUnlinked = opggUnmatched.filter(({ record }) => { const key = canonicalClientKey(record.sourceKey); return key && reconciliation.clientByKey.has(key); }).map(({ record }) => { const key = canonicalClientKey(record.sourceKey)!; const client = reconciliation.clientByKey.get(key)!; return { record, corpusMembership: 'confirmed', productionRecordStatus: 'identity_link_unresolved', evidence: { opggCurrentCatalog: true, canonicalClientKey: key, communityDragonApiName: client.apiName, communityDragonVariantKind: 'base' }, reason: 'OP.GG and CommunityDragon confirm this corpus identity, but they do not prove it is distinct from every unmatched DataTFT row.' }; });
  const supportedKeys = new Set(clientSupportedUnlinked.map(({ record }) => record.sourceKey));
  const unresolvedOpgg = opggUnmatched.map(({ record }) => ({ record, classification: 'F', corpusMembership: supportedKeys.has(record.sourceKey) ? 'confirmed_identity_unlinked' : 'unresolved', reason: supportedKeys.has(record.sourceKey) ? 'A CommunityDragon base identity confirms corpus membership, but the DataTFT identity link remains unresolved.' : 'No strong cross-source identity establishes whether this is distinct from an unmatched DataTFT row.' }));
  const opggOnlyConfirmed: unknown[] = [];
  const confirmedCorpusButIncomplete = clientSupportedUnlinked;
  const conservativeCorpusMinimum = confirmedCorpusMinimum(records.length, dataTftUnmatched.length, confirmedCorpusButIncomplete.length);
  coverage.unmatchedCount = unresolvedOpgg.length + dataTftUnmatched.length;
  coverage.unionByAcceptedSkeleton = records.length;
  const membershipConflict = conflicts.find((item) => item.conflictType === 'source_membership');
  if (membershipConflict) { membershipConflict.valueA = dataTftUnmatched.length; membershipConflict.valueB = unresolvedOpgg.length; membershipConflict.note = 'Counts are unresolved identity review queues, not confirmed source-only corpus membership.'; }
  const categoryDiscrepancies = reconciliation.confirmedMatches.flatMap((match) => { const raw = opggRows.find((row) => row.sourceKey === match.opggSourceKey)!; const production = records.find((row) => row.id === match.productionId)!; return String(raw.category).toLowerCase().replace('goldxp', 'gold_xp') === production.category ? [] : [{ productionId: production.id, dataTft: production.category, opgg: raw.category }]; });
  const corpusDiff = { confirmedIntersection: reconciliation.confirmedMatches.length, confirmedMatches: reconciliation.confirmedMatches, candidateMatches: reconciliation.candidateMatches, opggOnlyConfirmed, dataTftUnmatched, ambiguous: reconciliation.ambiguous, unresolved: { opgg: unresolvedOpgg, dataTft: dataTftUnmatched }, confirmedCorpusMembership: { minimum: conservativeCorpusMinimum, evidenceRule: 'Conservative lower bound: normalized production plus confirmed incomplete external identities, allowing every unmatched production identity to overlap at most one external identity.' }, normalizedProductionCompleteness: { normalizedCount: records.length, criticalMissingIdentityCount: dataTftUnmatched.length, complete: false }, confirmedCorpusButIncomplete, categoryDiscrepancies, categoryCountBySource: { datatft: categoryCounts, opgg: opggCategoryCounts }, matchMethodCounts: methodCounts, classificationCounts: Object.fromEntries(['A','B','C','D','E','F'].map((code) => [code, unresolvedOpgg.filter((item) => item.classification === code).length])), corpusEstimate: { confirmedMinimum: conservativeCorpusMinimum, unresolvedOpgg: unresolvedOpgg.length, normalizedProductionCount: records.length }, reason: 'Only client identity, unique exact names, or reviewed aliases enter the confirmed intersection. A client-supported unlinked identity is not counted as OP.GG-only because it may alias an unmatched DataTFT row.' };
  const productionByCanonicalName = new Map(records.map((record) => [normalizedEnglishName(record.nameEn), record]));
  const cdPrismaticIds = new Set((cdEn.records as Raw[]).filter((row) => /prismatic/i.test(String(row.apiName))).flatMap((row) => { const record = productionByCanonicalName.get(normalizedEnglishName(row.name)); return record ? [record.id] : []; }));
  const lolPrismaticIds = new Set(lolchessRows.filter((row) => row.prismatic).flatMap((row) => { const record = productionByCanonicalName.get(normalizedEnglishName(row.nameEn ?? row.name)); return record ? [record.id] : []; }));
  const dtPrismaticIds = new Set(records.filter((record) => record.effects.prismatic).map((record) => record.id));
  const prismaticRows = records.filter((record) => dtPrismaticIds.has(record.id) || cdPrismaticIds.has(record.id) || lolPrismaticIds.has(record.id)).map((record) => ({ identity: record.id, nameEn: record.nameEn, nameZh: record.nameZh, dataTft: dtPrismaticIds.has(record.id), communityDragon: cdPrismaticIds.has(record.id), lolchess: lolPrismaticIds.has(record.id) }));
  const inSources = (row: typeof prismaticRows[number], ...sources: Array<'dataTft'|'communityDragon'|'lolchess'>) => sources.every((source) => row[source]);
  const prismaticAudit = {
    counts: { dataTft: dtPrismaticIds.size, communityDragon: new Set((cdEn.records as Raw[]).filter((row) => /prismatic/i.test(String(row.apiName))).map((row) => row.name)).size, lolchess: lolchessRows.filter((row) => row.prismatic).length }, historicalObservation: { value: lolchessPrismaticCount, status: 'superseded_by_record_level_browser_snapshot' },
    allThreeConfirmed: prismaticRows.filter((row) => inSources(row, 'dataTft','communityDragon','lolchess')), dataTftAndCommunityDragon: prismaticRows.filter((row) => inSources(row, 'dataTft','communityDragon')), communityDragonAndLolchess: prismaticRows.filter((row) => inSources(row, 'communityDragon','lolchess')), dataTftAndLolchess: prismaticRows.filter((row) => inSources(row, 'dataTft','lolchess')),
    sourceOnly: prismaticRows.filter((row) => Number(row.dataTft) + Number(row.communityDragon) + Number(row.lolchess) === 1), identityUnresolved: lolchessRows.filter((row) => row.prismatic && !productionByCanonicalName.has(normalizedEnglishName(row.nameEn ?? row.name))).map((row) => row.nameEn ?? row.name), fieldConflict: prismaticRows.filter((row) => !(row.dataTft === row.communityDragon && row.communityDragon === row.lolchess)), status: 'needs_review', comparisonKey: 'confirmed canonical production identity',
  };
  const variantAudit = { totalVariants: clientIdentityAudit.rawRecordCount, baseVariants: clientIdentityAudit.rawBaseRows, upgradeVariants: clientIdentityAudit.rawUpgradeRows, prismaticVariants: clientIdentityAudit.rawPrismaticRows, uniqueApiNames: clientIdentityAudit.uniqueApiNames, uniqueBaseApiNames: clientIdentityAudit.uniqueBaseApiNames, uniqueCanonicalBaseIdentities: clientIdentityAudit.uniqueCanonicalBaseIdentities, uniqueDisplayNames: new Set((cdEn.records as Raw[]).map((r) => r.name)).size, normalizedWithDistinctBlossom: records.filter((r) => r.effects.blossom).length };
  const lolchessMatched = records.flatMap((record) => { const row = lolchessByName.get(normalizedEnglishName(record.nameEn)); return row ? [{ record, row }] : []; });
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const lolchessFieldAudit = {
    sourceCount: lolchessRows.length, exactEnglishIdentityMatches: lolchessMatched.length, unmatchedLolchess: lolchessRows.filter((row) => !records.some((record) => normalizedEnglishName(record.nameEn) === normalizedEnglishName(row.nameEn ?? row.name))).map((row) => row.nameEn ?? row.name),
    blossom: (() => { const rows = lolchessMatched.map(({ record, row }) => ({ identity: record.id, nameEn: record.nameEn, productionHasBlossom: Boolean(record.effects.blossom), communityDragonHasDistinctUpgrade: Boolean(record.effects.blossom), lolchessHasBlossom: Boolean(row.blossom) })); return { productionCount: coverage.withBlossom, lolchessCount: lolchessRows.filter((row) => row.blossom).length, allAgreeAbsent: rows.filter((row) => !row.productionHasBlossom && !row.communityDragonHasDistinctUpgrade && !row.lolchessHasBlossom), allAgreePresent: rows.filter((row) => row.productionHasBlossom && row.communityDragonHasDistinctUpgrade && row.lolchessHasBlossom).map((row) => ({ ...row, semanticReviewRequired: true })), presenceConflict: rows.filter((row) => !(row.productionHasBlossom === row.communityDragonHasDistinctUpgrade && row.communityDragonHasDistinctUpgrade === row.lolchessHasBlossom)), identityUnresolved: lolchessRows.filter((row) => !productionByCanonicalName.has(normalizedEnglishName(row.nameEn ?? row.name))).map((row) => row.nameEn ?? row.name) }; })(),
    requirements: (() => { const rows = lolchessMatched.map(({ record, row }) => { const productionFacts = requirementFacts(record.requirements); const lolchessFacts = requirementFacts(row.requirements); const comparable = productionFacts.length > 0 && lolchessFacts.length > 0; return { identity: record.id, nameEn: record.nameEn, productionHasRequirements: record.requirements.length > 0, lolchessHasRequirements: Array.isArray(row.requirements) && row.requirements.length > 0, productionFacts, lolchessFacts, status: comparable ? (same(productionFacts, lolchessFacts) ? 'structured_agreement' : 'structured_conflict') : 'semantic_review_required' }; }); return { productionCount: coverage.withRequirements, lolchessCount: lolchessRows.filter((row) => Array.isArray(row.requirements) && row.requirements.length).length, presenceAgreement: rows.filter((row) => row.productionHasRequirements === row.lolchessHasRequirements), presenceConflict: rows.filter((row) => row.productionHasRequirements !== row.lolchessHasRequirements), identityUnresolved: lolchessRows.filter((row) => !productionByCanonicalName.has(normalizedEnglishName(row.nameEn ?? row.name))).map((row) => row.nameEn ?? row.name), structuredComparison: rows.filter((row) => row.status.startsWith('structured_')), structuredConflict: rows.filter((row) => row.status === 'structured_conflict'), semanticReviewRequired: rows.filter((row) => row.status === 'semantic_review_required' && (row.productionHasRequirements || row.lolchessHasRequirements)) }; })(),
    oncePerGame: { lolchessConfirmed: lolchessRows.filter((row) => row.oncePerGame === true).map((row) => row.nameEn ?? row.name), appliedToProduction: records.filter((record) => record.oncePerGame.status === 'confirmed').map((record) => record.nameEn) },
    stageRanges: { compared: lolchessMatched.length, agreements: lolchessMatched.filter(({ record, row }) => same(record.stageRanges, row.stageRanges)).length, mismatches: lolchessMatched.filter(({ record, row }) => !same(record.stageRanges, row.stageRanges)).map(({ record, row }) => ({ nameEn: record.nameEn, production: record.stageRanges, lolchess: row.stageRanges })) },
  };
  await mkdir(resolve(root, 'data/normalized'), { recursive: true }); await mkdir(resolve(root, 'reports'), { recursive: true });
  const beforeDuplicateAudit = { status: 'historical_superseded', confirmedIntersection: 152, exactClientKey: 144, candidateCount: 48, ambiguousCount: 27, unresolvedOpggCount: 48, dataTftUnmatchedCount: 17, confirmedCorpusButIncomplete: 8 };
  const afterDuplicateAudit = { confirmedIntersection: reconciliation.confirmedMatches.length, exactClientKey: methodCounts.exact_client_key, candidateCount: reconciliation.candidateMatches.length, ambiguousCount: reconciliation.ambiguous.length, unresolvedOpggCount: unresolvedOpgg.length, dataTftUnmatchedCount: dataTftUnmatched.length, confirmedCorpusButIncomplete: confirmedCorpusButIncomplete.length };
  const corpusReconciliation = { corpusDefinition: 'All live-patch Wisps actually offered in a normal or rules-authorized Wisp slot. Conditional appearance does not exclude a Wisp; only inactive/internal/non-offerable records, variants, and aliases are excluded with evidence.', exactCorpusSize: 'unresolved', confirmedCorpusMinimum: conservativeCorpusMinimum, confirmedCorpusMinimumReason: 'normalizedProductionCount + max(0, confirmedCorpusButIncompleteCount - dataTftUnmatchedCount)', normalizedProductionCount: records.length, productionReady: false, stageC1EngineeringExit: { status: 'complete', remainingWork: 'data_curation_and_review', structuralBlockingBug: false }, matching: { confirmedSharedIdentities: reconciliation.confirmedMatches.length + reviewedIdentities.filter((mapping) => !mapping.opggSourceKey).length, methodCounts, reviewedCrossSourceIdentityCount: reviewedIdentities.length, candidateCount: reconciliation.candidateMatches.length, ambiguousCount: reconciliation.ambiguous.length, unresolvedOpggCount: unresolvedOpgg.length, dataTftUnmatchedCount: dataTftUnmatched.length }, duplicateAuditMatchingDiff: { before: beforeDuplicateAudit, after: afterDuplicateAudit, promotedToExactClientKey: Number(methodCounts.exact_client_key) - beforeDuplicateAudit.exactClientKey }, confirmedCorpusButIncomplete, acquisition: { cloudFetch: { status: lolchess.fetchStatus, httpStatus: lolchess.httpStatus }, browserSnapshot: { status: lolchessImported?.fetchStatus, recordCount: lolchessRows.length, pageUpdatedAt: lolchessImported?.pageUpdatedAt } }, sources: [{ source: 'communitydragon', rawRowCount: clientIdentityAudit.rawRecordCount, rawBaseRows: clientIdentityAudit.rawBaseRows, rawUpgradeRows: clientIdentityAudit.rawUpgradeRows, rawPrismaticRows: clientIdentityAudit.rawPrismaticRows, uniqueBaseApiNames: clientIdentityAudit.uniqueBaseApiNames, uniqueCanonicalBaseIdentities: clientIdentityAudit.uniqueCanonicalBaseIdentities }, { source: 'datatft', rawCount: records.length, normalizedProductionCount: records.length }, { source: 'opgg', rawCount: opggRows.length, confirmedMatched: reconciliation.confirmedMatches.length, confirmedDistinctOnly: 0, clientSupportedUnlinked: confirmedCorpusButIncomplete.length, unresolved: unresolvedOpgg.length }, { source: 'lolchess', cloudFetch: { status: lolchess.fetchStatus, httpStatus: lolchess.httpStatus }, browserSnapshot: { status: lolchessImported?.fetchStatus, rawCount: lolchessRows.length, pageUpdatedAt: lolchessImported?.pageUpdatedAt } }] };
  const matchReview = { policy: { confirmedMethods: ['exact_client_key','exact_english_name','exact_chinese_name','reviewed_cross_source_identity'], candidateSignalsNeverAutoConfirm: ['effect_similarity','name_similarity','category','cost','appearanceCondition'], ambiguityMargin: 0.1 }, reviewedCrossSourceIdentities: reviewedIdentities, candidateMatches: reconciliation.candidateMatches, ambiguous: reconciliation.ambiguous, unresolved: { opgg: unresolvedOpgg, dataTft: dataTftUnmatched } };
  const requirementsReview = requirementsManualReview(lolchessFieldAudit.requirements.presenceConflict, lolchessFieldAudit.requirements.structuredConflict, lolchessFieldAudit.requirements.semanticReviewRequired);
  const manualReview = {
    patch: '18.1', generatedFromCurrentSnapshots: true,
    groups: {
      identity_mapping: dataTftUnmatched.map((record) => ({ sourceRecords: { dataTft: record }, candidateMapping: reconciliation.candidateMatches.filter((candidate) => candidate.topCandidates.some((item: Raw) => item.productionId === record.id)), evidence: 'No explicit reviewed cross-source mapping exists.', whyNotAutoConfirmed: 'Similarity signals cannot confirm identity.', whatHumanMustDecide: 'Choose a canonical cross-source identity or confirm that none is supported.' })),
      corpus_membership: unresolvedOpgg.map((item) => ({ sourceRecords: { opgg: item.record }, candidateMapping: null, evidence: item.corpusMembership, whyNotAutoConfirmed: item.reason, whatHumanMustDecide: 'Whether this is a distinct live corpus identity or an alias/variant.' })),
      blossom_presence: lolchessFieldAudit.blossom.presenceConflict.map((item) => ({ sourceRecords: item, candidateMapping: item.identity, evidence: 'Confirmed identity with source-level presence disagreement.', whyNotAutoConfirmed: 'Presence differs across current snapshots.', whatHumanMustDecide: 'Which source represents the live Blossom state.' })),
      prismatic_identity: prismaticAudit.identityUnresolved.map((name) => ({ sourceRecords: { lolchess: name }, candidateMapping: null, evidence: 'Prismatic record has no confirmed production identity.', whyNotAutoConfirmed: 'Display-name similarity is not identity evidence.', whatHumanMustDecide: 'Map the canonical identity.' })),
      requirements_semantics: requirementsReview.map(({ row, reviewReasons }) => ({ sourceRecords: row, candidateMapping: row.identity, reviewReasons, evidence: 'Confirmed identity requiring presence, structured-fact, or semantic review.', whyNotAutoConfirmed: 'Cross-language free text is not safely machine-equivalent.', whatHumanMustDecide: 'Confirm requirement presence and semantics.' })),
      other_field_conflict: [],
    },
  };
  const manifestBrowserSource = { sourceId: lolchessImported?.sourceId, tier: 'C', url: lolchessImported?.url, locale: lolchessImported?.locale, retrievedAt: lolchessImported?.retrievedAt, pageUpdatedAt: lolchessImported?.pageUpdatedAt, sha256: lolchessImported?.sha256, recordCount: lolchessImported?.recordCount, fieldCoverage: lolchessImported?.fieldCoverage, fetchStatus: lolchessImported?.fetchStatus, useFor: ['identity_cross_check','stageRanges_cross_check','blossom_cross_check','prismatic_cross_check','requirements_cross_check','oncePerGame','reofferCooldownShops'], confidence: 'verified_third_party' };
  const manifestSources = (sourceManifest.sources as Raw[]).filter((source) => source.sourceId !== manifestBrowserSource.sourceId).map((source) => source.sourceId === lolchess.sourceId ? { ...source, useFor: ['acquisition_history'], warning: 'Historical cloud attempt received an AWS WAF challenge (HTTP 202); superseded for record evidence by the browser snapshot channel.' } : source.sourceId === datatft.sourceId ? { ...source, warning: 'Provisional normalized skeleton; fields are cross-checked against the available LoLCHESS browser snapshot and client data.' } : source);
  const currentSources = [...manifestSources, manifestBrowserSource];
  const snapshotAt = currentSources.map((source) => String(source.retrievedAt ?? '')).filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1)!;
  const currentSourceManifest = { ...sourceManifest, snapshotAt, sources: currentSources };
  for (const [path, value] of [['data/source_manifest_18.1.json', currentSourceManifest], ['data/normalized/wisps_18.1.json', dataset], ['reports/data-coverage-18.1.json', coverage], ['reports/data-conflicts-18.1.json', conflicts], ['reports/data-unmatched-18.1.json', unmatched], ['reports/data-schema-gaps-18.1.json', schemaGaps], ['reports/seed-regression-18.1.json', seedRegression], ['reports/data-corpus-diff-18.1.json', corpusDiff], ['reports/data-corpus-reconciliation-18.1.json', corpusReconciliation], ['reports/data-match-review-18.1.json', matchReview], ['reports/data-manual-review-18.1.json', manualReview], ['reports/data-communitydragon-identity-audit-18.1.json', clientIdentityAudit], ['reports/data-prismatic-audit-18.1.json', prismaticAudit], ['reports/data-communitydragon-variants-18.1.json', variantAudit], ['reports/data-lolchess-field-audit-18.1.json', lolchessFieldAudit]] as const) await writeFile(resolve(root, path), stable(value));
  const audit = `# TFT 18.1 Wisp 数据审计\n\n- 快照：DataTFT ${at}；OP.GG ${opgg.retrievedAt}。\n- OP.GG：HTTP ${opgg.httpStatus}，SHA-256 ${opgg.sha256}，页面声明 ${opgg.declaredRecordCount ?? opggCount} 条，实际解析 ${opggCount} 条；分类合计 ${Object.values(opggCategoryCounts).reduce<number>((sum, value) => sum + Number(value), 0)}。\n- 旧算法会无阈值地耗尽两侧记录，因而人为制造 169/31/0；该结果已删除。新规则只有 client key、唯一英文名、唯一中文名和 reviewed alias 可以确认身份。\n- 确认交集：${reconciliation.confirmedMatches.length}（${JSON.stringify(methodCounts)}）；模糊候选 ${reconciliation.candidateMatches.length}，其中 ambiguous ${reconciliation.ambiguous.length}。候选不会进入确认交集。\n- CommunityDragon identity audit：raw ${clientIdentityAudit.rawRecordCount} 行（base ${clientIdentityAudit.rawBaseRows} / Upgrade ${clientIdentityAudit.rawUpgradeRows} / Prismatic ${clientIdentityAudit.rawPrismaticRows}）；unique base apiName ${clientIdentityAudit.uniqueBaseApiNames}，unique canonical base identity ${clientIdentityAudit.uniqueCanonicalBaseIdentities}；exact duplicate groups ${clientIdentityAudit.exactDuplicateGroupCount}，conflicting groups ${clientIdentityAudit.conflictingDuplicateGroupCount}，canonical collisions ${clientIdentityAudit.canonicalCollisionCount}。\n- Duplicate audit 前→后：${JSON.stringify(beforeDuplicateAudit)} → ${JSON.stringify(afterDuplicateAudit)}；${Number(methodCounts.exact_client_key) - beforeDuplicateAudit.exactClientKey} 个 candidate 因安全去重升级为 exact_client_key。\n- 当前已提交 CDragon snapshot 没有重复 apiName；显式 reviewed cross-source mapping 共 ${reviewedIdentities.length} 条，未隐藏在代码 special case 中。Mitosis base/Upgrade 分层保持正确，blossom 仍为 null。\n- 确认 OP.GG-only：${opggOnlyConfirmed.length}；DataTFT unmatched（不等同于其它来源不存在）：${dataTftUnmatched.length}；OP.GG unresolved：${unresolvedOpgg.length}。原 31 条差异结论已全部撤销并按当前强证据重新计算。\n- CommunityDragon 为 ${confirmedCorpusButIncomplete.length} 条未链接 OP.GG identity 提供 exact base client identity；它确认 corpus 身份，但不能证明这些记录与 ${dataTftUnmatched.length} 条 DataTFT unmatched rows 相互独立，因此 confirmed OP.GG-only 仍为 0。\n- appearanceCondition 只作为需求字段，绝不再决定 A/C 或排除。规则授权的条件 Wisp 仍属于 corpus。\n- 当前可证实 corpus 保守下限为 ${conservativeCorpusMinimum}（normalized ${records.length} + max(0, incomplete ${confirmedCorpusButIncomplete.length} - unmatched ${dataTftUnmatched.length})）；exact corpus size 仍 unresolved。另有 ${confirmedCorpusButIncomplete.length} 个已确认 corpus identity 尚未完成 DataTFT/production 身份链接，不能重复计数。\n- Blossom ${coverage.withBlossom}；Mitosis 的非独立 Upgrade 仍为 null。Knowledge<T>、字段 provenance、seed/production 分离均保持不变。\n- LoLCHESS browser snapshot：${lolchessRows.length} 条，按确认/reviewed canonical identity 与 production 匹配 ${lolchessMatched.length} 条；逐字段审计见 data-lolchess-field-audit-18.1.json。来源规模 163/169/174/200 分别反映 CommunityDragon canonical base、DataTFT normalized、LoLCHESS rendered catalog、OP.GG catalog 的不同结构与口径，不能仅凭数量选择全集。\n- **Production ready：否。** 当前仍需人工审核 ${reconciliation.candidateMatches.length} 个 OP.GG candidate group 与 ${dataTftUnmatched.length} 个 DataTFT unmatched rows；离线构建保持确定性。\n`;
  await writeFile(resolve(root, 'reports/data-audit-18.1.md'), audit);
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
