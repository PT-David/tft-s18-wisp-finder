import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { validateIdentityDecisions, type DecisionValidationInput, type IdentityDecisionFile } from '../scripts/data/lib/identity-decisions';

const read = (path: string) => readFile(path, 'utf8');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const clone = <T>(value: T): T => structuredClone(value);
type Packet = { clusters: Array<{ clusterId: string }> }; type Old = { records: Array<{ sourceIndex: number }> };
type Fresh = { records: Array<{ sourceIndex: number; en: { name: string }; zh: { name: string } }> };
type Client = { locales: { en_us: { records: Array<{ apiName: string; name: string }> }; zh_cn: { records: Array<{ apiName: string; name: string }> } } };
async function fixture(): Promise<DecisionValidationInput> {
  const paths = ['data/reviews/18.1/c4.2a-identity-decisions.json', 'reports/c4.2a2-priority-identity-proposals-18.1.json', 'reports/c4.2a3-catalog-delta-reconciliation-18.1.json', 'data/normalized/wisps_18.1.json', 'data/overrides/18.1/reviewed-identity-mappings.json', 'reports/c4.2a-identity-review-packet-18.1.json', 'data/raw/18.1/datatft-wisps-zh.json', 'data/raw/18.1/20260902/datatft-priority-wisps-browser.json', 'data/raw/18.1/20260902/communitydragon-priority-wisps.json', 'data/raw/18.1/20260902/communitydragon-bear-tiger.json', 'reports/release-readiness-18.1.json'] as const;
  const text = await Promise.all(paths.map(read));
  const decisions = JSON.parse(text[0]) as IdentityDecisionFile; const proposals = JSON.parse(text[1]) as DecisionValidationInput['proposals']; const reconciliation = JSON.parse(text[2]) as DecisionValidationInput['reconciliation'];
  const packet = JSON.parse(text[5]) as Packet; const old = JSON.parse(text[6]) as Old; const fresh = JSON.parse(text[7]) as Fresh; const clients = [JSON.parse(text[8]) as Client, JSON.parse(text[9]) as Client];
  const displays = clients.flatMap((client) => client.locales.en_us.records.map((row) => ({ apiName: row.apiName, nameEn: row.name, nameZh: client.locales.zh_cn.records.find((zh) => zh.apiName === row.apiName)?.name ?? '' })));
  const readiness = JSON.parse(text[10]) as { recommendedProductionReady: boolean };
  return { decisions, proposals, reconciliation, production: JSON.parse(text[3]) as DecisionValidationInput['production'], mappings: JSON.parse(text[4]) as DecisionValidationInput['mappings'], evidenceHashes: { identityPacketSha256: sha(text[5]), priorityProposalSha256: sha(text[1]), catalogDeltaSha256: sha(text[2]) }, currentState: { productionSha256: sha(text[3]), reviewedMappingsSha256: sha(text[4]), releaseReadinessSha256: sha(text[10]), recommendedProductionReady: readiness.recommendedProductionReady }, evidenceSources: { a1ClusterIds: packet.clusters.map((row) => row.clusterId), oldDataTftRows: old.records.map((row) => row.sourceIndex), freshDataTftRecords: fresh.records.map((row) => ({ sourceIndex: row.sourceIndex, nameEn: row.en.name, nameZh: row.zh.name })), communityDragonDisplays: displays, hasBearTigerFocusedEvidence: clients[1]!.locales.en_us.records.length > 0 } };
}
const mutate = async (fn: (input: DecisionValidationInput) => void) => { const input = clone(await fixture()); fn(input); return validateIdentityDecisions(input); };
const applyMissing = (input: DecisionValidationInput) => { for (const row of input.decisions.decisions.filter((item) => item.action === 'missing_base_identity')) { const productionId = `applied_${row.communityDragonId}`; input.production.records.push({ id: productionId, riotId: row.communityDragonId }); input.mappings.records.push({ communityDragonId: row.communityDragonId, productionId }); } };

describe('C4.2A4 manual identity decision governance', () => {
  it('uses manual actions as truth and accepts current evidence-admissible same/missing decisions', async () => { const result = validateIdentityDecisions(await fixture()); expect(result.errors).toEqual([]); expect(result.totals).toMatchObject({ decisions: 8, sameIdentity: 1, missingBaseIdentity: 7, pending: 8, fulfilled: 0 }); });
  it('accepts missing action for C4I-002 without deriving action from its A2 insufficient proposal', async () => { const input = await fixture(); expect(input.proposals.proposals.find((row) => row.clusterId === 'C4I-002')?.proposedAction).not.toBe('missing_base_identity'); expect(validateIdentityDecisions(input).errors).toEqual([]); });
  it('rejects unsupported same action', async () => expect((await mutate((x) => { x.decisions.decisions[1]!.action = 'same_identity'; x.decisions.decisions[1]!.productionId = 'no-target'; x.decisions.decisions[1]!.productionRecordCreationRequired = false; })).errors).toContainEqual(expect.stringContaining('same_identity action is not admissible')));
  it('rejects unsupported missing action', async () => expect((await mutate((x) => { x.decisions.decisions[0]!.action = 'missing_base_identity'; delete x.decisions.decisions[0]!.productionId; x.decisions.decisions[0]!.productionRecordCreationRequired = true; })).errors).toContainEqual(expect.stringContaining('missing_base_identity action is not admissible')));
  it('rejects an unresolved evidence ref', async () => expect((await mutate((x) => { x.decisions.decisions[0]!.evidenceRefs.push('A3:freshIndex-999'); })).errors).toContainEqual(expect.stringContaining('unresolved evidenceRef')));
  it('rejects canonical English or Chinese name drift', async () => { expect((await mutate((x) => { x.decisions.decisions[1]!.canonicalNameEn = 'Wrong'; })).errors).toContainEqual(expect.stringContaining('not admissible')); expect((await mutate((x) => { x.decisions.decisions[1]!.canonicalNameZh = '错误'; })).errors).toContainEqual(expect.stringContaining('not admissible')); });
  it('rejects stale evidence fingerprints', async () => expect((await mutate((x) => { x.evidenceHashes.catalogDeltaSha256 = '0'.repeat(64); })).errors).toContain('identity decisions stale against reviewed evidence'));
  it('keeps all seven correctly applied missing decisions valid and fulfilled', async () => { const input = await fixture(); applyMissing(input); const result = validateIdentityDecisions(input); expect(result.errors).toEqual([]); expect(result.totals).toMatchObject({ pending: 1, fulfilled: 7 }); });
  it('accepts the approved Clone mapping and marks it fulfilled', async () => { const input = await fixture(); input.mappings.records.push({ communityDragonId: 'DA_CloneCompanion18', productionId: 'snapshot_139_6fda4e76a4da' }); const result = validateIdentityDecisions(input); expect(result.errors).toEqual([]); expect(result.fulfillment.find((row) => row.decisionId === 'C4A4-001')?.status).toBe('fulfilled'); });
  it('rejects a wrong post-apply mapping', async () => expect((await mutate((x) => { x.mappings.records.push({ communityDragonId: 'DA_CloneCompanion18', productionId: 'da_ironwood18' }); })).errors).toContainEqual(expect.stringContaining('disagrees with approved productionId')));
  it('rejects duplicate apply targets', async () => expect((await mutate((x) => { const id = 'applied_bear'; x.production.records.push({ id, riotId: 'DA_BearsVisit18' }); x.mappings.records.push({ communityDragonId: 'DA_BearsVisit18', productionId: id }, { communityDragonId: 'DA_BearsVisit18', productionId: id }); })).errors).toContainEqual(expect.stringContaining('duplicate apply targets')));
  it('rejects Tiger upgrade misuse without relying on decisionId', async () => expect((await mutate((x) => { x.decisions.decisions[6]!.communityDragonId = 'DA_BearsVisit18_Upgrade'; })).errors).toContainEqual(expect.stringContaining('not admissible')));
  it('rejects duplicate client decisions and field leakage', async () => { expect((await mutate((x) => { x.decisions.decisions[2]!.communityDragonId = 'DA_BearsVisit18'; })).errors).toContain('Duplicate communityDragonId.'); expect((await mutate((x) => { Object.assign(x.decisions.decisions[5]!, { fieldResolutionStatus: 'approved' }); })).errors).toContainEqual(expect.stringContaining('field resolution leaked')); });
  it('generates a byte-deterministic report without rewriting the manual overlay', async () => {
    const decisionBefore = sha(await read('data/reviews/18.1/c4.2a-identity-decisions.json'));
    execFileSync('npm', ['run', 'data:c4.2a-identity-decision-report:18.1'], { stdio: 'pipe' });
    const reportOnce = sha(await read('reports/c4.2a4-identity-decisions-18.1.md'));
    execFileSync('npm', ['run', 'data:c4.2a-identity-decision-report:18.1'], { stdio: 'pipe' });
    expect(sha(await read('reports/c4.2a4-identity-decisions-18.1.md'))).toBe(reportOnce);
    expect(sha(await read('data/reviews/18.1/c4.2a-identity-decisions.json'))).toBe(decisionBefore);
  });
});
