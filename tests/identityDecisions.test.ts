import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { validateIdentityDecisions, type DecisionValidationInput } from '../scripts/data/lib/identity-decisions';

const read = (path: string) => readFile(path, 'utf8');
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const clone = <T>(value: T): T => structuredClone(value);
async function fixture(): Promise<DecisionValidationInput> {
  const [decisionText, proposalText, reconciliationText, productionText, mappingText, a1] = await Promise.all([
    read('data/reviews/18.1/c4.2a-identity-decisions.json'), read('reports/c4.2a2-priority-identity-proposals-18.1.json'),
    read('reports/c4.2a3-catalog-delta-reconciliation-18.1.json'), read('data/normalized/wisps_18.1.json'),
    read('data/overrides/18.1/reviewed-identity-mappings.json'), read('reports/c4.2a-identity-review-packet-18.1.json')
  ]);
  return { decisions: JSON.parse(decisionText), proposals: JSON.parse(proposalText), reconciliation: JSON.parse(reconciliationText), production: JSON.parse(productionText), mappings: JSON.parse(mappingText), evidenceHashes: { identityPacketSha256: sha(a1), priorityProposalSha256: sha(proposalText), catalogDeltaSha256: sha(reconciliationText) } };
}
const mutate = async (fn: (input: DecisionValidationInput) => void) => { const input = clone(await fixture()); fn(input); return validateIdentityDecisions(input); };

describe('C4.2A4 manual identity decision governance', () => {
  it('accepts the supported same identity and exact missing-base coverage', async () => expect(validateIdentityDecisions(await fixture())).toEqual([]));
  it('rejects a wrong same-identity production target', async () => expect(await mutate((x) => { x.decisions.decisions[0].productionId = 'wrong'; })).toContainEqual(expect.stringContaining('C4A4-001')));
  it('rejects productionId on a missing identity', async () => expect(await mutate((x) => { x.decisions.decisions[1].productionId = 'wrong'; })).toContainEqual(expect.stringContaining('omit productionId')));
  it('rejects a missing identity with an existing reviewed mapping', async () => expect(await mutate((x) => { x.mappings.records.push({ communityDragonId: 'DA_BearsVisit18', productionId: 'existing' }); })).toContainEqual(expect.stringContaining('reviewed-mapping')));
  it('rejects stale evidence fingerprints', async () => expect(await mutate((x) => { x.evidenceHashes.catalogDeltaSha256 = '0'.repeat(64); })).toContain('identity decisions stale against reviewed evidence'));
  it('rejects duplicate client identities', async () => expect(await mutate((x) => { x.decisions.decisions[2].communityDragonId = 'DA_BearsVisit18'; })).toContain('Duplicate communityDragonId.'));
  it('rejects any missing A3 decision', async () => expect(await mutate((x) => { x.decisions.decisions.splice(1, 1); })).toContainEqual(expect.stringContaining('DA_BearsVisit18')));
  it('rejects the wrong Tiger family', async () => expect(await mutate((x) => { x.decisions.decisions[6].communityDragonId = 'DA_BearsVisit18_Upgrade'; })).toContainEqual(expect.stringContaining('Tiger family governance')));
  it('rejects field approval leakage', async () => expect(await mutate((x) => { x.decisions.decisions[5].fieldResolutionStatus = 'approved'; })).toContainEqual(expect.stringContaining('field resolution leaked')));
});
