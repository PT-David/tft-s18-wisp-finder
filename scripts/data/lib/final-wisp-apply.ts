import { buildNewRecordPlan, sha256, stableJson, type Json } from './c4.2b-field-decisions';

const ALLOWED = new Map<string, unknown>([['DA_BearsVisit18:category', 'combat'], ['DA_Snacktime18:cost', 3]]);
const BEAR_REQUIREMENTS = 'DA_BearsVisit18:requirements';
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const MANUAL_SOURCE = {
  sourceId: 'user_reviewed_c4_final_blockers_18_1', tier: 'E', locale: 'multi', retrievedAt: '2026-09-03T00:00:00Z', confidence: 'unverified',
  useFor: ['category', 'requirements', 'cost'], sourceArtifact: 'data/c4_final_three_blocker_overrides_18.1.json', provenanceKind: 'user_approved_manual_override',
};

export function applyFinalBlockerOverrides(effective: { frozen: Json; overlay: Json }, input: Json) {
  if (input.schemaVersion !== 1 || input.patch !== '18.1' || input.policy !== 'user_approved_manual_override' || !Array.isArray(input.overrides)) throw new Error('Invalid final blocker override envelope.');
  const expected = new Set([...ALLOWED.keys(), BEAR_REQUIREMENTS]), seen = new Set<string>();
  const frozen = structuredClone(effective.frozen), overlay = structuredClone(effective.overlay);
  const decisions = new Map<string, Json>(overlay.decisions.map((decision: Json) => [decision.reviewId, decision]));
  frozen.decisionTimeSourceManifest.sources.push(MANUAL_SOURCE);
  for (const override of input.overrides as Json[]) {
    const key = `${override.riotId}:${override.field}`;
    if (!expected.has(key)) throw new Error(`Manual override target is not allowed: ${key}`);
    if (seen.has(key)) throw new Error(`Duplicate manual override: ${key}`); seen.add(key);
    if (key === BEAR_REQUIREMENTS) {
      if (!Array.isArray(override.value) || override.value.length === 0) throw new Error('Bear requirements override must be a non-empty array.');
    } else if (!same(override.value, ALLOWED.get(key))) throw new Error(`Manual override has unexpected value: ${key}`);
    const item = frozen.reviewItems.find((candidate: Json) => candidate.identity.communityDragonId === override.riotId && candidate.field === override.field);
    const decision = item && decisions.get(item.reviewId);
    if (!item || !decision || decision.action !== 'unresolved') throw new Error(`Manual override does not resolve exactly one unresolved target: ${key}`);
    const evidenceId = `FINAL-MANUAL-${sha256(key).slice(0, 12)}`;
    const evidence = { evidenceId, sourceId: MANUAL_SOURCE.sourceId, tier: MANUAL_SOURCE.tier, confidence: MANUAL_SOURCE.confidence, retrievedAt: MANUAL_SOURCE.retrievedAt, sourceLocaleCoverage: MANUAL_SOURCE.locale, valueLocale: override.field === 'requirements' ? 'multi' : 'n/a', useFor: MANUAL_SOURCE.useFor, proposedProductionValue: structuredClone(override.value), comparisonValue: structuredClone(override.value), normalizedInterpretation: structuredClone(override.value) };
    item.evidence.push(evidence);
    if (!item.productionCandidateValues.some((value: unknown) => same(value, override.value))) item.productionCandidateValues.push(structuredClone(override.value));
    Object.assign(decision, { action: 'approve_explicit_value', approvedValue: structuredClone(override.value), evidenceRefs: [evidenceId], reason: override.reason, applyPolicy: 'apply' });
  }
  if (seen.size !== expected.size || [...expected].some((key) => !seen.has(key))) throw new Error('Final blocker override file must contain exactly the three approved targets.');
  frozen.frozenFrom.sourceManifestSha256 = sha256(stableJson(frozen.decisionTimeSourceManifest));
  delete frozen.bundleSha256; frozen.bundleSha256 = sha256(stableJson(frozen)); overlay.evidenceBinding.frozenEvidenceSha256 = frozen.bundleSha256;
  return { frozen, overlay };
}

export function buildFinalAdditions(effective: { frozen: Json; overlay: Json }, input: Json) {
  const existingPlans = new Map(['DA_MemorialDummy18', 'DA_PottedLifebloom18', 'DA_PottedStonebark18', 'DA_TigersVisit18_Wisp', 'DA_TurtlesVisit18'].map((id) => [id, buildNewRecordPlan(effective.frozen, effective.overlay, id)]));
  const applied = applyFinalBlockerOverrides(effective, input);
  const ids = ['DA_BearsVisit18', 'DA_MemorialDummy18', 'DA_PottedLifebloom18', 'DA_PottedStonebark18', 'DA_Snacktime18', 'DA_TigersVisit18_Wisp', 'DA_TurtlesVisit18'];
  return ids.map((id) => { const record = existingPlans.get(id) ?? buildNewRecordPlan(applied.frozen, applied.overlay, id); if (!record) throw new Error(`Reviewed addition is not READY: ${id}`); return record; });
}
