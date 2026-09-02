import { createHash } from 'node:crypto';

export type Json = Record<string, any>;
export const stableJson=(v:unknown)=>`${JSON.stringify(v,null,2)}\n`;
export const sha256=(s:string)=>createHash('sha256').update(s).digest('hex');
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export const REQUIRED_NEW_FIELDS=['riotId','nameEn','nameZh','category','cost','stageRanges','effects.normal','requirements'];
export const OPTIONAL_FIELDS=['effects.blossom','effects.prismatic','oncePerGame','reofferCooldownShops','minimumAffordableGold'];
const CATEGORIES=new Set(['champion','combat','misc','shop','gold_xp','risky','item']);

export function evidenceRefs(item:Json){return (item.evidence??[]).map((e:Json)=>e.evidenceId);}
export function approvedValue(decision:Json,item:Json){return decision.action==='approve_proposal'?item.proposedProductionValue:decision.approvedValue;}
export function readiness(frozen:Json,overlay:Json){
 const byReview=new Map<string,Json>(overlay.decisions.map((d:Json)=>[d.reviewId,d]));
 return frozen.missingIdentities.map((identity:Json)=>{
  const units=frozen.reviewItems.filter((i:Json)=>i.identity.communityDragonId===identity.communityDragonId);
  const blockers:string[]=[];
  for(const field of REQUIRED_NEW_FIELDS){const matches=units.filter((i:Json)=>i.field===field), approved=matches.some((i:Json)=>['approve_proposal','approve_explicit_value'].includes(byReview.get(i.reviewId)?.action));if(!approved)blockers.push(field);else {const i=matches.find((x:Json)=>['approve_proposal','approve_explicit_value'].includes(byReview.get(x.reviewId)?.action))!;const v=approvedValue(byReview.get(i.reviewId)!,i);if((field==='stageRanges'&&(!Array.isArray(v)||!v.length))||(field==='effects.normal'&&(typeof v!=='string'||!v.trim()))||(field==='requirements'&&!Array.isArray(v)))blockers.push(field);}}
  const optionalUnknown=units.filter((i:Json)=>OPTIONAL_FIELDS.includes(i.field)&&['accepted_unknown','unresolved'].includes(byReview.get(i.reviewId)?.action)).map((i:Json)=>i.field);
  return {...identity,status:blockers.length?'BLOCKED':'READY',requiredApproved:REQUIRED_NEW_FIELDS.filter(f=>!blockers.includes(f)),requiredBlockers:blockers,optionalUnknown:[...new Set(optionalUnknown)]};
 });
}

export function validateDecisions(frozen:Json,overlay:Json,currentProduction?:Json){
 const errors:string[]=[];
 if(frozen.schemaVersion!==1||frozen.patch!=='18.1'||frozen.reviewStage!=='C4.2B2')errors.push('invalid frozen evidence envelope');
 if(overlay.schemaVersion!==1||overlay.patch!==frozen.patch||overlay.reviewStage!=='C4.2B2')errors.push('invalid decision overlay envelope');
 const calculatedFrozenSha=sha256(stableJson({...frozen,bundleSha256:undefined}).replace(/  "bundleSha256": undefined,?\n?/g,''));
 if(overlay.evidenceBinding?.frozenEvidenceSha256!==frozen.bundleSha256)errors.push('manual decisions do not bind frozen evidence SHA');
 if(frozen.bundleSha256!==calculatedFrozenSha)errors.push('frozen evidence self fingerprint mismatch');
 const units=new Map<string,Json>(frozen.reviewItems.map((i:Json)=>[i.reviewId,i])), seen=new Set<string>();
 for(const d of overlay.decisions??[]){
  if(seen.has(d.reviewId)){errors.push(`duplicate decision ${d.reviewId}`);continue}seen.add(d.reviewId);
  const i=units.get(d.reviewId);if(!i){errors.push(`orphan decision ${d.reviewId}`);continue}
  if(d.field!==i.field||d.propositionKey!==i.propositionKey||d.identity.communityDragonId!==i.identity.communityDragonId||d.identity.productionId!==i.identity.productionId)errors.push(`${d.reviewId}: decision target drift`);
  const refs=new Set((i.evidence??[]).map((e:Json)=>e.evidenceId));for(const ref of d.evidenceRefs??[])if(!refs.has(ref))errors.push(`${d.reviewId}: unbound evidence ref ${ref}`);
  if(d.action==='approve_proposal'&&(i.reviewClass!=='decision_ready'||i.productionCandidateValues?.length!==1||!same(d.approvedValue,i.proposedProductionValue)))errors.push(`${d.reviewId}: inadmissible approve_proposal`);
  if(d.action==='approve_explicit_value'&&!(i.productionCandidateValues??[]).some((v:unknown)=>same(v,d.approvedValue)))errors.push(`${d.reviewId}: explicit value is not frozen evidence-derived`);
  if(d.action==='retain_current'&&!i.identity.productionId)errors.push(`${d.reviewId}: retain_current requires existing identity`);
  if(d.action==='accepted_unknown'&&(d.approvedValue===false||d.approvedValue===null||d.approvedValue===0||d.approvedValue!==undefined))errors.push(`${d.reviewId}: unknown was materialized`);
  if(d.action==='confirmed_absent'&&!(i.evidence??[]).some((e:Json)=>e.observationState==='explicit_absence'))errors.push(`${d.reviewId}: absence lacks positive evidence`);
  if(['approve_proposal','approve_explicit_value'].includes(d.action)&&d.applyPolicy!=='apply')errors.push(`${d.reviewId}: approval must apply`);
  if(['accepted_unknown','unresolved'].includes(d.action)&&!['defer','no_change'].includes(d.applyPolicy))errors.push(`${d.reviewId}: non-truth disposition cannot apply`);
  const v=approvedValue(d,i);if(d.action.startsWith('approve_')){if(i.field==='category'&&!CATEGORIES.has(v))errors.push(`${d.reviewId}: invalid category`);if(i.field==='stageRanges'&&(!Array.isArray(v)||!v.length))errors.push(`${d.reviewId}: empty stageRanges`);if(i.field==='effects.normal'&&(typeof v!=='string'||!v.trim()))errors.push(`${d.reviewId}: empty normal effect`);}
 }
 for(const id of units.keys())if(!seen.has(id))errors.push(`missing decision ${id}`);
 if(currentProduction)errors.push(...validateFulfillment(frozen,overlay,currentProduction));
 return errors;
}

function getField(record:Json,path:string){return path.split('.').reduce((v,k)=>v?.[k],record)}
export function validateFulfillment(frozen:Json,overlay:Json,current:Json){
 const errors:string[]=[];const baseline=frozen.productionBaseline.records, now=current.records;
 const oldById=new Map<string,Json>(baseline.map((r:Json)=>[r.id,r])),newById=new Map<string,Json>(now.map((r:Json)=>[r.id,r]));
 const unitByReview=new Map<string,Json>(frozen.reviewItems.map((i:Json)=>[i.reviewId,i]));const decisions=overlay.decisions as Json[];
 const approvedExisting=new Map<string,Json>();for(const d of decisions.filter(d=>d.identity.productionId&&d.action.startsWith('approve_'))){const key=`${d.identity.productionId}|${d.field}`;if(approvedExisting.has(key))errors.push(`duplicate approved target ${key}`);approvedExisting.set(key,{d,i:unitByReview.get(d.reviewId)});}
 for(const [id,old] of oldById){const cur=newById.get(id);if(!cur){errors.push(`unapproved deleted record ${id}`);continue}for(const key of new Set([...Object.keys(old),...Object.keys(cur)])){if(key==='sources')continue;const target=approvedExisting.get(`${id}|${key}`);if(!same(old[key],cur[key])&&!target)errors.push(`unapproved unrelated mutation ${id}.${key}`);if(target&&!same(cur[key],approvedValue(target.d,target.i))&&!same(cur[key],old[key]))errors.push(`wrong approved value ${id}.${key}`);}}
 const permittedNew=new Set(frozen.missingIdentities.map((x:Json)=>x.communityDragonId)),newRiotIds=new Set<string>();for(const r of now.filter((r:Json)=>!oldById.has(r.id))){if(newRiotIds.has(r.riotId))errors.push(`duplicate new identity ${r.riotId}`);newRiotIds.add(r.riotId);if(!permittedNew.has(r.riotId)){errors.push(`unapproved new identity ${r.riotId}`);continue}const identityDecisions=decisions.filter(d=>d.identity.communityDragonId===r.riotId&&d.action.startsWith('approve_'));for(const d of identityDecisions){const i=unitByReview.get(d.reviewId)!;if(!same(getField(r,d.field),approvedValue(d,i)))errors.push(`wrong approved value ${r.riotId}.${d.field}`)}}
 for(const d of decisions.filter(d=>['unresolved','accepted_unknown'].includes(d.action)&&d.identity.productionId)){const old=oldById.get(d.identity.productionId),cur=newById.get(d.identity.productionId);if(old&&cur&&!same(getField(old,d.field),getField(cur,d.field)))errors.push(`${d.action} field modified ${d.identity.productionId}.${d.field}`)}
 return errors;
}
