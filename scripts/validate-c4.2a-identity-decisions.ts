import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateIdentityDecisions, type DecisionValidationInput, type IdentityDecisionFile } from './data/lib/identity-decisions';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFile(resolve(root, path), 'utf8');
const json = async <T>(path: string): Promise<T> => JSON.parse(await read(path)) as T;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
type ClusterPacket = { clusters: Array<{ clusterId: string }> };
type OldDataTft = { records: Array<{ sourceIndex: number }> };
type FreshDataTft = { records: Array<{ sourceIndex: number; en: { name: string }; zh: { name: string } }> };
type ClientSnapshot = { locales: { en_us: { records: Array<{ apiName: string; name: string }> }; zh_cn: { records: Array<{ apiName: string; name: string }> } } };

const [decisions, proposals, reconciliation, production, mappings, packet, oldDataTft, freshDataTft, priorityClient, focusedClient, readiness, productionText, mappingsText, readinessText, a1, a2, a3] = await Promise.all([
  json<IdentityDecisionFile>('data/reviews/18.1/c4.2a-identity-decisions.json'), json<DecisionValidationInput['proposals']>('reports/c4.2a2-priority-identity-proposals-18.1.json'),
  json<DecisionValidationInput['reconciliation']>('reports/c4.2a3-catalog-delta-reconciliation-18.1.json'), json<DecisionValidationInput['production']>('data/normalized/wisps_18.1.json'),
  json<DecisionValidationInput['mappings']>('data/overrides/18.1/reviewed-identity-mappings.json'), json<ClusterPacket>('reports/c4.2a-identity-review-packet-18.1.json'),
  json<OldDataTft>('data/raw/18.1/datatft-wisps-zh.json'), json<FreshDataTft>('data/raw/18.1/20260902/datatft-priority-wisps-browser.json'),
  json<ClientSnapshot>('data/raw/18.1/20260902/communitydragon-priority-wisps.json'), json<ClientSnapshot>('data/raw/18.1/20260902/communitydragon-bear-tiger.json'),
  json<{ recommendedProductionReady: boolean }>('reports/release-readiness-18.1.json'), read('data/normalized/wisps_18.1.json'), read('data/overrides/18.1/reviewed-identity-mappings.json'), read('reports/release-readiness-18.1.json'),
  read('reports/c4.2a-identity-review-packet-18.1.json'), read('reports/c4.2a2-priority-identity-proposals-18.1.json'), read('reports/c4.2a3-catalog-delta-reconciliation-18.1.json')
]);
const displays = (snapshot: ClientSnapshot) => snapshot.locales.en_us.records.map((row) => ({ apiName: row.apiName, nameEn: row.name, nameZh: snapshot.locales.zh_cn.records.find((zh) => zh.apiName === row.apiName)?.name ?? '' }));
const input: DecisionValidationInput = { decisions, proposals, reconciliation, production, mappings,
  evidenceHashes: { identityPacketSha256: sha(a1), priorityProposalSha256: sha(a2), catalogDeltaSha256: sha(a3) },
  currentState: { productionSha256: sha(productionText), reviewedMappingsSha256: sha(mappingsText), releaseReadinessSha256: sha(readinessText), recommendedProductionReady: readiness.recommendedProductionReady },
  evidenceSources: { a1ClusterIds: packet.clusters.map((row) => row.clusterId), oldDataTftRows: oldDataTft.records.map((row) => row.sourceIndex), freshDataTftRecords: freshDataTft.records.map((row) => ({ sourceIndex: row.sourceIndex, nameEn: row.en.name, nameZh: row.zh.name })), communityDragonDisplays: [...displays(priorityClient), ...displays(focusedClient)], hasBearTigerFocusedEvidence: focusedClient.locales.en_us.records.length > 0 }
};
const result = validateIdentityDecisions(input);
if (result.errors.length) throw new Error(`C4.2A4 identity decision validation failed:\n- ${result.errors.join('\n- ')}`);
console.log(`Validated ${result.totals.decisions} manual C4.2A4 identity decisions (${result.totals.sameIdentity} same identity; ${result.totals.missingBaseIdentity} missing base identities; fulfillment ${result.totals.pending} pending/${result.totals.fulfilled} fulfilled).`);
