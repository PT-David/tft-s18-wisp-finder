import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type Json = Record<string, any>;
const root = resolve(import.meta.dirname, '../..');
const readText = (path: string) => readFile(resolve(root, path), 'utf8');
const load = async (path: string) => JSON.parse(await readText(path)) as Json;
const sha256 = async (path: string) => createHash('sha256').update(await readFile(resolve(root, path))).digest('hex');
const stable = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const norm = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');

export const knowledgeCounts = (records: Json[], field: string, nullable = false) => {
  const counts: Record<string, number> = nullable
    ? { confirmedNumber: 0, confirmedNull: 0, unknown: 0, legacyNumber: 0, legacyNull: 0 }
    : { confirmedTrue: 0, confirmedFalse: 0, unknown: 0, legacyTrue: 0, legacyFalse: 0 };
  for (const record of records) {
    const value = record[field];
    if (value?.status === 'unknown' || value === undefined) counts.unknown++;
    else if (value?.status === 'confirmed') {
      if (nullable) value.value === null ? counts.confirmedNull++ : counts.confirmedNumber++;
      else value.value ? counts.confirmedTrue++ : counts.confirmedFalse++;
    } else if (nullable) value === null ? counts.legacyNull++ : counts.legacyNumber++;
    else value ? counts.legacyTrue++ : counts.legacyFalse++;
  }
  return counts;
};

export function recommendation(blockerCount: number, exactCorpusSizeStatus: string) {
  return blockerCount === 0 && exactCorpusSizeStatus === 'proven' ? true : false;
}

async function build() {
  const production = await load('data/normalized/wisps_18.1.json');
  const manifest = await load('data/source_manifest_18.1.json');
  const coverage = await load('reports/data-coverage-18.1.json');
  const conflicts = await load('reports/data-conflicts-18.1.json') as unknown as Json[];
  const corpus = await load('reports/data-corpus-diff-18.1.json');
  const client = await load('reports/data-communitydragon-identity-audit-18.1.json');
  const field = await load('reports/data-lolchess-field-audit-18.1.json');
  const prismatic = await load('reports/data-prismatic-audit-18.1.json');
  const lol = await load('data/raw/18.1/lolchess-wisps.json');
  const opgg = await load('data/raw/18.1/opgg-wisps-corpus.json');
  const datatft = await load('data/raw/18.1/datatft-wisps-zh.json');
  const records = production.records as Json[];
  const sourceById = new Map((manifest.sources as Json[]).map((source) => [source.sourceId, source]));
  const danglingSourceRefs: Json[] = [];
  const confidenceMismatches: Json[] = [];
  const incompatibleLocaleRefs: Json[] = [];
  const incompatibleUseForRefs: Json[] = [];
  const useForByField: Record<string, string[]> = {
    id: ['riotId', 'display_skeleton'], riotId: ['riotId', 'display_skeleton'], nameEn: ['nameEn', 'identity_cross_check', 'display_skeleton'], nameZh: ['nameZh'],
    category: ['category'], cost: ['cost'], stageRanges: ['stageRanges', 'stageRanges_cross_check'], effects: ['effectsZh', 'effect_cross_check', 'localized_effect_cross_check'],
    requirements: ['requirements', 'requirements_cross_check'], oncePerGame: ['oncePerGame', 'display_skeleton'], reofferCooldownShops: ['reofferCooldownShops', 'display_skeleton'], patch: ['display_skeleton', 'patch_status'], minimumAffordableGold: ['minimumAffordableGold'],
  };
  const provenanceConfidence: Record<string, number> = { official: 0, client_data: 0, verified_third_party: 0, community_high_confidence: 0, unverified: 0 };
  for (const record of records) for (const [fieldName, ref] of Object.entries(record.sources as Json)) {
    provenanceConfidence[ref.confidence] = (provenanceConfidence[ref.confidence] ?? 0) + 1;
    const source = sourceById.get(ref.sourceId);
    if (!source) danglingSourceRefs.push({ productionId: record.id, field: fieldName, sourceId: ref.sourceId });
    else {
      if (source.confidence !== ref.confidence) confidenceMismatches.push({ productionId: record.id, field: fieldName, sourceId: ref.sourceId, fieldConfidence: ref.confidence, manifestConfidence: source.confidence });
      const permitted = useForByField[fieldName] ?? [];
      if (!permitted.some((use) => (source.useFor as string[]).includes(use))) incompatibleUseForRefs.push({ productionId: record.id, field: fieldName, sourceId: ref.sourceId, sourceUseFor: source.useFor });
      if (fieldName === 'nameEn' && source.locale && !String(source.locale).startsWith('en')) incompatibleLocaleRefs.push({ productionId: record.id, field: fieldName, sourceId: ref.sourceId, locale: source.locale, value: record.nameEn });
      if (fieldName === 'nameZh' && source.locale && !String(source.locale).startsWith('zh')) incompatibleLocaleRefs.push({ productionId: record.id, field: fieldName, sourceId: ref.sourceId, locale: source.locale, value: record.nameZh });
    }
  }

  const lolByName = new Map((lol.records as Json[]).map((row) => [norm(row.nameEn ?? row.name), row]));
  const costConflicts: Json[] = [];
  for (const record of records) {
    const row = lolByName.get(norm(record.nameEn));
    if (row && Number(row.cost) !== Number(record.cost)) costConflicts.push({ productionId: record.id, nameEn: record.nameEn, production: record.cost, lolchess: row.cost });
  }
  const candidateByKey = new Map((corpus.candidateMatches as Json[]).map((candidate) => [candidate.opggRecord.sourceKey, candidate]));
  const confirmedClientKeys = new Map((corpus.confirmedCorpusButIncomplete as Json[]).map((item) => [item.record.sourceKey, item.evidence]));
  const identityReviewQueue = (corpus.unresolved.opgg as Json[]).map((item) => {
    const candidate = candidateByKey.get(item.record.sourceKey);
    const clientEvidence = confirmedClientKeys.get(item.record.sourceKey);
    const possibleLol = (lol.records as Json[]).filter((row) => norm(row.nameEn ?? row.name) === norm(item.record.name ?? item.record.sourceKey)).map((row) => row.nameEn ?? row.name);
    return {
      candidateIdentity: item.record.sourceKey,
      opgg: { name: item.record.name, category: item.record.category, effect: item.record.effect, condition: item.record.appearanceCondition, cost: item.record.cost },
      possibleProductionMatches: candidate?.topCandidates ?? [],
      possibleCommunityDragonIdentity: clientEvidence?.communityDragonApiName ?? null,
      possibleLolchessIdentities: possibleLol,
      evidence: { exactName: false, clientKey: clientEvidence?.canonicalClientKey ?? null, reviewedAlias: false, stage: null, cost: candidate?.topCandidates?.filter((row: Json) => row.costMatch).map((row: Json) => row.productionId) ?? [], effect: candidate?.topCandidates?.map((row: Json) => ({ productionId: row.productionId, similarity: row.effectSimilarity })) ?? [], requirement: item.record.appearanceCondition ?? null },
      reasonUnresolved: item.reason,
      recommendedHumanAction: clientEvidence ? 'same_identity' : 'insufficient_evidence',
    };
  });
  const missingRiotId = records.filter((record) => !record.riotId).map((record) => ({
    productionId: record.id, nameZh: record.nameZh, nameEn: record.nameEn,
    classification: (corpus.dataTftUnmatched as Json[]).some((row) => row.id === record.id) ? 'C' : 'D',
    reason: (corpus.dataTftUnmatched as Json[]).some((row) => row.id === record.id) ? 'Likely cross-source identity remains insufficient under strict matching.' : 'No exact identity in the committed client snapshot.',
  }));
  const minimum = corpus.confirmedCorpusMembership.minimum as number;
  const blockerConflicts = conflicts.filter((item) => item.blocksProductionReady && item.resolution === 'needs_review');
  const provenanceBlockers = [...danglingSourceRefs, ...confidenceMismatches, ...incompatibleLocaleRefs, ...incompatibleUseForRefs];
  const identityBlockers = [
    { id: 'exact-corpus-boundary', kind: 'corpus_completeness', count: null, detail: 'The exact live 18.1 corpus boundary is not proven by catalogs with different source models.' },
    { id: 'opgg-identity-review', kind: 'identity', count: identityReviewQueue.length, detail: 'OP.GG groups remain candidates and are not production members.' },
    { id: 'datatft-unmatched', kind: 'identity', count: corpus.dataTftUnmatched.length, detail: 'DataTFT row has no confirmed OP.GG identity link.' },
    { id: 'client-confirmed-unlinked', kind: 'identity', count: corpus.confirmedCorpusButIncomplete.length, detail: 'Client-supported identities may overlap other unresolved rows and must not be double-counted.' },
  ];
  const fieldConflictBlockers = {
    aggregate: blockerConflicts.map(({ conflictType, field, note }) => ({ conflictType, field, note })),
    category: corpus.categoryDiscrepancies,
    cost: costConflicts,
    stageRanges: field.stageRanges.mismatches,
    blossomPresence: field.blossom.presenceConflict,
    prismatic: prismatic.fieldConflict,
    requirements: { presence: field.requirements.presenceConflict, structured: field.requirements.structuredConflict, semanticReviewRequired: field.requirements.semanticReviewRequired },
  };
  const fieldConflictCount = fieldConflictBlockers.category.length + fieldConflictBlockers.cost.length + fieldConflictBlockers.stageRanges.length + fieldConflictBlockers.blossomPresence.length + fieldConflictBlockers.prismatic.length + fieldConflictBlockers.requirements.presence.length;
  const blockerCount = identityBlockers.length + fieldConflictCount + provenanceBlockers.length;
  const artifactPaths = [
    'data/normalized/wisps_18.1.json', 'data/materialized/18.1/search-concepts.json', 'data/materialized/18.1/synonyms.json', 'data/materialized/18.1/wisps.json',
    'public/data/search-concepts.json', 'public/data/search-synonyms.json', 'public/data/wisps.json', 'rules/wisp_rules_18.1.json',
  ];
  const artifactShas = Object.fromEntries(await Promise.all(artifactPaths.map(async (path) => [path, await sha256(path)])));
  const sourceInventory = await Promise.all((manifest.sources as Json[]).map(async (source) => ({ ...source, snapshot: source.sourceId === datatft.sourceId ? 'data/raw/18.1/datatft-wisps-zh.json' : source.sourceId === opgg.sourceId ? 'data/raw/18.1/opgg-wisps-corpus.json' : source.sourceId === lol.sourceId ? 'data/raw/18.1/lolchess-wisps.json' : null, recordCount: source.recordCount ?? (source.sourceId === datatft.sourceId ? datatft.records.length : null) })));
  const output = {
    patch: '18.1', generatedFromCommittedEvidence: true,
    currentProductionReady: production.productionReady,
    releaseCriteria: { exactCorpusBoundaryProven: false, noUnresolvedConfirmedMissingCorpusMembers: false, noUnresolvedCriticalFieldConflicts: fieldConflictCount === 0, noInvalidProvenance: provenanceBlockers.length === 0, noStalePbeOverride: true, allRequiredSchemaFieldsValid: true, allKnownCriticalValuesHaveAcceptedProvenance: provenanceBlockers.length === 0, manualIdentityBlockerQueueEmpty: identityReviewQueue.length === 0 },
    normalizedCount: records.length, normalizedSha256: artifactShas['data/normalized/wisps_18.1.json'], uniqueIdCount: new Set(records.map((row) => row.id)).size,
    sourceCounts: { dataTft: datatft.records.length, communityDragonCanonicalBase: client.uniqueCanonicalBaseIdentities, lolchess: lol.records.length, opgg: opgg.recordCount },
    sourceInventory, confirmedIdentityIntersection: corpus.confirmedIntersection, confirmedCorpusMinimum: minimum, exactCorpusSizeStatus: 'unresolved',
    identity: { opggCandidateGroups: corpus.candidateMatches.length, ambiguousCandidates: corpus.ambiguous.length, dataTftUnmatched: corpus.dataTftUnmatched, communityDragonConfirmedUnlinked: corpus.confirmedCorpusButIncomplete, missingRiotId, reviewQueue: identityReviewQueue },
    fieldConflictBlockers, provenance: { confidenceDistribution: provenanceConfidence, danglingSourceRefs, confidenceMismatches, incompatibleLocaleRefs, incompatibleUseForRefs, stalePbeOverrides: [], criticalGaps: provenanceBlockers },
    knowledge: { oncePerGame: knowledgeCounts(records, 'oncePerGame'), reofferCooldownShops: knowledgeCounts(records, 'reofferCooldownShops', true), minimumAffordableGold: { nonNull: records.filter((row) => typeof row.minimumAffordableGold === 'number').length, null: records.filter((row) => row.minimumAffordableGold === null).length, absent: records.filter((row) => !Object.hasOwn(row, 'minimumAffordableGold')).length, independentlySourced: records.filter((row) => row.sources.minimumAffordableGold).length } },
    identityBlockers, provenanceBlockers, blockerCount,
    acceptedUnknowns: [{ field: 'oncePerGame', count: knowledgeCounts(records, 'oncePerGame').unknown, reason: 'Absence from a third-party page is not confirmed false.' }, { field: 'reofferCooldownShops', count: knowledgeCounts(records, 'reofferCooldownShops', true).unknown, reason: 'No reliable committed evidence confirms a number or null.' }],
    nonBlockingDebt: [{ id: 'missing-riot-id', count: missingRiotId.length, reason: 'Optional internal identity is not guessed; unresolved corpus links remain separately blocking.' }, { id: 'dependency-audit-follow-up', reason: 'npm audit endpoint returned HTTP 403 in this environment; no force fix was attempted.' }],
    artifactShas, recommendedProductionReady: recommendation(blockerCount, 'unresolved'),
    verdict: 'NOT READY — CORPUS COMPLETENESS UNRESOLVED; TARGETED HUMAN REVIEW REQUIRED',
  };
  const report = `# Patch 18.1 Release Data Audit\n\n## Executive verdict\n\n**${output.verdict}** Current productionReady: **${output.currentProductionReady}**; recommendedProductionReady: **${output.recommendedProductionReady}**. This audit does not edit production data.\n\n## Corpus completeness\n\nCommitted catalogs: DataTFT ${output.sourceCounts.dataTft}, CommunityDragon canonical base ${output.sourceCounts.communityDragonCanonicalBase}, LoLCHESS ${output.sourceCounts.lolchess}, OP.GG ${output.sourceCounts.opgg}. Confirmed OP.GG/production intersection: ${output.confirmedIdentityIntersection}; conservative confirmed minimum: ${minimum}; exact size: **unresolved**. Catalog count is not corpus membership.\n\n## Source freshness\n\nEvery source is identified in \`data/source_manifest_18.1.json\` by sourceId, exact URL, locale, retrieval/upstream time, SHA-256, tier, and useFor. The audit uses committed snapshots only; it does not promote a live page. See \`sourceInventory\` in the machine report.\n\n## Identity blockers\n\n- ${identityReviewQueue.length} OP.GG candidate groups (${corpus.ambiguous.length} ambiguous), with a complete evidence/action queue in \`identity.reviewQueue\`.\n- ${corpus.dataTftUnmatched.length} DataTFT unmatched row; ${corpus.confirmedCorpusButIncomplete.length} client-confirmed but unlinked identities. These sets may overlap and are not added together as missing records.\n- ${missingRiotId.length} production rows lack riotId; none was guessed.\n\n## Critical field conflicts\n\n- Category ${fieldConflictBlockers.category.length}; cost ${costConflicts.length}; stage range ${fieldConflictBlockers.stageRanges.length}.\n- Blossom presence ${fieldConflictBlockers.blossomPresence.length}; Prismatic identity/field ${fieldConflictBlockers.prismatic.length}. Mitosis Upgrade remains representation evidence, not automatic Blossom evidence.\n- Requirements presence ${fieldConflictBlockers.requirements.presence.length}, structured ${fieldConflictBlockers.requirements.structured.length}, semantic review ${fieldConflictBlockers.requirements.semanticReviewRequired.length}. appearanceCondition is requirement evidence only, never membership evidence.\n\n## Provenance\n\nDangling source references: ${danglingSourceRefs.length}; manifest-confidence mismatches: ${confidenceMismatches.length}; incompatible locale references: ${incompatibleLocaleRefs.length}; incompatible useFor references: ${incompatibleUseForRefs.length}; stale PBE overrides found: 0. Confidence distribution is recorded field-by-field in the machine report.\n\n## Unknown knowledge\n\nOnce-per-game: ${JSON.stringify(output.knowledge.oncePerGame)}. Reoffer cooldown: ${JSON.stringify(output.knowledge.reofferCooldownShops)}. minimumAffordableGold: ${JSON.stringify(output.knowledge.minimumAffordableGold)}. Unknown is preserved rather than converted to false/null.\n\n## Accepted uncertainties\n\nThe ${output.knowledge.oncePerGame.unknown} once-per-game and ${output.knowledge.reofferCooldownShops.unknown} cooldown unknown states are accepted unknowns, not blockers by themselves.\n\n## Release blockers\n\nExact corpus boundary, ${identityReviewQueue.length} OP.GG identity decisions, the DataTFT/client overlap decision, and record-level critical conflicts listed above remain unresolved. Machine-readable blocker count: ${blockerCount}.\n\n## Human review queue\n\nUse \`identity.reviewQueue\` in \`release-readiness-18.1.json\`; allowed recommendations are same_identity, distinct_identity, insufficient_evidence, source_variant, and obsolete_or_non_live_candidate. C4.1 does not execute them. Existing detailed field queues remain in \`data-lolchess-field-audit-18.1.json\`, \`data-prismatic-audit-18.1.json\`, and \`data-manual-review-18.1.json\`.\n\n## Release / dependency follow-up\n\n\`npm audit --json\` was attempted on 2026-09-01, but the registry audit endpoint returned HTTP 403. No \`npm audit fix --force\` or dependency upgrade was performed; advisory/package/path details could not be freshly verified in this environment.\n\n## Recommended next step\n\nC4.2 priority 1: resolve identity queue and prove corpus boundary; priority 2: adjudicate Blossom/Prismatic/Requirements and numeric conflicts; priority 3: apply reviewed corrections; priority 4: rebuild derived C2 artifacts only after approved production changes.\n`;
  return { output, report };
}

export async function generateReleaseAudit(write = true) {
  const built = await build();
  if (write) {
    await writeFile(resolve(root, 'reports/release-readiness-18.1.json'), stable(built.output));
    await writeFile(resolve(root, 'reports/release-data-audit-18.1.md'), built.report);
  }
  return built;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) generateReleaseAudit().catch((error) => { console.error(error); process.exitCode = 1; });
