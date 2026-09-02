export type IdentityDecisionAction = 'same_identity' | 'missing_base_identity';
export type DecisionFulfillmentStatus = 'pending_apply' | 'fulfilled';
export interface DecisionBaseline { productionSha256: string; productionRecordCount: number; reviewedMappingsSha256: string; releaseReadinessSha256: string; recommendedProductionReady: boolean }
export interface IdentityDecision { decisionId: string; clusterId?: string; communityDragonId: string; canonicalNameEn: string; canonicalNameZh: string; action: IdentityDecisionAction; productionId?: string; productionRecordCreationRequired: boolean; evidenceRefs: string[]; reason: string; fieldResolutionStatus: 'pending_c4.2b' }
export interface IdentityDecisionFile { schemaVersion: number; patch: string; reviewMetadata: { reviewStage: string; reviewedAt: string; evidenceBinding: { c4a4EvidenceBundleSha256: string }; decisionBaseline: DecisionBaseline; policy: string }; decisions: IdentityDecision[] }
interface SameIdentityEvidence { kind: 'same_identity'; a2ProposedAction: string; approvedProductionId: string; policyCompliantTargets: string[]; a3ContinuityImpact: string; oldIndex: number; freshIndex: number; baseApiName: string }
interface MissingBaseEvidence { kind: 'missing_base_identity'; a3Classification: string; productionTargetCount: number; reviewedMappingTargetCount: number; baseApiName: string; upgradeApiNames: string[]; prismaticApiNames: string[]; freshIndex: number }
export interface EvidenceIdentity { communityDragonId: string; canonicalNameEn: string; canonicalNameZh: string; clusterId?: string; evidenceRefs: string[]; historicalAdmissibility: SameIdentityEvidence | MissingBaseEvidence }
export interface C42A4EvidenceBundle { schemaVersion: number; patch: string; reviewStage: string; sourceArtifactHashes: { a1: string; a2: string; a3: string }; decisionBaseline: DecisionBaseline; identities: EvidenceIdentity[] }
interface ProductionRecord { id: string; riotId?: string | null }
interface MappingRecord { communityDragonId: string; productionId: string }
export interface DecisionValidationInput { decisions: IdentityDecisionFile; frozenEvidence: C42A4EvidenceBundle; frozenEvidenceSha256: string; production: { records: ProductionRecord[] }; mappings: { records: MappingRecord[] }; currentState: { productionSha256: string; reviewedMappingsSha256: string; releaseReadinessSha256: string; recommendedProductionReady: boolean } }
export interface DecisionFulfillment { decisionId: string; status: DecisionFulfillmentStatus; productionId?: string }
export interface DecisionValidationResult { errors: string[]; fulfillment: DecisionFulfillment[]; totals: { decisions: number; sameIdentity: number; missingBaseIdentity: number; pending: number; fulfilled: number } }
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const isSha = (value: string) => /^[a-f0-9]{64}$/.test(value);

function expectedEvidenceRefs(identity: EvidenceIdentity): Set<string> {
  const evidence = identity.historicalAdmissibility; const refs = new Set<string>();
  refs.add(`CommunityDragon:${identity.communityDragonId}`);
  if (identity.clusterId) { refs.add(`A1:${identity.clusterId}`); refs.add(`A2:${identity.clusterId}`); refs.add(`A3:${identity.clusterId}`); }
  if (evidence.kind === 'same_identity') { refs.add(`DataTFT:old-row-${evidence.oldIndex}`); refs.add(`DataTFT:fresh-row-${evidence.freshIndex}`); }
  else refs.add(`A3:freshIndex-${evidence.freshIndex}`);
  if (identity.communityDragonId === 'DA_TigersVisit18_Wisp') refs.add('CommunityDragon:bear-tiger-focused-evidence');
  return refs;
}
function evidenceRefsResolve(identity: EvidenceIdentity): boolean {
  const allowed = expectedEvidenceRefs(identity);
  return identity.evidenceRefs.length > 0 && identity.evidenceRefs.every((ref) => allowed.has(ref));
}
function currentTargets(decision: IdentityDecision, production: ProductionRecord[], mappings: MappingRecord[]): { targets: string[]; errors: string[] } {
  const errors: string[] = []; const direct = production.filter((row) => row.riotId === decision.communityDragonId).map((row) => row.id); const mapped = mappings.filter((row) => row.communityDragonId === decision.communityDragonId).map((row) => row.productionId); const targets = [...new Set([...direct, ...mapped])];
  for (const target of mapped) { const record = production.find((row) => row.id === target); if (!record) errors.push(`${decision.decisionId}: reviewed mapping points to missing production target ${target}.`); else if (record.riotId && record.riotId !== decision.communityDragonId) errors.push(`${decision.decisionId}: reviewed mapping target has the wrong client identity.`); }
  if (targets.length > 1 || direct.length > 1 || mapped.length > 1) errors.push(`${decision.decisionId}: ambiguous or duplicate apply targets.`);
  return { targets, errors };
}
export function validateIdentityDecisions(input: DecisionValidationInput): DecisionValidationResult {
  const { decisions: file, frozenEvidence: bundle, production, mappings } = input; const errors: string[] = []; const fulfillment: DecisionFulfillment[] = []; const rows = file.decisions;
  if (file.schemaVersion !== 1 || file.patch !== '18.1' || file.reviewMetadata.reviewStage !== 'C4.2A4' || file.reviewMetadata.policy !== 'manual_project_review') errors.push('Invalid decision-file metadata.');
  if (bundle.schemaVersion !== 1 || bundle.patch !== '18.1' || bundle.reviewStage !== 'C4.2A4' || !Object.values(bundle.sourceArtifactHashes).every(isSha)) errors.push('Invalid frozen C4.2A4 evidence metadata.');
  if (file.reviewMetadata.evidenceBinding.c4a4EvidenceBundleSha256 !== input.frozenEvidenceSha256) errors.push('identity decisions stale against frozen C4.2A4 evidence');
  if (!equal(file.reviewMetadata.decisionBaseline, bundle.decisionBaseline)) errors.push('Decision baseline disagrees with frozen C4.2A4 evidence.');
  const hasAppliedTarget = rows.some((decision) => currentTargets(decision, production.records, mappings.records).targets.length > 0); const baseline = bundle.decisionBaseline;
  // Release-readiness is historical decision-time context, not identity state. Field evidence and
  // release audits may legitimately evolve before apply; production and reviewed mappings may not.
  if (!hasAppliedTarget && (input.currentState.productionSha256 !== baseline.productionSha256 || input.currentState.reviewedMappingsSha256 !== baseline.reviewedMappingsSha256 || production.records.length !== baseline.productionRecordCount)) errors.push('Current pre-apply identity state does not match the recorded decision baseline.');
  for (const key of ['decisionId', 'communityDragonId'] as const) if (new Set(rows.map((row) => row[key])).size !== rows.length) errors.push(`Duplicate ${key}.`);
  for (const decision of rows) {
    if (!/^C4A4-\d{3}$/.test(decision.decisionId)) errors.push(`${decision.decisionId}: invalid stable decision ID.`);
    if (!decision.evidenceRefs.length || !decision.reason) errors.push(`${decision.decisionId}: evidence and reason are required.`);
    if (decision.fieldResolutionStatus !== 'pending_c4.2b') errors.push(`${decision.decisionId}: field resolution leaked into the identity layer.`);
    const evidenceMatches = bundle.identities.filter((identity) => identity.communityDragonId === decision.communityDragonId); const evidence = evidenceMatches[0];
    if (evidenceMatches.length !== 1 || !evidence) errors.push(`${decision.decisionId}: expected exactly one frozen identity evidence row.`);
    else {
      if (!equal(decision.evidenceRefs, evidence.evidenceRefs) || !evidenceRefsResolve(evidence)) errors.push(`${decision.decisionId}: unresolved or drifted frozen evidenceRef.`);
      if (decision.canonicalNameEn !== evidence.canonicalNameEn || decision.canonicalNameZh !== evidence.canonicalNameZh || decision.clusterId !== evidence.clusterId) errors.push(`${decision.decisionId}: canonical identity drift from frozen evidence.`);
      const historical = evidence.historicalAdmissibility;
      if (decision.action === 'same_identity') {
        const admissible = historical.kind === 'same_identity' && historical.a2ProposedAction === 'same_identity' && historical.approvedProductionId === decision.productionId && historical.policyCompliantTargets.length === 1 && historical.policyCompliantTargets[0] === decision.productionId && historical.a3ContinuityImpact === 'supported' && historical.oldIndex === historical.freshIndex && historical.baseApiName === decision.communityDragonId && decision.productionRecordCreationRequired === false && Boolean(decision.productionId);
        if (!admissible) errors.push(`${decision.decisionId}: same_identity action is not admissible from frozen decision-time evidence.`);
      } else if (decision.action === 'missing_base_identity') {
        const admissible = historical.kind === 'missing_base_identity' && historical.a3Classification === 'missing_base_identity_candidate' && historical.productionTargetCount === 0 && historical.reviewedMappingTargetCount === 0 && historical.baseApiName === decision.communityDragonId && !/_Upgrade|_Prismatic/.test(decision.communityDragonId) && !historical.upgradeApiNames.includes(decision.communityDragonId) && !historical.prismaticApiNames.includes(decision.communityDragonId) && decision.productionId === undefined && decision.productionRecordCreationRequired === true;
        if (!admissible) errors.push(`${decision.decisionId}: missing_base_identity action is not admissible from frozen decision-time evidence.`);
      } else errors.push(`${decision.decisionId}: unsupported action.`);
    }
    const applied = currentTargets(decision, production.records, mappings.records); errors.push(...applied.errors);
    if (decision.action === 'same_identity' && applied.targets.length === 1 && applied.targets[0] !== decision.productionId) errors.push(`${decision.decisionId}: applied mapping disagrees with approved productionId.`);
    const fulfilled = applied.targets.length === 1 && applied.errors.length === 0 && (decision.action !== 'same_identity' || applied.targets[0] === decision.productionId);
    fulfillment.push({ decisionId: decision.decisionId, status: fulfilled ? 'fulfilled' : 'pending_apply', ...(applied.targets[0] ? { productionId: applied.targets[0] } : {}) });
  }
  for (const evidence of bundle.identities) if (!rows.some((row) => row.communityDragonId === evidence.communityDragonId)) errors.push(`${evidence.communityDragonId}: missing formal disposition.`);
  const sameIdentity = rows.filter((row) => row.action === 'same_identity').length; const missingBaseIdentity = rows.filter((row) => row.action === 'missing_base_identity').length; const fulfilled = fulfillment.filter((row) => row.status === 'fulfilled').length;
  return { errors, fulfillment, totals: { decisions: rows.length, sameIdentity, missingBaseIdentity, pending: fulfillment.length - fulfilled, fulfilled } };
}
