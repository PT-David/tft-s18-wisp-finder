import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { composedReadiness, validateB3 } from '../scripts/data/lib/c4.2b3-required-fields';
const text=(p:string)=>readFileSync(p,'utf8'),clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
const frozen=JSON.parse(text('data/reviews/18.1/c4.2b3-required-field-evidence.json')),decisions=JSON.parse(text('data/reviews/18.1/c4.2b3-required-field-decisions.json')),b2FrozenText=text('data/reviews/18.1/c4.2b2-field-evidence.json'),b2Text=text('data/reviews/18.1/c4.2b-field-decisions.json');
describe('C4.2B3 supplemental governance',()=>{
 it('validates only six amendments bound to unresolved B2 decisions',()=>expect(validateB3(frozen,decisions,b2FrozenText,b2Text)).toEqual([]));
 it('rejects orphan, duplicate, unsupported, and invalid-shaped approvals',()=>{for(const mutate of [(d:any)=>d.amendments[0].communityDragonId='orphan',(d:any)=>d.amendments.push(clone(d.amendments[0])),(d:any)=>{d.amendments[0].action='approve_explicit_value';d.amendments[0].approvedValue='not-a-category'},(d:any)=>{d.amendments.find((x:any)=>x.action==='approve_explicit_value').approvedValue=99}]){const copy=clone(decisions);mutate(copy);expect(validateB3(frozen,copy,b2FrozenText,b2Text).length).toBeGreaterThan(0)}});
 it('composes amendments without changing the other 168 B2 decisions',()=>{expect(decisions.amendments).toHaveLength(6);const rows=composedReadiness(JSON.parse(b2FrozenText),JSON.parse(b2Text),decisions);expect(rows.filter((r:any)=>r.status==='READY')).toHaveLength(4);expect(rows.reduce((n:number,r:any)=>n+r.requiredBlockers.length,0)).toBe(5)});
});
