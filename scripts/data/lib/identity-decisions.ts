export type IdentityDecisionAction = 'same_identity' | 'missing_base_identity';
export type DecisionFulfillmentStatus = 'pending_apply' | 'fulfilled';

export interface EvidenceBindings { identityPacketSha256: string; priorityProposalSha256: string; catalogDeltaSha256: string }
export interface DecisionBaseline { productionSha256: string; productionRecordCount: number; reviewedMappingsSha256: string; releaseReadinessSha256: string; recommendedProductionReady: boolean }
export interface IdentityDecision {
  decisionId: string; clusterId?: string; communityDragonId: string; canonicalNameEn: string; canonicalNameZh: string;
  action: IdentityDecisionAction; productionId?: string; productionRecordCreationRequired: boolean;
  evidenceRefs: string[]; reason: string; fieldResolutionStatus: 'pending_c4.2b';
}
export interface IdentityDecisionFile {
  schemaVersion: number; patch: string;
  reviewMetadata: { reviewStage: string; reviewedAt: string; evidenceBindings: EvidenceBindings; decisionBaseline: DecisionBaseline; policy: string };
  decisions: IdentityDecision[];
}
interface Proposal { clusterId: string; sourceIdentity: string; proposedAction: string; proposedProductionId?: string; confirmingEvidence: Array<{ productionId?: string; selector?: string }>; productionSearch: { policyCompliantTargets: string[] } }
interface PriorityProposals { proposals: Proposal[]; artifactBoundary: { productionSha256: string } }
interface ClientDisplay { apiName: string; nameEn: string; nameZh: string }
interface DeltaRow { freshIndex: number; nameEn: string; nameZh: string; classification: string; baseIdentityKey?: string; affectsC4Cluster?: string; productionMatches?: string[]; reviewedMappingMatches?: string[]; communityDragon?: { baseApiName: string; upgradeApiNames: string[]; prismaticApiNames: string[]; relatedDisplayNames: ClientDisplay[] } }
interface Reconciliation { freshOnlyOrChangedRows: DeltaRow[]; c4PriorityImpact: Array<{ clusterId: string; impact: string }>; rowMappings: Array<{ oldIndex?: number; freshIndex?: number; status: string }>; artifactBoundary: { before: Record<string, string> }; baseline: { productionRecords: number } }
interface ProductionRecord { id: string; riotId?: string | null }
interface MappingRecord { communityDragonId: string; productionId: string }
interface EvidenceSources {
  a1ClusterIds: string[]; oldDataTftRows: number[];
  freshDataTftRecords: Array<{ sourceIndex: number; nameEn: string; nameZh: string }>;
  communityDragonDisplays: ClientDisplay[]; hasBearTigerFocusedEvidence: boolean;
}
export interface DecisionValidationInput {
  decisions: IdentityDecisionFile; proposals: PriorityProposals; reconciliation: Reconciliation;
  production: { records: ProductionRecord[] }; mappings: { records: MappingRecord[] };
  evidenceHashes: EvidenceBindings; evidenceSources: EvidenceSources;
  currentState: { productionSha256: string; reviewedMappingsSha256: string; releaseReadinessSha256: string; recommendedProductionReady: boolean };
}
export interface DecisionFulfillment { decisionId: string; status: DecisionFulfillmentStatus; productionId?: string }
export interface DecisionValidationResult { errors: string[]; fulfillment: DecisionFulfillment[]; totals: { decisions: number; sameIdentity: number; missingBaseIdentity: number; pending: number; fulfilled: number } }

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const isSha = (value: string) => /^[a-f0-9]{64}$/.test(value);

function resolveEvidenceRef(ref: string, input: DecisionValidationInput): boolean {
  let match = /^A1:(C4I-\d{3})$/.exec(ref); if (match) return input.evidenceSources.a1ClusterIds.includes(match[1]!);
  match = /^A2:(C4I-\d{3})$/.exec(ref); if (match) return input.proposals.proposals.some((row) => row.clusterId === match![1]);
  match = /^A3:(C4I-\d{3})$/.exec(ref); if (match) return input.reconciliation.c4PriorityImpact.some((row) => row.clusterId === match![1]);
  match = /^A3:freshIndex-(\d+)$/.exec(ref); if (match) return input.reconciliation.freshOnlyOrChangedRows.some((row) => row.freshIndex === Number(match![1]));
  match = /^DataTFT:old-row-(\d+)$/.exec(ref); if (match) return input.evidenceSources.oldDataTftRows.includes(Number(match[1]));
  match = /^DataTFT:fresh-row-(\d+)$/.exec(ref); if (match) return input.evidenceSources.freshDataTftRecords.some((row) => row.sourceIndex === Number(match![1]));
  match = /^CommunityDragon:(DA_[A-Za-z0-9_]+)$/.exec(ref); if (match) return input.evidenceSources.communityDragonDisplays.some((row) => row.apiName === match![1]);
  return ref === 'CommunityDragon:bear-tiger-focused-evidence' && input.evidenceSources.hasBearTigerFocusedEvidence;
}

function currentTargets(decision: IdentityDecision, production: ProductionRecord[], mappings: MappingRecord[]): { targets: string[]; errors: string[] } {
  const errors: string[] = [];
  const direct = production.filter((row) => row.riotId === decision.communityDragonId).map((row) => row.id);
  const mapped = mappings.filter((row) => row.communityDragonId === decision.communityDragonId).map((row) => row.productionId);
  const targets = [...new Set([...direct, ...mapped])];
  for (const target of mapped) {
    const record = production.find((row) => row.id === target);
    if (!record) errors.push(`${decision.decisionId}: reviewed mapping points to missing production target ${target}.`);
    else if (record.riotId && record.riotId !== decision.communityDragonId) errors.push(`${decision.decisionId}: reviewed mapping target has the wrong client identity.`);
  }
  if (targets.length > 1 || direct.length > 1 || mapped.length > 1) errors.push(`${decision.decisionId}: ambiguous or duplicate apply targets.`);
  return { targets, errors };
}

export function validateIdentityDecisions(input: DecisionValidationInput): DecisionValidationResult {
  const { decisions: file, proposals, reconciliation, production, mappings, evidenceHashes } = input;
  const errors: string[] = []; const fulfillment: DecisionFulfillment[] = [];
  const rows = file.decisions;
  if (file.schemaVersion !== 1 || file.patch !== '18.1' || file.reviewMetadata.reviewStage !== 'C4.2A4' || file.reviewMetadata.policy !== 'manual_project_review') errors.push('Invalid decision-file metadata.');
  if (!equal(file.reviewMetadata.evidenceBindings, evidenceHashes)) errors.push('identity decisions stale against reviewed evidence');
  const baseline = file.reviewMetadata.decisionBaseline;
  if (!baseline || !isSha(baseline.productionSha256) || !isSha(baseline.reviewedMappingsSha256) || !isSha(baseline.releaseReadinessSha256) || baseline.productionSha256 !== proposals.artifactBoundary.productionSha256 || baseline.productionSha256 !== reconciliation.artifactBoundary.before['data/normalized/wisps_18.1.json'] || baseline.productionRecordCount !== reconciliation.baseline.productionRecords || baseline.recommendedProductionReady !== false) errors.push('Decision baseline is stale or inconsistent with reviewed evidence.');
  const hasAppliedTarget = rows.some((decision) => currentTargets(decision, production.records, mappings.records).targets.length > 0);
  if (!hasAppliedTarget && (!equal(input.currentState, { productionSha256: baseline.productionSha256, reviewedMappingsSha256: baseline.reviewedMappingsSha256, releaseReadinessSha256: baseline.releaseReadinessSha256, recommendedProductionReady: baseline.recommendedProductionReady }) || production.records.length !== baseline.productionRecordCount)) errors.push('Current pre-apply state does not match the recorded decision baseline.');
  for (const key of ['decisionId', 'communityDragonId'] as const) if (new Set(rows.map((row) => row[key])).size !== rows.length) errors.push(`Duplicate ${key}.`);

  for (const decision of rows) {
    if (!/^C4A4-\d{3}$/.test(decision.decisionId)) errors.push(`${decision.decisionId}: invalid stable decision ID.`);
    if (!decision.evidenceRefs.length || !decision.reason) errors.push(`${decision.decisionId}: evidence and reason are required.`);
    for (const ref of decision.evidenceRefs) if (!resolveEvidenceRef(ref, input)) errors.push(`${decision.decisionId}: unresolved evidenceRef ${ref}.`);
    if (decision.fieldResolutionStatus !== 'pending_c4.2b') errors.push(`${decision.decisionId}: field resolution leaked into the identity layer.`);
    const applied = currentTargets(decision, production.records, mappings.records); errors.push(...applied.errors);

    if (decision.action === 'same_identity') {
      const proposal = proposals.proposals.find((row) => row.clusterId === decision.clusterId);
      const impact = reconciliation.c4PriorityImpact.find((row) => row.clusterId === decision.clusterId);
      const continuityEvidence = proposal?.confirmingEvidence.find((row) => row.productionId === decision.productionId);
      const sourceIndex = /sourceIndex=(\d+)/.exec(continuityEvidence?.selector ?? '')?.[1];
      const freshIndex = sourceIndex === undefined ? undefined : reconciliation.rowMappings.find((row) => row.status === 'unchanged' && row.oldIndex === row.freshIndex && row.oldIndex === Number(sourceIndex) && input.evidenceSources.oldDataTftRows.includes(row.oldIndex))?.freshIndex;
      const freshDisplay = input.evidenceSources.freshDataTftRecords.find((row) => row.sourceIndex === freshIndex);
      const clientDisplay = input.evidenceSources.communityDragonDisplays.find((row) => row.apiName === decision.communityDragonId);
      const clientMatchesProposal = clientDisplay && proposal && decision.communityDragonId === `DA_${proposal.sourceIdentity}18`;
      const freshNameEvidence = freshDisplay?.nameEn === decision.canonicalNameEn && freshDisplay.nameZh === decision.canonicalNameZh;
      const sameChecks: Array<[boolean, string]> = [
        [Boolean(decision.productionId), 'productionId is required'], [decision.productionRecordCreationRequired === false, 'record creation must be false'],
        [proposal?.proposedAction === 'same_identity', 'A2 does not support same_identity'], [proposal?.proposedProductionId === decision.productionId, 'A2 target mismatch'],
        [proposal?.productionSearch.policyCompliantTargets.length === 1, 'policy-compliant target is not unique'], [proposal?.productionSearch.policyCompliantTargets[0] === decision.productionId, 'unique target mismatch'],
        [impact?.impact === 'supported', 'A3 continuity is not supported'], [Boolean(clientMatchesProposal), 'client identity mismatch'], [freshNameEvidence, 'canonical name drift'],
        [production.records.some((row) => row.id === decision.productionId), 'approved production target is absent']
      ];
      for (const [valid, reason] of sameChecks) if (!valid) errors.push(`${decision.decisionId}: same_identity action is not admissible: ${reason}.`);
      if (applied.targets.length === 1 && applied.targets[0] !== decision.productionId) errors.push(`${decision.decisionId}: applied mapping disagrees with approved productionId.`);
      fulfillment.push({ decisionId: decision.decisionId, status: applied.targets[0] === decision.productionId ? 'fulfilled' : 'pending_apply', ...(applied.targets[0] ? { productionId: applied.targets[0] } : {}) });
    } else if (decision.action === 'missing_base_identity') {
      const delta = reconciliation.freshOnlyOrChangedRows.find((row) => row.baseIdentityKey === decision.communityDragonId);
      const display = delta?.communityDragon?.relatedDisplayNames.find((row) => row.apiName === decision.communityDragonId);
      const baseAllowed = delta?.classification === 'missing_base_identity_candidate' && delta.communityDragon?.baseApiName === decision.communityDragonId && !/_Upgrade|_Prismatic/.test(decision.communityDragonId) && !delta.communityDragon.upgradeApiNames.includes(decision.communityDragonId) && !delta.communityDragon.prismaticApiNames.includes(decision.communityDragonId);
      if (!baseAllowed || !display || display.nameEn !== decision.canonicalNameEn || display.nameZh !== decision.canonicalNameZh || decision.productionId !== undefined || decision.productionRecordCreationRequired !== true) errors.push(`${decision.decisionId}: missing_base_identity action is not admissible from A3 base-client evidence.`);
      fulfillment.push({ decisionId: decision.decisionId, status: applied.targets.length === 1 && applied.errors.length === 0 ? 'fulfilled' : 'pending_apply', ...(applied.targets[0] ? { productionId: applied.targets[0] } : {}) });
    } else errors.push(`${decision.decisionId}: unsupported action.`);
  }

  for (const proposal of proposals.proposals) if (!rows.some((row) => row.clusterId === proposal.clusterId)) errors.push(`${proposal.clusterId}: missing formal disposition.`);
  for (const delta of reconciliation.freshOnlyOrChangedRows.filter((row) => row.classification === 'missing_base_identity_candidate')) if (!rows.some((row) => row.communityDragonId === delta.baseIdentityKey)) errors.push(`${delta.baseIdentityKey}: missing formal disposition.`);
  const sameIdentity = rows.filter((row) => row.action === 'same_identity').length; const missingBaseIdentity = rows.filter((row) => row.action === 'missing_base_identity').length;
  const fulfilled = fulfillment.filter((row) => row.status === 'fulfilled').length;
  return { errors, fulfillment, totals: { decisions: rows.length, sameIdentity, missingBaseIdentity, pending: fulfillment.length - fulfilled, fulfilled } };
}
