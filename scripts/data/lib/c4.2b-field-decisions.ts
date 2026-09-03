import { createHash } from 'node:crypto';
import { productionRecordIdForRiotId, validateProductionFieldValue } from '../../validation';

export type Json = Record<string, any>;
export const stableJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export const REQUIRED_NEW_FIELDS = ['riotId', 'nameEn', 'nameZh', 'category', 'cost', 'stageRanges', 'effects.normal', 'requirements'] as const;
export const OPTIONAL_FIELDS = ['effects.blossom', 'effects.prismatic', 'oncePerGame', 'reofferCooldownShops', 'minimumAffordableGold'] as const;
const KNOWLEDGE_FIELDS = new Set(['oncePerGame', 'reofferCooldownShops']);
const NEW_RECORD_FIELDS = new Set(['id', 'riotId', 'nameEn', 'nameZh', 'category', 'cost', 'minimumAffordableGold', 'stageRanges', 'effects', 'requirements', 'oncePerGame', 'reofferCooldownShops', 'searchConcepts', 'synonyms', 'sources', 'patch']);
const SOURCE_FIELDS = ['id', 'riotId', 'nameEn', 'nameZh', 'category', 'cost', 'stageRanges', 'effects', 'requirements', 'oncePerGame', 'reofferCooldownShops', 'patch'] as const;

export function approvedValue(decision: Json, item: Json) {
  return decision.action === 'approve_proposal' ? item.proposedProductionValue : decision.approvedValue;
}

function getField(record: Json, path: string) {
  return path.split('.').reduce((value, key) => value?.[key], record);
}

function sourceField(path: string) {
  return path.startsWith('effects.') ? 'effects' : path;
}

function supportingEvidence(evidence: Json, value: unknown) {
  return same(evidence.proposedProductionValue, value)
    || same(evidence.comparisonValue, value)
    || same(evidence.normalizedInterpretation, value);
}

function citedEvidence(item: Json, decision: Json) {
  const cited = new Set(decision.evidenceRefs ?? []);
  return (item.evidence ?? []).filter((evidence: Json) => cited.has(evidence.evidenceId));
}

const fieldUses: Record<string, string[]> = {
  riotId: ['riotId', 'identity_review', 'identity_cross_check'],
  nameEn: ['nameEn', 'display_name_cross_check', 'identity_review', 'identity_cross_check'],
  nameZh: ['nameZh', 'display_name_cross_check', 'identity_review'],
  category: ['category', 'field_conflict_detection'],
  cost: ['cost', 'cost_cross_check', 'field_conflict_detection'],
  stageRanges: ['stageRanges', 'stageRanges_cross_check', 'field_conflict_detection'],
  requirements: ['requirements', 'requirements_cross_check', 'field_conflict_detection'],
  'effects.normal': ['effectsZh', 'effect_cross_check', 'field_conflict_detection'],
  'effects.blossom': ['effectsZh', 'blossom_cross_check', 'effect_cross_check', 'field_conflict_detection'],
  'effects.prismatic': ['effectsZh', 'prismatic_cross_check', 'effect_cross_check', 'field_conflict_detection'],
};
const localizedFields = new Set(['riotId', 'nameEn', 'nameZh', 'effects.normal', 'effects.blossom', 'effects.prismatic']);
const tierRank: Record<string, Record<string, number>> = {
  localized: { A: 0, B: 1, C: 2, D: 3, E: 4 },
  structured: { A: 0, C: 1, B: 2, D: 3, E: 4 },
};

function localeAdmissible(field: string, evidence: Json) {
  if (field === 'nameEn') return ['en', 'en_us'].includes(evidence.valueLocale);
  if (field === 'nameZh') return evidence.valueLocale === 'zh_cn';
  if (field.startsWith('effects.')) return ['en', 'en_us', 'zh_cn'].includes(evidence.valueLocale);
  return true;
}

function fieldApplicable(field: string, evidence: Json) {
  return (fieldUses[field] ?? []).some((use) => (evidence.useFor ?? []).includes(use)) && localeAdmissible(field, evidence);
}

export function deriveDecisionProvenance(item: Json, decision: Json): Json | undefined {
  const value = approvedValue(decision, item);
  const supporting = citedEvidence(item, decision).filter((evidence: Json) => supportingEvidence(evidence, value) && fieldApplicable(item.field, evidence));
  const rank = tierRank[localizedFields.has(item.field) ? 'localized' : 'structured']!;
  const candidates = supporting.filter((evidence: Json) => evidence.sourceId && evidence.retrievedAt && evidence.confidence)
    .sort((left: Json, right: Json) => (rank[left.tier] ?? 99) - (rank[right.tier] ?? 99)
      || Number(left.sourceLocaleCoverage === 'multi') - Number(right.sourceLocaleCoverage === 'multi')
      || left.sourceId.localeCompare(right.sourceId, 'en'));
  if (!candidates.length) return undefined;
  const selected = candidates[0]!;
  return { sourceId: selected.sourceId, verifiedAt: selected.retrievedAt, confidence: selected.confidence };
}

function approvedDecisionForField(units: Json[], decisions: Map<string, Json>, field: string): { unit: Json; decision: Json } | undefined {
  const matches = units.filter((unit) => unit.field === field).map((unit) => ({ unit, decision: decisions.get(unit.reviewId) }))
    .filter(({ decision }) => decision && ['approve_proposal', 'approve_explicit_value'].includes(decision.action));
  return matches.length === 1 ? matches[0] as { unit: Json; decision: Json } : undefined;
}

export function readiness(frozen: Json, overlay: Json) {
  const decisions = new Map<string, Json>(overlay.decisions.map((decision: Json) => [decision.reviewId, decision]));
  return frozen.missingIdentities.map((identity: Json) => {
    const units = frozen.reviewItems.filter((item: Json) => item.identity.communityDragonId === identity.communityDragonId);
    const blockers: string[] = [];
    for (const field of REQUIRED_NEW_FIELDS) {
      const selected = approvedDecisionForField(units, decisions, field);
      if (!selected || validateProductionFieldValue(field, approvedValue(selected.decision, selected.unit), { required: true }).length) blockers.push(field);
    }
    const optionalUnknown = units.filter((item: Json) => OPTIONAL_FIELDS.includes(item.field) && ['accepted_unknown', 'unresolved'].includes(decisions.get(item.reviewId)?.action)).map((item: Json) => item.field);
    return { ...identity, status: blockers.length ? 'BLOCKED' : 'READY', requiredApproved: REQUIRED_NEW_FIELDS.filter((field) => !blockers.includes(field)), requiredBlockers: blockers, optionalUnknown: [...new Set(optionalUnknown)] };
  });
}

export function validateDecisions(frozen: Json, overlay: Json, currentProduction?: Json) {
  const errors: string[] = [];
  if (frozen.schemaVersion !== 1 || frozen.patch !== '18.1' || frozen.reviewStage !== 'C4.2B2') errors.push('invalid frozen evidence envelope');
  if (overlay.schemaVersion !== 1 || overlay.patch !== frozen.patch || overlay.reviewStage !== 'C4.2B2') errors.push('invalid decision overlay envelope');
  const calculatedFrozenSha = sha256(stableJson({ ...frozen, bundleSha256: undefined }));
  if (overlay.evidenceBinding?.frozenEvidenceSha256 !== frozen.bundleSha256) errors.push('manual decisions do not bind frozen evidence SHA');
  if (frozen.bundleSha256 !== calculatedFrozenSha) errors.push('frozen evidence self fingerprint mismatch');
  const patchSource = overlay.provenancePolicy?.patchSource;
  const sourceCatalog = new Map<string, Json>((overlay.provenancePolicy?.decisionTimeSources ?? []).map((entry: Json) => [entry.source.sourceId, entry]));
  if (overlay.provenancePolicy?.sourceManifestSha256 !== frozen.frozenFrom.sourceManifestSha256) errors.push('provenance policy is not bound to decision-time source manifest');
  if (!patchSource || patchSource.sourceId !== 'riot_patch_18_1_20260828' || patchSource.tier !== 'A' || patchSource.confidence !== 'official' || !(patchSource.useFor ?? []).includes('patch_status')) errors.push('invalid official patch provenance policy');
  else if (overlay.provenancePolicy.patchSourceEntrySha256 !== sha256(stableJson(patchSource))) errors.push('patch provenance entry fingerprint mismatch');
  for (const entry of sourceCatalog.values()) if (entry.entrySha256 !== sha256(stableJson(entry.source))) errors.push(`decision-time source fingerprint mismatch ${entry.source.sourceId}`);
  const units = new Map<string, Json>(frozen.reviewItems.map((item: Json) => [item.reviewId, item]));
  const seen = new Set<string>();
  for (const decision of overlay.decisions ?? []) {
    if (seen.has(decision.reviewId)) { errors.push(`duplicate decision ${decision.reviewId}`); continue; }
    seen.add(decision.reviewId);
    const item = units.get(decision.reviewId);
    if (!item) { errors.push(`orphan decision ${decision.reviewId}`); continue; }
    if (decision.field !== item.field || decision.propositionKey !== item.propositionKey || decision.identity.communityDragonId !== item.identity.communityDragonId || decision.identity.productionId !== item.identity.productionId) errors.push(`${decision.reviewId}: decision target drift`);
    const availableRefs = new Set((item.evidence ?? []).map((evidence: Json) => evidence.evidenceId));
    for (const ref of decision.evidenceRefs ?? []) if (!availableRefs.has(ref)) errors.push(`${decision.reviewId}: unbound evidence ref ${ref}`);
    if (decision.action === 'approve_proposal' && (item.reviewClass !== 'decision_ready' || item.productionCandidateValues?.length !== 1 || !same(decision.approvedValue, item.proposedProductionValue))) errors.push(`${decision.reviewId}: inadmissible approve_proposal`);
    if (decision.action === 'approve_explicit_value' && !(item.productionCandidateValues ?? []).some((value: unknown) => same(value, decision.approvedValue))) errors.push(`${decision.reviewId}: explicit value is not frozen evidence-derived`);
    if (decision.action === 'retain_current' && !item.identity.productionId) errors.push(`${decision.reviewId}: retain_current requires existing identity`);
    if (decision.action === 'accepted_unknown' && decision.approvedValue !== undefined) errors.push(`${decision.reviewId}: unknown was materialized in manual truth`);
    if (decision.action === 'confirmed_absent' && !(item.evidence ?? []).some((evidence: Json) => evidence.observationState === 'explicit_absence')) errors.push(`${decision.reviewId}: absence lacks positive evidence`);
    if (['approve_proposal', 'approve_explicit_value'].includes(decision.action)) {
      const value = approvedValue(decision, item);
      if (!(decision.evidenceRefs?.length > 0)) errors.push(`${decision.reviewId}: approval must cite evidence`);
      if (!citedEvidence(item, decision).some((evidence: Json) => supportingEvidence(evidence, value))) errors.push(`${decision.reviewId}: cited evidence does not support approved value`);
      errors.push(...validateProductionFieldValue(item.field, value).map((error) => `${decision.reviewId}: ${error}`));
      if (!deriveDecisionProvenance(item, decision)) errors.push(`${decision.reviewId}: approved value lacks deterministic provenance`);
      for (const evidence of citedEvidence(item, decision).filter((candidate: Json) => supportingEvidence(candidate, value))) {
        const catalog = sourceCatalog.get(evidence.sourceId)?.source;
        if (!catalog) errors.push(`${decision.reviewId}: source absent from decision-time manifest lineage ${evidence.sourceId}`);
        else if (catalog.tier !== evidence.tier || catalog.confidence !== evidence.confidence || !same(catalog.useFor, evidence.useFor) || !same(catalog.locale, evidence.sourceLocaleCoverage)) errors.push(`${decision.reviewId}: frozen evidence metadata drifts from decision-time source ${evidence.sourceId}`);
      }
      if (decision.applyPolicy !== 'apply') errors.push(`${decision.reviewId}: approval must apply`);
      for (const proposition of decision.adjudicatedPropositions ?? []) {
        if (!proposition.evidenceRefs?.length) errors.push(`${decision.reviewId}: adjudicated proposition must cite evidence`);
        const propositionRefs = new Set(proposition.evidenceRefs ?? []);
        const propositionEvidence = (item.evidence ?? []).filter((evidence: Json) => propositionRefs.has(evidence.evidenceId));
        if (propositionEvidence.length !== propositionRefs.size || !propositionEvidence.every((evidence: Json) => supportingEvidence(evidence, proposition.approvedValue))) errors.push(`${decision.reviewId}: adjudicated proposition evidence does not support approved value`);
      }
    }
    if (['accepted_unknown', 'unresolved'].includes(decision.action) && !['defer', 'no_change'].includes(decision.applyPolicy)) errors.push(`${decision.reviewId}: non-truth disposition cannot apply`);
  }
  for (const reviewId of units.keys()) if (!seen.has(reviewId)) errors.push(`missing decision ${reviewId}`);
  if (currentProduction) errors.push(...validateFulfillment(frozen, overlay, currentProduction));
  return errors;
}

function expectedUnknown(field: string) {
  return KNOWLEDGE_FIELDS.has(field) ? { status: 'unknown' } : undefined;
}

function knowledgeGovernanceProvenance(frozen: Json, decision: Json) {
  return { provenanceKind: 'review_governance', reviewStage: 'C4.2B2', decisionId: decision.decisionId, disposition: 'accepted_unknown', frozenEvidenceSha256: frozen.bundleSha256 };
}

export function buildNewRecordPlan(frozen: Json, overlay: Json, communityDragonId: string): Json | undefined {
  const gate = readiness(frozen, overlay).find((entry: Json) => entry.communityDragonId === communityDragonId);
  if (!gate || gate.status !== 'READY') return undefined;
  const decisions = new Map<string, Json>(overlay.decisions.map((decision: Json) => [decision.reviewId, decision]));
  const units = frozen.reviewItems.filter((item: Json) => item.identity.communityDragonId === communityDragonId);
  const selected = new Map<string, { unit: Json; decision: Json }>();
  for (const field of REQUIRED_NEW_FIELDS) selected.set(field, approvedDecisionForField(units, decisions, field)!);
  const record: Json = { id: productionRecordIdForRiotId(communityDragonId), effects: {}, searchConcepts: [], synonyms: [], patch: frozen.patch };
  for (const [field, pair] of selected) {
    const parts = field.split('.');
    if (parts.length === 1) record[field] = approvedValue(pair.decision, pair.unit); else record[parts[0]!]![parts[1]!] = approvedValue(pair.decision, pair.unit);
  }
  for (const field of OPTIONAL_FIELDS) {
    const unit = units.find((candidate: Json) => candidate.field === field);
    const decision = unit && decisions.get(unit.reviewId);
    if (decision?.action === 'accepted_unknown' && KNOWLEDGE_FIELDS.has(field)) record[field] = expectedUnknown(field);
    else if (decision && ['approve_proposal', 'approve_explicit_value', 'confirmed_absent'].includes(decision.action)) {
      const parts = field.split('.'); const value = decision.action === 'confirmed_absent' ? null : approvedValue(decision, unit);
      if (parts.length === 1) record[field] = value; else record[parts[0]!]![parts[1]!] = value;
    }
  }
  const sources: Json = {};
  for (const field of SOURCE_FIELDS) {
    if (field === 'id') sources.id = deriveDecisionProvenance(selected.get('riotId')!.unit, selected.get('riotId')!.decision);
    else if (field === 'patch') {
      const { sourceId, retrievedAt: verifiedAt, confidence } = overlay.provenancePolicy.patchSource;
      sources.patch = { sourceId, verifiedAt, confidence };
    } else if (KNOWLEDGE_FIELDS.has(field)) {
      const unit = units.find((candidate: Json) => candidate.field === field)!;
      sources[field] = knowledgeGovernanceProvenance(frozen, decisions.get(unit.reviewId)!);
    } else {
      const pairField = field === 'effects' ? 'effects.normal' : field;
      const pair = selected.get(pairField)!;
      sources[field] = deriveDecisionProvenance(pair.unit, pair.decision);
    }
  }
  if (record.minimumAffordableGold !== undefined) {
    const unit = units.find((candidate: Json) => candidate.field === 'minimumAffordableGold')!;
    sources.minimumAffordableGold = deriveDecisionProvenance(unit, decisions.get(unit.reviewId)!);
  }
  record.sources = sources;
  return record;
}

function leafPaths(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.keys(value as Json).flatMap((key) => leafPaths((value as Json)[key], prefix ? `${prefix}.${key}` : key));
}

export function validateFulfillment(frozen: Json, overlay: Json, current: Json) {
  const errors: string[] = [];
  const baseline = frozen.productionBaseline.records as Json[];
  const now = current.records as Json[];
  const oldById = new Map<string, Json>(baseline.map((record) => [record.id, record]));
  const newById = new Map<string, Json>(now.map((record) => [record.id, record]));
  const unitByReview = new Map<string, Json>(frozen.reviewItems.map((item: Json) => [item.reviewId, item]));
  const decisions = overlay.decisions as Json[];
  const approvedExisting = new Map<string, { decision: Json; item: Json }>();
  for (const decision of decisions.filter((candidate) => candidate.identity.productionId && candidate.action.startsWith('approve_'))) {
    const key = `${decision.identity.productionId}|${decision.field}`;
    if (approvedExisting.has(key)) errors.push(`duplicate approved target ${key}`);
    approvedExisting.set(key, { decision, item: unitByReview.get(decision.reviewId)! });
  }
  for (const [id, oldRecord] of oldById) {
    const currentRecord = newById.get(id);
    if (!currentRecord) { errors.push(`unapproved deleted record ${id}`); continue; }
    const paths = new Set([...leafPaths(oldRecord), ...leafPaths(currentRecord)].filter((path) => path && !path.startsWith('sources.')));
    for (const path of paths) {
      const target = approvedExisting.get(`${id}|${path}`);
      const oldValue = getField(oldRecord, path), currentValue = getField(currentRecord, path);
      if (!same(oldValue, currentValue) && !target) errors.push(`unapproved unrelated mutation ${id}.${path}`);
      if (target && !same(currentValue, oldValue) && !same(currentValue, approvedValue(target.decision, target.item))) errors.push(`wrong approved value ${id}.${path}`);
    }
    const sourcePaths = new Set([...Object.keys(oldRecord.sources ?? {}), ...Object.keys(currentRecord.sources ?? {})]);
    for (const source of sourcePaths) {
      const relevant = [...approvedExisting.entries()].filter(([key]) => key.startsWith(`${id}|`) && sourceField(key.split('|')[1]!) === source);
      const oldValue = oldRecord.sources?.[source], currentValue = currentRecord.sources?.[source];
      const changedTruth = relevant.some(([key]) => !same(getField(oldRecord, key.split('|')[1]!), getField(currentRecord, key.split('|')[1]!)));
      if (!changedTruth && !same(oldValue, currentValue)) errors.push(`unapproved provenance mutation ${id}.sources.${source}`);
      if (changedTruth && (relevant.length !== 1 || !same(currentValue, deriveDecisionProvenance(relevant[0]![1].item, relevant[0]![1].decision)))) errors.push(`wrong approved provenance ${id}.sources.${source}`);
    }
  }
  const seenRiotIds = new Set<string>();
  for (const record of now.filter((candidate) => !oldById.has(candidate.id))) {
    if (seenRiotIds.has(record.riotId)) errors.push(`duplicate new identity ${record.riotId}`);
    seenRiotIds.add(record.riotId);
    const plan = buildNewRecordPlan(frozen, overlay, record.riotId);
    if (!plan) { errors.push(`blocked or unapproved new identity ${record.riotId}`); continue; }
    for (const field of Object.keys(record)) if (!NEW_RECORD_FIELDS.has(field)) errors.push(`new identity ${record.riotId}: unknown field ${field}`);
    if (!same(record, plan)) errors.push(`new identity ${record.riotId}: record does not exact-match approved truth, scaffolding, unknown materialization, and provenance plan`);
  }
  for (const decision of decisions.filter((candidate) => ['unresolved', 'accepted_unknown'].includes(candidate.action) && candidate.identity.productionId)) {
    const oldRecord = oldById.get(decision.identity.productionId), currentRecord = newById.get(decision.identity.productionId);
    if (oldRecord && currentRecord && !same(getField(oldRecord, decision.field), getField(currentRecord, decision.field))) errors.push(`${decision.action} field modified ${decision.identity.productionId}.${decision.field}`);
  }
  return errors;
}
