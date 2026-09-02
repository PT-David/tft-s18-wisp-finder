import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateIdentityDecisions, type C42A4EvidenceBundle, type DecisionValidationInput, type IdentityDecisionFile } from './data/lib/identity-decisions';
const root = resolve(import.meta.dirname, '..'); const read = (path: string) => readFile(resolve(root, path), 'utf8'); const json = async <T>(path: string): Promise<T> => JSON.parse(await read(path)) as T; const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const [decisions, frozenEvidence, production, mappings, readiness, evidenceText, productionText, mappingsText, readinessText] = await Promise.all([
  json<IdentityDecisionFile>('data/reviews/18.1/c4.2a-identity-decisions.json'), json<C42A4EvidenceBundle>('data/reviews/18.1/c4.2a4-identity-evidence.json'), json<DecisionValidationInput['production']>('data/normalized/wisps_18.1.json'), json<DecisionValidationInput['mappings']>('data/overrides/18.1/reviewed-identity-mappings.json'), json<{ recommendedProductionReady: boolean }>('reports/release-readiness-18.1.json'), read('data/reviews/18.1/c4.2a4-identity-evidence.json'), read('data/normalized/wisps_18.1.json'), read('data/overrides/18.1/reviewed-identity-mappings.json'), read('reports/release-readiness-18.1.json')
]);
const result = validateIdentityDecisions({ decisions, frozenEvidence, frozenEvidenceSha256: sha(evidenceText), production, mappings, currentState: { productionSha256: sha(productionText), reviewedMappingsSha256: sha(mappingsText), releaseReadinessSha256: sha(readinessText), recommendedProductionReady: readiness.recommendedProductionReady } });
if (result.errors.length) throw new Error(`C4.2A4 identity decision validation failed:\n- ${result.errors.join('\n- ')}`);
console.log(`Validated ${result.totals.decisions} manual C4.2A4 identity decisions from frozen evidence (${result.totals.sameIdentity} same; ${result.totals.missingBaseIdentity} missing; fulfillment ${result.totals.pending} pending/${result.totals.fulfilled} fulfilled).`);
