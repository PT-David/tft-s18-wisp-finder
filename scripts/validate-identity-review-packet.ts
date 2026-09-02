import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildIdentityReviewPacket } from './data/identity-review-packet-18.1';

const root = resolve(import.meta.dirname, '..');
const errors: string[] = [];
const expected = await buildIdentityReviewPacket();
const jsonPath = resolve(root, 'reports/c4.2a-identity-review-packet-18.1.json');
const mdPath = resolve(root, 'reports/c4.2a-identity-review-packet-18.1.md');
const [actualJson, actualMarkdown] = await Promise.all([readFile(jsonPath, 'utf8'), readFile(mdPath, 'utf8')]);
if (actualJson !== expected.json) errors.push('JSON packet is stale or non-deterministic.');
if (actualMarkdown !== expected.markdown) errors.push('Markdown packet is stale or non-deterministic.');
const packet = JSON.parse(actualJson);
const readiness = JSON.parse(await readFile(resolve(root, 'reports/release-readiness-18.1.json'), 'utf8'));
const production = JSON.parse(await readFile(resolve(root, 'data/normalized/wisps_18.1.json'), 'utf8'));
const ids = packet.clusters.flatMap((cluster: any) => cluster.sourceItems.map((item: any) => item.itemId));
const expectedIds = [
  ...readiness.identity.reviewQueue.map((row: any) => `opgg:${row.candidateIdentity}`),
  ...readiness.identity.dataTftUnmatched.map((row: any) => `datatft:${row.id}`),
  ...readiness.identity.communityDragonConfirmedUnlinked.map((row: any) => `communitydragon:${row.evidence.communityDragonApiName}`),
].sort();
if (ids.length !== new Set(ids).size) errors.push('A source review item occurs in more than one cluster.');
if (JSON.stringify([...ids].sort()) !== JSON.stringify(expectedIds)) errors.push('Current source queues do not appear exactly once.');
if (packet.summary.rawReviewItemsBeforeClustering !== expectedIds.length || packet.summary.uniqueClustersAfterClustering !== packet.clusters.length) errors.push('Raw/cluster summary counts do not reconcile.');
if (!packet.deterministicMethod.includes('top score >= 0.8') || !packet.deterministicMethod.includes('exceed second score by more than 0.05') || !packet.deterministicMethod.includes('never confirms identity')) errors.push('Deterministic method metadata does not describe DataTFT overlap governance.');
if (!actualMarkdown.includes(packet.deterministicMethod)) errors.push('Markdown does not expose the machine packet deterministic method.');
packet.clusters.forEach((cluster: any, index: number) => {
  if (cluster.clusterId !== `C4I-${String(index + 1).padStart(3, '0')}`) errors.push(`Non-deterministic cluster ID at index ${index}.`);
  if (cluster.recommendedHumanAction === 'same_identity' && (!cluster.recommendedProductionId || !cluster.productionIdentityLink.confirmingEvidence.length)) errors.push(`${cluster.clusterId}: same_identity lacks a production ID or confirming evidence.`);
  if (cluster.productionIdentityLink.status === 'confirmed' && !cluster.productionIdentityLink.confirmingEvidence.length) errors.push(`${cluster.clusterId}: fuzzy evidence was silently promoted to confirmed.`);
  if (cluster.recommendedHumanAction === 'source_variant' && (!cluster.variant?.baseProductionId || !cluster.variant?.type || !cluster.variant?.reason)) errors.push(`${cluster.clusterId}: source_variant lacks base/type/reason.`);
  if (cluster.recommendedHumanAction === 'distinct_identity' && (!cluster.corpusMembership?.status || !cluster.conflictingEvidence.length)) errors.push(`${cluster.clusterId}: distinct_identity lacks membership/exclusion evidence.`);
  if (cluster.priority === 'P0' && !cluster.currentQuestion.startsWith('DataTFT')) errors.push(`${cluster.clusterId}: P0 question must focus on the DataTFT unmatched identity.`);
  if (cluster.priority === 'P1' && !cluster.currentQuestion.startsWith('已确认的')) errors.push(`${cluster.clusterId}: P1 question must ask for the production link of an already-confirmed identity.`);
  if (cluster.priority === 'P3' && !cluster.currentQuestion.startsWith('OP.GG')) errors.push(`${cluster.clusterId}: P3 question must classify the OP.GG-only candidate.`);
  for (const item of cluster.sourceItems.filter((row: any) => row.source === 'datatft')) {
    const productionRow = production.records.find((row: any) => row.id === item.sourceKey);
    if (item.effect !== productionRow?.effects?.normal) errors.push(`${cluster.clusterId}: DataTFT effect does not match production effects.normal.`);
  }
  for (const followUp of cluster.fieldReviewFollowUps) {
    if (!followUp.startsWith('Defer to C4.2B field review:')) errors.push(`${cluster.clusterId}: field follow-up is not explicitly deferred to C4.2B.`);
    if (cluster.productionIdentityLink.confirmingEvidence.includes(followUp)) errors.push(`${cluster.clusterId}: field conflict was used as identity-confirming evidence.`);
  }
});
const cloneCluster = packet.clusters.find((cluster: any) => cluster.sourceItems.some((item: any) => item.sourceKey === 'CloneCompanion'));
if (!cloneCluster || cloneCluster.strongProductionCandidates.length !== 1 || cloneCluster.strongProductionCandidates[0].productionId !== 'snapshot_139_6fda4e76a4da') errors.push('C4I CloneCompanion must retain exactly one strong supporting production candidate.');
if (cloneCluster?.conflictingEvidence.some((evidence: string) => evidence.includes('Multiple strong')) || cloneCluster?.productionIdentityLink.status !== 'unresolved' || cloneCluster?.recommendedHumanAction !== 'insufficient_evidence') errors.push('C4I CloneCompanion must not describe its single strong candidate as a conflict or resolve identity.');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`Identity review packet valid: ${expectedIds.length} raw items in ${packet.clusters.length} deterministic clusters.`);
