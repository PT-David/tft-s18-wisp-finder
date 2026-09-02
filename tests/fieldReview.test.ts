import { describe,expect,it } from 'vitest';
import { classifyValues, consolidateRawIssues, historicalBaselineValid, representationDoesNotProveField, stableJson } from '../scripts/data/lib/field-review';
import { renderMarkdown } from '../scripts/data/field-review-packet-18.1';
describe('field-review governance',()=>{
 it('keeps stage and requirement propositions independent',()=>expect(consolidateRawIssues([{productionId:'x',requirements:[{textEn:'Trait active'}],reviewReasons:['requirements:presence_conflict']},{productionId:'x',reviewReasons:['stageRanges']}])).toHaveLength(2));
 it('classifies numeric disagreement for human review',()=>expect(classifyValues([10,15])).toMatchObject({reviewClass:'human_conflict',conflictType:'numeric'}));
 it('allows semantic agreement to be decision ready',()=>expect(classifyValues(['gain temporary tree','gain temporary tree'])).toMatchObject({reviewClass:'decision_ready'}));
 it('preserves unknown',()=>expect(classifyValues([])).toMatchObject({evidenceState:'unknown',reviewClass:'insufficient_evidence'}));
 it('does not equate non-observation with absence',()=>expect(classifyValues([]).evidenceState).not.toBe('confirmed_absence_candidate'));
 it('does not infer variant field truth',()=>{expect(representationDoesNotProveField('upgrade')).toBe(false);expect(representationDoesNotProveField('prismatic')).toBe(false)});
 it('consolidates duplicate reasons',()=>expect(consolidateRawIssues([{productionId:'x',requirements:[],reviewReasons:['requirements:presence_conflict','requirements:semantic_review_required']}])).toHaveLength(1));
 it('does not merge independent requirements',()=>expect(consolidateRawIssues([{productionId:'x',requirements:[{textEn:'Trait active'}],reviewReasons:['requirements:semantic_review_required']},{productionId:'x',requirements:[{textEn:'No prior choice'}],reviewReasons:['requirements:semantic_review_required']}])).toHaveLength(2));
 it('does not collide Bear/Tiger families',()=>expect(consolidateRawIssues([{productionId:'bear-family',reviewReasons:['blossom_presence']},{productionId:'tiger-family',reviewReasons:['blossom_presence']}])).toHaveLength(2));
 it('separates localized fields',()=>expect(consolidateRawIssues([{productionId:'x',reviewReasons:['nameEn','nameZh']}]).map(x=>x.field)).toEqual(['nameEn','nameZh']));
 it('renders deterministically',()=>{const p={newIdentitySummary:[],reviewItems:[],summary:{rawIssueCount:0,rawIdentityCount:0,existingLogicalReviewUnitCount:0,decisionReady:0,humanConflict:0,insufficientEvidence:0,acceptedUnknown:0}};expect(renderMarkdown(p)).toBe(renderMarkdown(JSON.parse(stableJson(p))))});
 it('keeps history independent of future production',()=>expect(historicalBaselineValid({reviewBaseline:{inputArtifacts:[{path:'frozen',sha256:'abc'}]}},{frozen:'abc',currentProduction:'changed'})).toBe(true));
});
