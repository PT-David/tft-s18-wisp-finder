import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildNewRecordPlan, deriveDecisionProvenance, readiness, validateDecisions, validateFulfillment } from '../scripts/data/lib/c4.2b-field-decisions';
import { validateDataset, validateProductionFieldValue } from '../scripts/validation';
import { buildFieldReviewPacket } from '../scripts/data/field-review-packet-18.1';

const frozen = JSON.parse(readFileSync('data/reviews/18.1/c4.2b2-field-evidence.json', 'utf8'));
const overlay = JSON.parse(readFileSync('data/reviews/18.1/c4.2b-field-decisions.json', 'utf8'));
const production = JSON.parse(readFileSync('data/normalized/wisps_18.1.json', 'utf8'));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe('C4.2B2 decision governance', () => {
  it('binds the exact frozen bundle and validates independently of current B1', () => {
    expect(overlay.evidenceBinding.frozenEvidenceSha256).toBe(frozen.bundleSha256);
    expect(validateDecisions(frozen, overlay, production)).toEqual([]);
  });

  it('detects missing, duplicate, and orphan dispositions', () => {
    for (const mutate of [(d: any) => d.decisions.pop(), (d: any) => d.decisions.push(clone(d.decisions[0])), (d: any) => { d.decisions[0].reviewId = 'orphan'; }]) {
      const decisions = clone(overlay); mutate(decisions);
      expect(validateDecisions(frozen, decisions).length).toBeGreaterThan(0);
    }
  });

  it('requires approvals to cite evidence that supports the selected value', () => {
    const decisions = clone(overlay);
    const explicit = decisions.decisions.find((decision: any) => decision.action === 'approve_explicit_value');
    const item = frozen.reviewItems.find((candidate: any) => candidate.reviewId === explicit.reviewId);
    const unrelated = item.evidence.find((evidence: any) => JSON.stringify(evidence.proposedProductionValue) !== JSON.stringify(explicit.approvedValue));
    expect(unrelated).toBeTruthy();
    explicit.evidenceRefs = [unrelated.evidenceId];
    expect(validateDecisions(frozen, decisions).join('\n')).toContain('does not support approved value');
  });

  it('enforces action admissibility and positive absence evidence', () => {
    const cases: Array<(decision: any) => void> = [
      (decision) => { decision.action = 'approve_proposal'; decision.approvedValue = 'invented'; decision.applyPolicy = 'apply'; },
      (decision) => { decision.action = 'approve_explicit_value'; decision.approvedValue = 987654; decision.applyPolicy = 'apply'; },
      (decision) => { decision.action = 'retain_current'; },
      (decision) => { decision.action = 'accepted_unknown'; decision.approvedValue = false; },
      (decision) => { decision.action = 'confirmed_absent'; },
    ];
    for (const mutate of cases) {
      const decisions = clone(overlay), target = decisions.decisions.find((value: any) => !value.identity.productionId && value.action === 'unresolved');
      mutate(target);
      expect(validateDecisions(frozen, decisions).length).toBeGreaterThan(0);
    }
  });

  it('uses the real production shape for Requirements and display-safe effects', () => {
    expect(validateProductionFieldValue('requirements', [{ type: 'source_text', textEn: 'English only', machineEvaluable: false }])).not.toEqual([]);
    expect(validateProductionFieldValue('requirements', [{ type: 'source_text', textZh: '已有中文证据', machineEvaluable: false }])).toEqual([]);
    expect(validateProductionFieldValue('effects.normal', 'Damage under @Threshold*100@%.')).not.toEqual([]);
    const rows = readiness(frozen, overlay);
    expect(rows.find((row: any) => row.communityDragonId === 'DA_BearsVisit18').requiredBlockers).toEqual(expect.arrayContaining(['category', 'requirements']));
    expect(rows.find((row: any) => row.communityDragonId === 'DA_TigersVisit18_Wisp').requiredBlockers).toEqual(expect.arrayContaining(['category', 'requirements']));
    const snack = overlay.decisions.find((decision: any) => decision.identity.communityDragonId === 'DA_Snacktime18' && decision.field === 'effects.normal');
    expect(snack.approvedValue).toBe('The BFF eats enemies he damages under 15% Max Health.');
    expect(snack.adjudicatedPropositions).toEqual([expect.objectContaining({ propositionKey: 'client-variable-executethreshold', approvedValue: 15 })]);
  });

  it('keeps Bear, Tiger, and Bear Upgrade identities distinct', () => {
    const ids = frozen.missingIdentities.map((identity: any) => identity.communityDragonId);
    expect(ids).toContain('DA_TigersVisit18_Wisp'); expect(ids).toContain('DA_BearsVisit18'); expect(ids).not.toContain('DA_BearsVisit18_Upgrade');
  });

  it('blocks Bear and Tiger creation but permits an exact READY Memorial record', () => {
    expect(buildNewRecordPlan(frozen, overlay, 'DA_BearsVisit18')).toBeUndefined();
    expect(buildNewRecordPlan(frozen, overlay, 'DA_TigersVisit18_Wisp')).toBeUndefined();
    const memorial = buildNewRecordPlan(frozen, overlay, 'DA_MemorialDummy18');
    expect(memorial).toBeTruthy();
    expect(validateDataset({ patch: '18.1', records: [memorial] })).toEqual([]);
    expect(validateFulfillment(frozen, overlay, { records: [...production.records, memorial] })).toEqual([]);
    const bear = { ...memorial, id: 'da_bearsvisit18', riotId: 'DA_BearsVisit18', category: 'combat' };
    expect(validateFulfillment(frozen, overlay, { records: [...production.records, bear] }).join('\n')).toContain('blocked or unapproved new identity');
  });

  it('enforces every required field, scaffolding, and field-specific unknown materialization', () => {
    const memorial = buildNewRecordPlan(frozen, overlay, 'DA_MemorialDummy18')!;
    expect(memorial.oncePerGame).toEqual({ status: 'unknown' });
    expect(memorial.reofferCooldownShops).toEqual({ status: 'unknown' });
    expect(memorial.minimumAffordableGold).toBeUndefined();
    expect(memorial.effects.prismatic).toBeUndefined();
    for (const mutate of [
      (record: any) => { delete record.category; },
      (record: any) => { record.oncePerGame = false; },
      (record: any) => { delete record.oncePerGame; },
      (record: any) => { record.effects.prismatic = null; },
      (record: any) => { record.patch = 'arbitrary'; },
      (record: any) => { record.extra = true; },
    ]) {
      const record = clone(memorial); mutate(record);
      expect(validateFulfillment(frozen, overlay, { records: [...production.records, record] })).not.toEqual([]);
    }
  });

  it('derives id from riotId, patch from Riot, and Knowledge unknowns from review governance', () => {
    const memorial = buildNewRecordPlan(frozen, overlay, 'DA_MemorialDummy18')!;
    expect(memorial.sources.id).toEqual(memorial.sources.riotId);
    expect(memorial.sources.id).not.toEqual(memorial.sources.stageRanges);
    expect(memorial.sources.patch).toEqual(expect.objectContaining({ sourceId: 'riot_patch_18_1_20260828', confidence: 'official' }));
    expect(memorial.sources.patch).not.toEqual(memorial.sources.stageRanges);
    expect(memorial.sources.oncePerGame).toEqual(expect.objectContaining({ provenanceKind: 'review_governance', disposition: 'accepted_unknown' }));
    expect(memorial.sources.reofferCooldownShops).toEqual(expect.objectContaining({ provenanceKind: 'review_governance', disposition: 'accepted_unknown' }));
    expect(memorial.sources.oncePerGame.sourceId).toBeUndefined();
  });

  it('uses field-specific source hierarchy and only then a deterministic tie-break', () => {
    const evidence = (evidenceId: string, sourceId: string, tier: string, value: unknown, useFor: string[], locale = 'en') => ({ evidenceId, sourceId, tier, confidence: tier === 'A' ? 'official' : tier === 'B' ? 'client_data' : tier === 'C' ? 'verified_third_party' : 'community_high_confidence', retrievedAt: '2026-09-02', sourceLocaleCoverage: locale, valueLocale: locale, useFor, proposedProductionValue: value });
    const select = (field: string, value: unknown, rows: any[]) => deriveDecisionProvenance({ field, proposedProductionValue: value, evidence: rows }, { action: 'approve_proposal', evidenceRefs: rows.map((row) => row.evidenceId) });
    expect(select('nameEn', 'Name', [evidence('d', 'display', 'D', 'Name', ['display_name_cross_check']), evidence('a', 'official', 'A', 'Name', ['display_name_cross_check'])])?.sourceId).toBe('official');
    expect(select('nameEn', 'Name', [evidence('c', 'tier-c', 'C', 'Name', ['display_name_cross_check']), evidence('b', 'client', 'B', 'Name', ['display_name_cross_check'])])?.sourceId).toBe('client');
    const stages = [{ start: { stage: 3, round: 1 }, end: { stage: 4, round: 7 } }];
    expect(select('stageRanges', stages, [evidence('d', 'datatft', 'D', stages, ['stageRanges']), evidence('c', 'lolchess', 'C', stages, ['stageRanges_cross_check'])])?.sourceId).toBe('lolchess');
    expect(select('stageRanges', stages, [evidence('z', 'z-source', 'C', stages, ['stageRanges_cross_check']), evidence('a', 'a-source', 'C', stages, ['stageRanges_cross_check'])])?.sourceId).toBe('a-source');
    expect(select('stageRanges', stages, [evidence('higher', 'other-truth', 'A', [], ['stageRanges']), evidence('approved', 'approved-truth', 'C', stages, ['stageRanges_cross_check'])])?.sourceId).toBe('approved-truth');
    expect(select('cost', 3, [evidence('conflict', 'discovery-only', 'C', 3, ['field_conflict_detection'])])).toBeUndefined();
    expect(select('cost', 3, [evidence('cost', 'cost-capable', 'C', 3, ['cost_cross_check'])])?.sourceId).toBe('cost-capable');
    expect(select('cost', 3, [evidence('both', 'both-capable', 'C', 3, ['field_conflict_detection', 'cost_cross_check'])])?.sourceId).toBe('both-capable');
  });

  it('binds source truth to the frozen catalog rather than manual self-attestation', () => {
    const forgedOverlay = clone(overlay);
    forgedOverlay.provenancePolicy.patch.frozenSourceId = 'invented-source';
    forgedOverlay.provenancePolicy.patchSource = { sourceId: 'invented-source' };
    expect(validateDecisions(frozen, forgedOverlay).join('\n')).toContain('outside the frozen catalog');
    const driftedFrozen = clone(frozen);
    driftedFrozen.decisionTimeSourceManifest.sources[0].tier = 'invented-tier';
    expect(validateDecisions(driftedFrozen, overlay).join('\n')).toContain('frozen source catalog does not match');
  });

  it('preserves field-specific capabilities through current B1 regeneration', async () => {
    const { packet } = await buildFieldReviewPacket();
    const costEvidence = packet.reviewItems.flatMap((item: any) => item.field === 'cost' ? item.evidence : []).find((evidence: any) => evidence.sourceId === 'opgg_set18_wisps_20260902');
    expect(costEvidence.useFor).toContain('cost_cross_check');
  });

  it('compares nested approved fields without permitting sibling mutation', () => {
    const item = { reviewId: 'normal', field: 'effects.normal', proposedProductionValue: 'new', identity: { productionId: 'one' }, evidence: [{ evidenceId: 'normal:E1', sourceId: 'source', retrievedAt: '2026-09-02T00:00:00Z', confidence: 'client_data', proposedProductionValue: 'new' }] };
    const decision = { reviewId: 'normal', action: 'approve_proposal', approvedValue: 'new', identity: { productionId: 'one' }, field: 'effects.normal', evidenceRefs: ['normal:E1'] };
    const base = { records: [{ id: 'one', effects: { normal: 'old', blossom: 'old blossom', prismatic: 'old prismatic' }, sources: { effects: { sourceId: 'old', verifiedAt: 'old', confidence: 'unverified' } } }] };
    const fixture: any = { missingIdentities: [], reviewItems: [item], productionBaseline: base };
    const decisions: any = { decisions: [decision] };
    const provenance = deriveDecisionProvenance(item, decision);
    expect(validateFulfillment(fixture, decisions, { records: [{ ...base.records[0], effects: { ...base.records[0].effects, normal: 'new' }, sources: { effects: provenance } }] })).toEqual([]);
    expect(validateFulfillment(fixture, decisions, { records: [{ ...base.records[0], effects: { ...base.records[0].effects, normal: 'wrong' } }] }).join('\n')).toContain('wrong approved value');
    expect(validateFulfillment(fixture, decisions, { records: [{ ...base.records[0], effects: { ...base.records[0].effects, prismatic: 'changed' } }] }).join('\n')).toContain('unapproved unrelated mutation');
    expect(validateFulfillment(fixture, decisions, { records: [{ ...base.records[0], sources: { effects: { sourceId: 'arbitrary' } } }] }).join('\n')).toContain('unapproved provenance mutation');
  });

  it('allows approved blossom but rejects unresolved normal changes', () => {
    const base = { records: [{ id: 'one', effects: { normal: 'old', blossom: 'old' }, sources: { effects: { sourceId: 'old', verifiedAt: 'old', confidence: 'unverified' } } }] };
    const blossom = { reviewId: 'b', field: 'effects.blossom', proposedProductionValue: 'new blossom', identity: { productionId: 'one' }, evidence: [{ evidenceId: 'b:E1', sourceId: 's', retrievedAt: '2026-09-02', confidence: 'client_data', proposedProductionValue: 'new blossom' }] };
    const unresolved = { reviewId: 'u', field: 'effects.normal', identity: { productionId: 'one' }, evidence: [] };
    const bDecision = { reviewId: 'b', action: 'approve_proposal', approvedValue: 'new blossom', identity: { productionId: 'one' }, field: 'effects.blossom', evidenceRefs: ['b:E1'] };
    const uDecision = { reviewId: 'u', action: 'unresolved', identity: { productionId: 'one' }, field: 'effects.normal', evidenceRefs: [] };
    const fixture: any = { missingIdentities: [], reviewItems: [blossom, unresolved], productionBaseline: base };
    const provenance = deriveDecisionProvenance(blossom, bDecision);
    expect(validateFulfillment(fixture, { decisions: [bDecision, uDecision] }, { records: [{ ...base.records[0], effects: { normal: 'old', blossom: 'new blossom' }, sources: { effects: provenance } }] })).toEqual([]);
    expect(validateFulfillment(fixture, { decisions: [bDecision, uDecision] }, { records: [{ ...base.records[0], effects: { normal: 'changed', blossom: 'old' } }] }).join('\n')).toContain('unresolved field modified');
  });
});
