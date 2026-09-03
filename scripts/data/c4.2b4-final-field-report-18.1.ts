import { readFile,writeFile } from 'node:fs/promises';import { resolve } from 'node:path';import { readiness,type Json } from './lib/c4.2b-field-decisions';import { composeB4Lifecycle } from './lib/c4.2b4-final-fields';
const root=resolve(import.meta.dirname,'../..'),load=async(p:string)=>JSON.parse(await readFile(resolve(root,p),'utf8')) as Json;
export function render(b2f:Json,b2:Json,b3f:Json,b3:Json,b4f:Json,b4:Json){const effective=composeB4Lifecycle(b2f,b2,b3f,b3,b4f,b4),rows=readiness(effective.frozen,effective.overlay),ready=rows.filter((r:Json)=>r.status==='READY').length,blockers=rows.reduce((n:number,r:Json)=>n+r.requiredBlockers.length,0),gate=ready===7&&blockers===0?'C4.2B field truth is ready for C4.2C Apply.':'C4.2C remains blocked; unresolved required fields are reported below.';return `# C4.2B4 final required-field evidence resolution — patch 18.1

> B4 frozen SHA: \`${b4f.bundleSha256}\`; decision SHA: \`${b4.decisionSha256}\`. B2 and B3 are immutable; B4 overrides exactly five previously unresolved effective targets.

## Final amendments

| Identity | Field | Status | Approved value | Evidence |
| --- | --- | --- | --- | --- |
${b4.amendments.map((d:Json)=>`| \`${d.communityDragonId}\` | ${d.field} | **${d.action==='unresolved'?'unresolved':'resolved'}** | ${d.approvedValue===undefined?'—':`\`${JSON.stringify(d.approvedValue)}\``} | ${d.evidenceRefs.join(', ')||'—'} |`).join('\n')}

## Effective B2 + B3 + B4 readiness

| Identity | Status | Remaining required blockers |
| --- | --- | --- |
${rows.map((r:Json)=>`| ${r.nameEn} (\`${r.communityDragonId}\`) | **${r.status}** | ${r.requiredBlockers.join(', ')||'—'} |`).join('\n')}

**C4.2C gate: READY ${ready}/7; remaining blockers ${blockers}.** ${gate}

## Acquisition and no-Apply boundary

- Fresh committed OP.GG zh-CN HTML and a deterministic targeted parse support Tiger category and its complete Chinese requirement. LeagueOfGraphs returned HTTP 403 in this environment, so its observations were not admitted.
- Bear remains blocked because no current committed exact-base category evidence or complete Chinese requirement was acquired.
- Snacktime remains blocked: the fresh structured OP.GG value remains 4, while historical sources report 3/4/2; effect-version agreement does not prove shop cost, and no majority vote was used.
- Production remains ${b4f.frozenFrom.productionRecordCount} records; 0 new records, 0 field Apply, and 0 identity Apply.
`;}
if(process.argv[1]===import.meta.filename){const files=['data/reviews/18.1/c4.2b2-field-evidence.json','data/reviews/18.1/c4.2b-field-decisions.json','data/reviews/18.1/c4.2b3-required-field-evidence.json','data/reviews/18.1/c4.2b3-required-field-decisions.json','data/reviews/18.1/c4.2b4-final-field-evidence.json','data/reviews/18.1/c4.2b4-final-field-decisions.json'];const values=await Promise.all(files.map(load));await writeFile(resolve(root,'reports/c4.2b4-final-field-resolution-18.1.md'),render(...values as [Json,Json,Json,Json,Json,Json]));console.log('Generated C4.2B4 final field report.');}
