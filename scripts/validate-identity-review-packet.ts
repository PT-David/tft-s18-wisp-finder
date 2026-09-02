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
const ids = packet.clusters.flatMap((cluster: any) => cluster.sourceItems.map((item: any) => item.itemId));
const expectedIds = [
  ...readiness.identity.reviewQueue.map((row: any) => `opgg:${row.candidateIdentity}`),
  ...readiness.identity.dataTftUnmatched.map((row: any) => `datatft:${row.id}`),
  ...readiness.identity.communityDragonConfirmedUnlinked.map((row: any) => `communitydragon:${row.evidence.communityDragonApiName}`),
].sort();
if (ids.length !== new Set(ids).size) errors.push('A source review item occurs in more than one cluster.');
if (JSON.stringify([...ids].sort()) !== JSON.stringify(expectedIds)) errors.push('Current source queues do not appear exactly once.');
if (packet.summary.rawReviewItemsBeforeClustering !== expectedIds.length || packet.summary.uniqueClustersAfterClustering !== packet.clusters.length) errors.push('Raw/cluster summary counts do not reconcile.');
packet.clusters.forEach((cluster: any, index: number) => {
  if (cluster.clusterId !== `C4I-${String(index + 1).padStart(3, '0')}`) errors.push(`Non-deterministic cluster ID at index ${index}.`);
  if (cluster.recommendedHumanAction === 'same_identity' && (!cluster.recommendedProductionId || !cluster.productionIdentityLink.confirmingEvidence.length)) errors.push(`${cluster.clusterId}: same_identity lacks a production ID or confirming evidence.`);
  if (cluster.productionIdentityLink.status === 'confirmed' && !cluster.productionIdentityLink.confirmingEvidence.length) errors.push(`${cluster.clusterId}: fuzzy evidence was silently promoted to confirmed.`);
  if (cluster.recommendedHumanAction === 'source_variant' && (!cluster.variant?.baseProductionId || !cluster.variant?.type || !cluster.variant?.reason)) errors.push(`${cluster.clusterId}: source_variant lacks base/type/reason.`);
  if (cluster.recommendedHumanAction === 'distinct_identity' && (!cluster.corpusMembership?.status || !cluster.conflictingEvidence.length)) errors.push(`${cluster.clusterId}: distinct_identity lacks membership/exclusion evidence.`);
});
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`Identity review packet valid: ${expectedIds.length} raw items in ${packet.clusters.length} deterministic clusters.`);
