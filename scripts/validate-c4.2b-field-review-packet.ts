import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildFieldReviewPacket } from './data/field-review-packet-18.1';
import { sha256, stableJson } from './data/lib/field-review';
const root=resolve(import.meta.dirname,'..'); const read=(p:string)=>readFile(resolve(root,p),'utf8');
const packet=JSON.parse(await read('reports/c4.2b1-field-review-packet-18.1.json')); const markdown=await read('reports/c4.2b1-field-review-packet-18.1.md'); const errors:string[]=[];
if(packet.schemaVersion!==1||packet.patch!=='18.1'||packet.purpose!=='field_review_preparation_only') errors.push('invalid packet envelope');
const ids=new Set<string>(), keys=new Set<string>();
for(const i of packet.reviewItems){
  if(ids.has(i.reviewId)) errors.push(`duplicate reviewId ${i.reviewId}`); ids.add(i.reviewId);
  const subject=i.identity.productionId??i.identity.communityDragonId, key=`${subject}|${i.field}|${i.propositionKey}`; if(keys.has(key)) errors.push(`duplicate logical unit ${key}`); keys.add(key);
  if(i.field==='nameEn'&&i.evidence.some((e:any)=>e.locale==='zh_cn')) errors.push(`${i.reviewId}: zh-only evidence used for nameEn`);
  if(i.field==='nameZh'&&i.evidence.some((e:any)=>e.locale==='en_us'||e.locale==='en')) errors.push(`${i.reviewId}: en-only evidence used for nameZh`);
  if(['oncePerGame','reofferCooldownShops','minimumAffordableGold'].includes(i.field)&&i.evidenceState==='unknown'&&i.proposedDisposition!=='preserve_unknown') errors.push(`${i.reviewId}: unknown coerced`);
  if(i.evidenceState==='not_observed'&&i.proposedDisposition==='confirmed_absent_candidate') errors.push(`${i.reviewId}: not_observed promoted to absence`);
  if(['approved','final','verified','resolved_by_human'].some(k=>Object.hasOwn(i,k))) errors.push(`${i.reviewId}: proposal masquerades as decision`);
  for(const e of i.evidence) if(!e.sourceArtifact) errors.push(`${i.reviewId}: evidence lacks source artifact`);
}
for(const a of packet.reviewBaseline.inputArtifacts){try{if(sha256(await read(a.path))!==a.sha256)errors.push(`input fingerprint mismatch ${a.path}`)}catch{errors.push(`missing input ${a.path}`)}}
const decisions=JSON.parse(await read('data/reviews/18.1/c4.2a-identity-decisions.json')); const approved=new Set(decisions.decisions.filter((d:any)=>d.action==='missing_base_identity').map((d:any)=>d.communityDragonId));
for(const s of packet.newIdentitySummary)if(!approved.has(s.communityDragonId))errors.push(`unapproved new identity ${s.communityDragonId}`);
const production=JSON.parse(await read('data/normalized/wisps_18.1.json'));const productionIds=new Set(production.records.map((r:any)=>r.id)); for(const i of packet.reviewItems)if(i.identity.productionId&&!productionIds.has(i.identity.productionId)&&packet.reviewBaseline.productionSha256===sha256(await read('data/normalized/wisps_18.1.json')))errors.push(`unknown baseline production identity ${i.identity.productionId}`);
const generated=await buildFieldReviewPacket(); if(generated.json!==stableJson(packet))errors.push('JSON is stale or non-deterministic');if(generated.markdown!==markdown)errors.push('Markdown is stale or not rendered from packet model');
if(errors.length)throw new Error(`C4.2B1 packet validation failed:\n- ${errors.join('\n- ')}`);console.log(`Validated ${packet.reviewItems.length} field proposals; ${packet.summary.existingLogicalReviewUnitCount} consolidated existing units; no formal decisions applied.`);
