import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { clusterIdentityReviewItems, type ReviewItem } from './lib/identity-review';

type Json = Record<string, any>;
const root = resolve(import.meta.dirname, '../..');
const loadText = (path: string) => readFile(resolve(root, path), 'utf8');
const load = async (path: string) => JSON.parse(await loadText(path)) as Json;
const stable = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const norm = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9\p{L}\p{N}]/gu, '');

export async function buildIdentityReviewPacket() {
  const readinessText = await loadText('reports/release-readiness-18.1.json');
  const readiness = JSON.parse(readinessText) as Json;
  const lolchess = await load('data/raw/18.1/lolchess-wisps.json');
  const production = await load('data/normalized/wisps_18.1.json');
  const opggItems: ReviewItem[] = readiness.identity.reviewQueue.map((row: Json) => ({
    itemId: `opgg:${row.candidateIdentity}`, source: 'opgg', sourceKey: row.candidateIdentity, name: row.opgg.name,
    category: row.opgg.category, cost: row.opgg.cost, effect: row.opgg.effect,
    canonicalClientKey: row.evidence.clientKey, apiName: row.possibleCommunityDragonIdentity,
    corpusMembershipConfirmed: Boolean(row.possibleCommunityDragonIdentity),
    productionCandidates: row.possibleProductionMatches.map((candidate: Json) => ({ productionId: candidate.productionId, name: candidate.nameZh ?? candidate.nameEn, score: candidate.score, evidence: [`effectSimilarity=${candidate.effectSimilarity}`, `nameSimilarity=${candidate.nameSimilarity}`, `categoryMatch=${candidate.categoryMatch}`, `costMatch=${candidate.costMatch}`] })),
  }));
  const dataTftItems: ReviewItem[] = readiness.identity.dataTftUnmatched.map((row: Json) => {
    const productionRow = (production.records as Json[]).find((record) => record.id === row.id);
    const ranked = opggItems.map((item) => ({ item, candidate: item.productionCandidates?.find((candidate) => candidate.productionId === row.id) }))
      .filter((entry) => entry.candidate).sort((a, b) => (b.candidate!.score ?? 0) - (a.candidate!.score ?? 0));
    const best = ranked[0];
    // This overlap key creates a review neighborhood only. The score never confirms an identity.
    const overlapKeys = best && (best.candidate!.score ?? 0) >= 0.8 ? [`candidate-production:${row.id}`] : [];
    if (overlapKeys.length) best.item.overlapKeys = [...(best.item.overlapKeys ?? []), ...overlapKeys];
    return {
      itemId: `datatft:${row.id}`, source: 'datatft', sourceKey: row.id, name: row.nameZh ?? row.nameEn,
      category: productionRow?.category, cost: productionRow?.cost, effect: productionRow?.effects?.base,
      corpusMembershipConfirmed: false, productionCandidates: [], overlapKeys,
    };
  });
  const clientItems: ReviewItem[] = readiness.identity.communityDragonConfirmedUnlinked.map((row: Json) => ({
    itemId: `communitydragon:${row.evidence.communityDragonApiName}`, source: 'communitydragon', sourceKey: row.record.sourceKey,
    name: row.record.name, category: row.record.category, cost: row.record.cost, effect: row.record.effect,
    canonicalClientKey: row.evidence.canonicalClientKey, apiName: row.evidence.communityDragonApiName, corpusMembershipConfirmed: true,
  }));
  const clusters = clusterIdentityReviewItems([...opggItems, ...dataTftItems, ...clientItems]);
  for (const cluster of clusters) {
    const names = new Set(cluster.sourceItems.flatMap((item) => [norm(item.sourceKey), norm(item.name)]));
    const matches = (lolchess.records as Json[]).filter((row) => names.has(norm(row.nameEn ?? row.name)) || names.has(norm(row.nameZh)));
    for (const row of matches) cluster.supportingEvidence.push(`LoLCHESS exact displayed-name support: ${row.nameEn ?? row.name} (cost ${row.cost ?? 'unknown'}); this is not an identity confirmation.`);
  }
  const priorities = Object.fromEntries(['P0', 'P1', 'P2', 'P3'].map((priority) => [priority, clusters.filter((cluster) => cluster.priority === priority).length]));
  const actions = Object.fromEntries(['same_identity', 'distinct_identity', 'source_variant', 'obsolete_or_non_live_candidate', 'insufficient_evidence'].map((action) => [action, clusters.filter((cluster) => cluster.recommendedHumanAction === action).length]));
  const raw = { opggCandidateGroups: opggItems.length, dataTftUnmatched: dataTftItems.length, communityDragonConfirmedUnlinked: clientItems.length };
  const summary = {
    rawReviewItemsBeforeClustering: Object.values(raw).reduce((sum, count) => sum + count, 0), rawQueues: raw,
    uniqueClustersAfterClustering: clusters.length, overlapReduction: Object.values(raw).reduce((sum, count) => sum + count, 0) - clusters.length,
    priorities, recommendations: actions,
    clustersWithStrongSingleRecommendation: clusters.filter((cluster) => cluster.confidence === 'strong').length,
    clustersRequiringGenuineHumanJudgement: clusters.filter((cluster) => cluster.requiresGenuineHumanJudgement).length,
    clustersStillInsufficientEvenForHumanDecision: clusters.filter((cluster) => cluster.insufficientEvenForHumanDecision).length,
  };
  const packet = {
    schemaVersion: 1, patch: '18.1', purpose: 'identity_review_preparation_only', readinessSource: 'reports/release-readiness-18.1.json',
    readinessSourceSha256: sha(readinessText), recommendedProductionReady: readiness.recommendedProductionReady,
    generatedFromCommittedSnapshotsOnly: true,
    semantics: { clusteringIsNotConfirmation: true, corpusMembershipAndProductionIdentityLinkAreSeparate: true, fuzzyEvidenceMayOnlyGenerateOrRankCandidates: true, recommendationsAreNotDecisions: true },
    deterministicMethod: 'Stable source item IDs; exact source/client/API overlap keys; plus a bounded highest-score DataTFT review-neighborhood edge (score >= 0.8) that is explicitly supporting-only; priority then lexical ordering; sequential cluster IDs.',
    summary, clusters,
  };
  return { json: stable(packet), markdown: renderMarkdown(packet) };
}

function renderMarkdown(packet: Json) {
  const summary = packet.summary;
  const sections = packet.clusters.map((cluster: Json) => {
    const rows = cluster.sourceItems.map((item: Json) => `| ${item.source} | ${item.name} (\`${item.sourceKey}\`) | ${item.category ?? '—'} | ${item.cost ?? '—'} | ${item.canonicalClientKey ?? item.apiName ?? '—'} | ${item.corpusMembershipConfirmed ? 'corpus confirmed' : 'candidate only'} |`).join('\n');
    const candidates = cluster.productionCandidates.slice(0, 3).map((candidate: Json) => `- \`${candidate.productionId}\` ${candidate.name ?? ''} — score ${candidate.score ?? 'n/a'}（仅排序证据）`).join('\n') || '- 无。';
    const same = [...cluster.exactEvidence, ...cluster.supportingEvidence].slice(0, 5).map((item: string) => `- ${item}`).join('\n') || '- 无 identity-confirming evidence。';
    const against = cluster.conflictingEvidence.map((item: string) => `- ${item}`).join('\n') || '- 尚无确定性排除证据；缺少证据本身不证明 distinct。';
    return `## ${cluster.clusterId} — Priority ${cluster.priority}\n\n**Current question:** ${cluster.currentQuestion}\n\n| source | identity/name | category | cost | key | key evidence |\n|---|---|---:|---:|---|---|\n${rows}\n\n### Production candidates\n\n${candidates}\n\n### Evidence for same\n\n${same}\n\n### Evidence against same\n\n${against}\n\n### Recommendation\n\n\`${cluster.recommendedHumanAction}\`${cluster.recommendedProductionId ? ` → \`${cluster.recommendedProductionId}\`` : ''}. Corpus membership: **${cluster.corpusMembership.status}**; production identity link: **${cluster.productionIdentityLink.status}**.\n\n### Why human decision is still needed\n\n${cluster.reasonHumanReviewRequired}\n\n### Allowed choices\n\n${cluster.allowedChoices.map((choice: string) => `\`${choice}\``).join(' · ')}\n`;
  }).join('\n---\n\n');
  return `# C4.2A Corpus Identity Review Packet — Patch 18.1\n\n> Review preparation only. Clustering means “review together,” not “same identity.” No decision or production correction is applied. C4.1 remains the readiness source.\n\n## Review burden\n\n- Raw items: **${summary.rawReviewItemsBeforeClustering}** (${summary.rawQueues.opggCandidateGroups} OP.GG + ${summary.rawQueues.dataTftUnmatched} DataTFT + ${summary.rawQueues.communityDragonConfirmedUnlinked} client-confirmed/unlinked).\n- Unique clusters: **${summary.uniqueClustersAfterClustering}**; duplicate-review reduction: **${summary.overlapReduction}**.\n- Priority: P0 ${summary.priorities.P0}, P1 ${summary.priorities.P1}, P2 ${summary.priorities.P2}, P3 ${summary.priorities.P3}.\n- Strong single recommendation: ${summary.clustersWithStrongSingleRecommendation}; genuine human judgement: ${summary.clustersRequiringGenuineHumanJudgement}; insufficient even for a decision now: ${summary.clustersStillInsufficientEvenForHumanDecision}.\n\n## Semantic boundary\n\n**Corpus membership confirmed** means committed sources support a live base identity. **Production identity link confirmed** additionally requires a concrete production ID and governance-compliant exact evidence. Similar category/cost/effect or fuzzy names only rank candidates.\n\n${sections}`;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const output = await buildIdentityReviewPacket();
  await writeFile(resolve(root, 'reports/c4.2a-identity-review-packet-18.1.json'), output.json);
  await writeFile(resolve(root, 'reports/c4.2a-identity-review-packet-18.1.md'), output.markdown);
  console.log('Generated deterministic C4.2A identity review packet.');
}
