import { createHash } from 'node:crypto';
import { validateProductionFieldValue } from '../../validation';

export type Json = any;
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
export const stableSerialize = (value: Json): string => {
  const sort = (entry: Json): Json => Array.isArray(entry) ? entry.map(sort) : entry && typeof entry === 'object'
    ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, sort(entry[key])])) : entry;
  return `${JSON.stringify(sort(value), null, 2)}\n`;
};
export const frozenBundleSha256 = (frozen: Json) => {
  const content = structuredClone(frozen); delete content.bundleSha256;
  return sha256(stableSerialize(content));
};
export const targetKey = (value: Json) => `${value.communityDragonId}:${value.field}`;
export const REQUIRED_TARGETS = new Set([
  'DA_BearsVisit18:category', 'DA_BearsVisit18:requirements',
  'DA_TigersVisit18_Wisp:category', 'DA_TigersVisit18_Wisp:requirements',
  'DA_PottedLifebloom18:cost', 'DA_Snacktime18:cost',
]);
const same = (a: Json, b: Json) => stableSerialize(a) === stableSerialize(b);

export function validateB3(frozen: Json, amendments: Json, b2FrozenText: string, b2OverlayText: string) {
  const errors: string[] = [], b2Frozen=JSON.parse(b2FrozenText), b2=JSON.parse(b2OverlayText);
  if (frozenBundleSha256(frozen) !== frozen.bundleSha256) errors.push('B3 frozen bundle SHA mismatch');
  if (frozen.frozenFrom.b2FrozenSha256 !== sha256(b2FrozenText)) errors.push('B2 frozen SHA binding mismatch');
  if (frozen.frozenFrom.b2OverlaySha256 !== sha256(b2OverlayText)) errors.push('B2 overlay SHA binding mismatch');
  if (frozen.sourceCatalogBinding?.b2DecisionTimeSourceManifestSha256 !== sha256(stableSerialize(b2Frozen.decisionTimeSourceManifest))) errors.push('B2 source catalog binding mismatch');
  if (amendments.evidenceBinding.frozenEvidenceSha256 !== frozen.bundleSha256) errors.push('B3 frozen evidence binding mismatch');
  const b2ByReview = new Map(b2.decisions.map((d: Json) => [d.reviewId, d])), evidenceIds = new Map<string, Json>();
  for (const item of frozen.reviewTargets ?? []) {
    const key=targetKey(item), originalDecision:Json=b2ByReview.get(item.b2ReviewId), originalItem=b2Frozen.reviewItems.find((i:Json)=>i.reviewId===item.b2ReviewId);
    if (!REQUIRED_TARGETS.has(key)) errors.push(`out-of-scope frozen target ${key}`);
    if (!originalDecision || originalDecision.action !== 'unresolved') errors.push(`${key} was not unresolved in B2`);
    if (!originalItem || targetKey({...originalItem.identity,field:originalItem.field}) !== key) errors.push(`${key} does not match its B2 review target`);
    for (const evidence of item.evidence ?? []) {
      if (evidenceIds.has(evidence.evidenceId)) errors.push(`duplicate evidence ${evidence.evidenceId}`); evidenceIds.set(evidence.evidenceId,evidence);
      const origin=originalItem?.evidence?.find((e:Json)=>e.evidenceId===evidence.originB2EvidenceId);
      if (!origin) errors.push(`${evidence.evidenceId} has no B2 evidence origin`);
      else { const projected=structuredClone(evidence); projected.evidenceId=projected.originB2EvidenceId; delete projected.originB2EvidenceId; if (!same(projected,origin)) errors.push(`${evidence.evidenceId} drifted from B2 evidence`); }
      if (!b2Frozen.decisionTimeSourceManifest.sources.some((s:Json)=>s.sourceId===evidence.sourceId)) errors.push(`${evidence.evidenceId} source is outside B2 frozen catalog`);
    }
  }
  const seen=new Set<string>();
  for (const decision of amendments.amendments ?? []) {
    const key=targetKey(decision); if(!REQUIRED_TARGETS.has(key))errors.push(`orphan amendment ${key}`); if(seen.has(key))errors.push(`duplicate amendment ${key}`);seen.add(key);
    const item=frozen.reviewTargets.find((i:Json)=>targetKey(i)===key);if(!item||item.b2ReviewId!==decision.b2ReviewId)errors.push(`${key} B2 review binding mismatch`);
    const refs=(decision.evidenceRefs??[]).map((id:string)=>evidenceIds.get(id));if(refs.some((e:Json)=>!e))errors.push(`${key} cites evidence outside B3 frozen evidence`);
    if(decision.action==='approve_explicit_value'){if(validateProductionFieldValue(decision.field,decision.approvedValue).length)errors.push(`${key} approved value has invalid production shape`);if(!refs.some((e:Json)=>same(e?.proposedProductionValue,decision.approvedValue)))errors.push(`${key} evidenceRefs do not support approvedValue`);}
    else if(decision.action!=='unresolved'||decision.approvedValue!==undefined)errors.push(`${key} has invalid amendment action`);
  }
  for(const key of REQUIRED_TARGETS)if(!seen.has(key))errors.push(`missing amendment ${key}`); return errors;
}

export function composeEffectiveFieldDecisions(b2Overlay:Json,b3:Json,frozen:Json){
  const amendments=new Map(b3.amendments.map((a:Json)=>[a.b2ReviewId,a]));
  return {...structuredClone(b2Overlay),decisions:b2Overlay.decisions.map((original:Json)=>{const amendment:Json=amendments.get(original.reviewId);if(!amendment)return structuredClone(original);const target=frozen.reviewTargets.find((t:Json)=>t.b2ReviewId===original.reviewId);return {...structuredClone(original),action:amendment.action,...(amendment.approvedValue===undefined?{}:{approvedValue:structuredClone(amendment.approvedValue)}),evidenceRefs:amendment.evidenceRefs.map((id:string)=>target.evidence.find((e:Json)=>e.evidenceId===id).originB2EvidenceId),reason:amendment.reason,applyPolicy:amendment.applyPolicy};})};
}
