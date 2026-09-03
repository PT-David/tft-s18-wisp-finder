import { createHash } from 'node:crypto';
import { validateProductionFieldValue } from '../../validation';

export type Json = any;
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
export const targetKey = (value: Json) => `${value.communityDragonId}:${value.field}`;
export const REQUIRED_TARGETS = new Set([
  'DA_BearsVisit18:category', 'DA_BearsVisit18:requirements',
  'DA_TigersVisit18_Wisp:category', 'DA_TigersVisit18_Wisp:requirements',
  'DA_PottedLifebloom18:cost', 'DA_Snacktime18:cost',
]);

export function validateB3(frozen: Json, amendments: Json, b2FrozenText: string, b2OverlayText: string) {
  const errors: string[] = [];
  if (frozen.frozenFrom.b2FrozenSha256 !== sha256(b2FrozenText)) errors.push('B2 frozen SHA binding mismatch');
  if (frozen.frozenFrom.b2OverlaySha256 !== sha256(b2OverlayText)) errors.push('B2 overlay SHA binding mismatch');
  if (amendments.evidenceBinding.frozenEvidenceSha256 !== frozen.bundleSha256) errors.push('B3 frozen evidence binding mismatch');
  const b2 = JSON.parse(b2OverlayText);
  const b2ByReview = new Map(b2.decisions.map((d: Json) => [d.reviewId, d]));
  const evidenceIds = new Map<string, Json>();
  for (const item of frozen.reviewTargets ?? []) {
    const key = targetKey(item);
    if (!REQUIRED_TARGETS.has(key)) errors.push(`out-of-scope frozen target ${key}`);
    const original: Json = b2ByReview.get(item.b2ReviewId);
    if (!original || original.action !== 'unresolved') errors.push(`${key} was not unresolved in B2`);
    for (const evidence of item.evidence ?? []) {
      if (evidenceIds.has(evidence.evidenceId)) errors.push(`duplicate evidence ${evidence.evidenceId}`);
      evidenceIds.set(evidence.evidenceId, evidence);
      const source = frozen.sourceManifest.sources.find((s: Json) => s.sourceId === evidence.sourceId);
      if (!source) errors.push(`${evidence.evidenceId} has no manifest source`);
    }
  }
  const seen = new Set<string>();
  for (const decision of amendments.amendments ?? []) {
    const key = targetKey(decision);
    if (!REQUIRED_TARGETS.has(key)) errors.push(`orphan amendment ${key}`);
    if (seen.has(key)) errors.push(`duplicate amendment ${key}`); seen.add(key);
    const item = frozen.reviewTargets.find((i: Json) => targetKey(i) === key);
    if (!item || item.b2ReviewId !== decision.b2ReviewId) errors.push(`${key} B2 review binding mismatch`);
    const refs = (decision.evidenceRefs ?? []).map((id: string) => evidenceIds.get(id));
    if (refs.some((e: Json) => !e)) errors.push(`${key} cites evidence outside B3 frozen evidence`);
    if (decision.action === 'approve_explicit_value') {
      if (validateProductionFieldValue(decision.field, decision.approvedValue).length) errors.push(`${key} approved value has invalid production shape`);
      if (!refs.some((e: Json) => JSON.stringify(e?.proposedProductionValue) === JSON.stringify(decision.approvedValue))) errors.push(`${key} evidenceRefs do not support approvedValue`);
    } else if (decision.action !== 'unresolved' || decision.approvedValue !== undefined) errors.push(`${key} has invalid amendment action`);
  }
  for (const key of REQUIRED_TARGETS) if (!seen.has(key)) errors.push(`missing amendment ${key}`);
  for (const source of frozen.sourceManifest.sources ?? []) for (const field of ['sourceId','url','locale','retrievedAt','upstreamModifiedAt','sha256','tier','confidence','useFor']) if (source[field] === undefined) errors.push(`source ${source.sourceId ?? '?'} missing ${field}`);
  return errors;
}

export function composedReadiness(b2Frozen: Json, b2: Json, amendments: Json) {
  const effective = new Map(b2.decisions.map((d: Json) => [d.reviewId, d]));
  for (const amendment of amendments.amendments) effective.set(amendment.b2ReviewId, amendment);
  const required = ['nameZh','nameEn','riotId','category','cost','stageRanges','effects.normal','requirements'];
  return b2Frozen.missingIdentities.map((identity: Json) => {
    const decisions = [...effective.values()].filter((d: Json) => (d.communityDragonId ?? d.identity?.communityDragonId) === identity.communityDragonId);
    const blockers = required.filter(field => !decisions.some((d: Json) => d.field === field && ['approve_proposal','approve_explicit_value','retain_current','confirmed_absent'].includes(d.action)));
    return { ...identity, status: blockers.length ? 'BLOCKED' : 'READY', requiredBlockers: blockers };
  });
}
