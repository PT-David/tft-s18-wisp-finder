import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateIdentityDecisions } from './data/lib/identity-decisions';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFile(resolve(root, path), 'utf8');
const json = async (path: string) => JSON.parse(await read(path));
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const [decisions, proposals, reconciliation, production, mappings, a1, a2, a3] = await Promise.all([
  json('data/reviews/18.1/c4.2a-identity-decisions.json'), json('reports/c4.2a2-priority-identity-proposals-18.1.json'),
  json('reports/c4.2a3-catalog-delta-reconciliation-18.1.json'), json('data/normalized/wisps_18.1.json'),
  json('data/overrides/18.1/reviewed-identity-mappings.json'), read('reports/c4.2a-identity-review-packet-18.1.json'),
  read('reports/c4.2a2-priority-identity-proposals-18.1.json'), read('reports/c4.2a3-catalog-delta-reconciliation-18.1.json')
]);
const errors = validateIdentityDecisions({ decisions, proposals, reconciliation, production, mappings, evidenceHashes: { identityPacketSha256: sha(a1), priorityProposalSha256: sha(a2), catalogDeltaSha256: sha(a3) } });
if (errors.length) throw new Error(`C4.2A4 identity decision validation failed:\n- ${errors.join('\n- ')}`);
console.log('Validated 8 manual C4.2A4 identity decisions (1 same identity; 7 missing base identities).');
