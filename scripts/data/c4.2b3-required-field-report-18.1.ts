import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readiness, type Json } from './lib/c4.2b-field-decisions';
import { composeEffectiveFieldDecisions } from './lib/c4.2b3-required-fields';
const root=resolve(import.meta.dirname,'../..'),load=async(p:string)=>JSON.parse(await readFile(resolve(root,p),'utf8')) as Json;
export function render(frozen:Json,b2Frozen:Json,b2:Json,decisions:Json){
 const rows=decisions.amendments.map((d:Json)=>{const item=frozen.reviewTargets.find((x:Json)=>x.b2ReviewId===d.b2ReviewId);return `| ${item.nameEn} (\`${d.communityDragonId}\`) | ${d.field} | **${d.action==='unresolved'?'unresolved':'resolved'}** | ${d.approvedValue===undefined?'—':`\`${JSON.stringify(d.approvedValue)}\``} | ${d.evidenceRefs.join(', ')||'—'} | ${d.reason} |`});
 const readinessRows=readiness(b2Frozen,composeEffectiveFieldDecisions(b2,decisions,frozen)),ready=readinessRows.filter((r:Json)=>r.status==='READY').length,blockers=readinessRows.reduce((n:number,r:Json)=>n+r.requiredBlockers.length,0);
 return `# C4.2B3 targeted required-field resolution — patch 18.1

> Supplemental frozen evidence: \`${frozen.bundleSha256}\`; manual amendment SHA: \`${decisions.decisionSha256}\`. B2 remains immutable. B3 takes precedence only for its six targets; all other B2 decisions remain effective.

## Targeted decisions

| Identity | Field | Status | Approved value | Main evidence | Reason |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

## Composed readiness

| Identity | Status | Remaining required blockers |
| --- | --- | --- |
${readinessRows.map((r:Json)=>`| ${r.nameEn} (\`${r.communityDragonId}\`) | **${r.status}** | ${r.requiredBlockers.join(', ')||'—'} |`).join('\n')}

**C4.2C gate: READY ${ready}/7; remaining blockers ${blockers}.** C4.2C remains blocked; this stage performs zero Apply operations.

## Acquisition and governance

- Committed raw snapshots were inspected first. No fresh source was admitted because targeted live acquisition was unavailable; public-page observations were not promoted directly into decisions.
- Lifebloom is an explicit freshness, field-capability, and exact-base-identity adjudication, not source vote counting. DataTFT has the later known page update and an exact bilingual base record, and LoLCHESS independently supports 2; OP.GG's conflicting 3 lacks a comparable upstream timestamp, so its freshness cannot be independently established.
- Snacktime remains unresolved because current committed values conflict and CommunityDragon does not expose actual offer/shop cost. Bear/Tiger requirements remain unresolved because committed Chinese evidence for the complete requirements is absent; no Chinese truth was invented.
- Production remains ${frozen.frozenFrom.productionRecordCount} records; 0 new records and 0 Apply.
`;
}
if(process.argv[1]===import.meta.filename){const [f,bf,b,d]=await Promise.all([load('data/reviews/18.1/c4.2b3-required-field-evidence.json'),load('data/reviews/18.1/c4.2b2-field-evidence.json'),load('data/reviews/18.1/c4.2b-field-decisions.json'),load('data/reviews/18.1/c4.2b3-required-field-decisions.json')]);await writeFile(resolve(root,'reports/c4.2b3-required-field-resolution-18.1.md'),render(f,bf,b,d));console.log('Generated C4.2B3 required-field report.');}
