export type Json = Record<string, any>;

export interface DecisionValidationInput {
  decisions: Json;
  proposals: Json;
  reconciliation: Json;
  production: Json;
  mappings: Json;
  evidenceHashes: { identityPacketSha256: string; priorityProposalSha256: string; catalogDeltaSha256: string };
}

export function validateIdentityDecisions(input: DecisionValidationInput): string[] {
  const { decisions: file, proposals, reconciliation, production, mappings, evidenceHashes } = input;
  const errors: string[] = [];
  const rows: Json[] = Array.isArray(file.decisions) ? file.decisions : [];
  if (file.schemaVersion !== 1 || file.patch !== '18.1' || file.reviewMetadata?.reviewStage !== 'C4.2A4' || file.reviewMetadata?.policy !== 'manual_project_review') errors.push('Invalid decision-file metadata.');
  if (JSON.stringify(file.reviewMetadata?.evidenceBindings) !== JSON.stringify(evidenceHashes)) errors.push('identity decisions stale against reviewed evidence');
  if (rows.length !== 8) errors.push(`Expected exactly 8 decisions; found ${rows.length}.`);
  for (const key of ['decisionId', 'communityDragonId']) {
    const values = rows.map((row) => row[key]);
    if (new Set(values).size !== values.length) errors.push(`Duplicate ${key}.`);
  }
  for (const row of rows) {
    if (!/^C4A4-00[1-8]$/.test(row.decisionId ?? '')) errors.push(`${row.decisionId}: invalid stable decision ID.`);
    if (!row.evidenceRefs?.length || !row.reason) errors.push(`${row.decisionId}: evidence and reason are required.`);
    if (row.fieldResolutionStatus !== 'pending_c4.2b') errors.push(`${row.decisionId}: field resolution leaked into the identity layer.`);
  }

  const clone = rows.find((row) => row.decisionId === 'C4A4-001');
  const cloneProposal = proposals.proposals?.find((row: Json) => row.clusterId === 'C4I-001');
  const cloneImpact = reconciliation.c4PriorityImpact?.find((row: Json) => row.clusterId === 'C4I-001');
  const productionIds = new Set((production.records ?? []).map((row: Json) => row.id));
  if (!clone || clone.clusterId !== 'C4I-001' || clone.action !== 'same_identity' || clone.communityDragonId !== 'DA_CloneCompanion18' || clone.productionId !== 'snapshot_139_6fda4e76a4da' || clone.productionRecordCreationRequired !== false || !productionIds.has(clone.productionId) || cloneProposal?.proposedAction !== 'same_identity' || cloneProposal?.proposedProductionId !== clone.productionId || cloneImpact?.impact !== 'supported') errors.push('C4A4-001 is stale or inconsistent with A2/A3/current production.');

  const missingRows = reconciliation.freshOnlyOrChangedRows?.filter((row: Json) => row.classification === 'missing_base_identity_candidate') ?? [];
  const missing = rows.filter((row) => row.action === 'missing_base_identity');
  if (missing.length !== 7) errors.push(`Expected 7 missing-base decisions; found ${missing.length}.`);
  const reviewedIds = new Set((mappings.records ?? []).map((row: Json) => row.communityDragonId));
  for (const delta of missingRows) {
    const matches = missing.filter((row) => row.communityDragonId === delta.baseIdentityKey);
    if (matches.length !== 1) errors.push(`${delta.baseIdentityKey}: expected exactly one formal missing-base decision.`);
    const row = matches[0];
    if (!row) continue;
    if (row.productionId !== undefined || row.productionRecordCreationRequired !== true) errors.push(`${row.decisionId}: missing identity must require creation and omit productionId.`);
    if (delta.communityDragon?.baseApiName !== row.communityDragonId || delta.communityDragon?.upgradeApiNames?.includes(row.communityDragonId)) errors.push(`${row.decisionId}: identity is not the A3 unsuffixed/base client identity.`);
    if (productionIds.has(row.communityDragonId) || delta.productionMatches?.length || reviewedIds.has(row.communityDragonId) || delta.reviewedMappingMatches?.length) errors.push(`${row.decisionId}: missing identity already has a production or reviewed-mapping target.`);
    if (delta.affectsC4Cluster && row.clusterId !== delta.affectsC4Cluster) errors.push(`${row.decisionId}: A2 cluster disposition mismatch.`);
  }
  if (missingRows.length !== 7) errors.push(`A3 missing-base coverage changed from expected 7 to ${missingRows.length}.`);
  for (const proposal of proposals.proposals ?? []) {
    const row = rows.find((item) => item.clusterId === proposal.clusterId);
    const expected = proposal.clusterId === 'C4I-001' ? 'same_identity' : 'missing_base_identity';
    if (!row || row.action !== expected) errors.push(`${proposal.clusterId}: missing or incorrect formal disposition.`);
  }
  const tiger = rows.find((row) => row.decisionId === 'C4A4-007');
  if (!tiger || tiger.communityDragonId !== 'DA_TigersVisit18_Wisp' || tiger.productionId !== undefined || tiger.action !== 'missing_base_identity') errors.push('Tiger family governance violation: base decision must be DA_TigersVisit18_Wisp and must not bind an upgrade.');
  return errors;
}
