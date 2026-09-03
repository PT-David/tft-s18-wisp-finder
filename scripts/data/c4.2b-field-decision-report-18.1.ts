import{readFile,writeFile}from'node:fs/promises';import{resolve}from'node:path';import{readiness,type Json}from'./lib/c4.2b-field-decisions';
const root=resolve(import.meta.dirname,'../..'),load=async(p:string)=>JSON.parse(await readFile(resolve(root,p),'utf8')) as Json;
export function renderDecisionReport(frozen:Json,overlay:Json){const ready=readiness(frozen,overlay),counts=overlay.decisions.reduce((a:Json,d:Json)=>(a[d.action]=(a[d.action]??0)+1,a),{}),existing=overlay.decisions.filter((d:Json)=>d.identity.productionId),ec=existing.reduce((a:Json,d:Json)=>(a[d.action]=(a[d.action]??0)+1,a),{});return `# C4.2B2 formal field decisions — patch 18.1

> Frozen decision-time evidence: \`${frozen.bundleSha256}\`. This report is deterministically rendered from the frozen evidence and manual overlay; it does not apply production changes.

## New identity readiness

| Identity | Status | Required fields approved | Required blockers | Optional unknown / unresolved | Blockers |
| --- | --- | --- | --- | --- | ---: |
${ready.map((r:Json)=>`| ${r.nameEn} (\`${r.communityDragonId}\`) | **${r.status}** | ${r.requiredApproved.join(', ')} | ${r.requiredBlockers.join(', ')||'—'} | ${r.optionalUnknown.join(', ')||'—'} | ${r.requiredBlockers.length} |`).join('\n')}

**C4.2C gate:** ${ready.filter((r:Json)=>r.status==='READY').length}/7 READY; ${ready.reduce((n:number,r:Json)=>n+r.requiredBlockers.length,0)} required-field blockers remain.

## Existing production

| Disposition | Count |
| --- | ---: |
| Approved correction | ${(ec.approve_proposal??0)+(ec.approve_explicit_value??0)} |
| Retain current | ${ec.retain_current??0} |
| Unresolved (no truth claim; no change) | ${ec.unresolved??0} |
| Accepted unknown | ${ec.accepted_unknown??0} |
| Confirmed absent | ${ec.confirmed_absent??0} |

## All formal decisions

| Action | Count |
| --- | ---: |
${['approve_proposal','approve_explicit_value','retain_current','accepted_unknown','unresolved','confirmed_absent'].map(k=>`| ${k} | ${counts[k]??0} |`).join('\n')}

## Governance

- B1 remains current/generated; B2 evidence is frozen.
- The decision overlay is manual-owned and no generator overwrites it.
- Validation checks admissibility, binding, shapes, coverage, and lifecycle rather than hard-coding field answers or queue counts.
- New-record creation is limited to READY identities and must exactly match every approved required field, deterministic scaffolding, and evidence-derived provenance.
- Accepted unknown Knowledge fields materialize as \`{ "status": "unknown" }\`; unknown variants and \`minimumAffordableGold\` remain omitted.
- Production remains at ${frozen.frozenFrom.productionRecordCount} records with zero C4.2A/C4.2B decisions applied.
`}
if(process.argv[1]===import.meta.filename){const f=await load('data/reviews/18.1/c4.2b2-field-evidence.json'),d=await load('data/reviews/18.1/c4.2b-field-decisions.json');await writeFile(resolve(root,'reports/c4.2b2-field-decisions-18.1.md'),renderDecisionReport(f,d));console.log('Generated C4.2B2 decision report.');}
