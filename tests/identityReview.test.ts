import { describe, expect, it } from 'vitest';
import { addLolchessIdentityEvidence, clusterIdentityReviewItems, type ReviewItem } from '../scripts/data/lib/identity-review';
import { buildIdentityReviewPacket, createDataTftReviewItem, DETERMINISTIC_METHOD } from '../scripts/data/identity-review-packet-18.1';

const item = (values: Partial<ReviewItem> & Pick<ReviewItem, 'itemId' | 'source' | 'sourceKey'>): ReviewItem => ({ name: values.sourceKey, ...values });

describe('identity review clustering governance', () => {
  it('clusters OP.GG, DataTFT and CommunityDragon overlap without confirming it', () => {
    const clusters = clusterIdentityReviewItems([
      item({ itemId: 'opgg:a', source: 'opgg', sourceKey: 'A', overlapKeys: ['review-x'] }),
      item({ itemId: 'datatft:b', source: 'datatft', sourceKey: 'B', overlapKeys: ['review-x'] }),
      item({ itemId: 'communitydragon:c', source: 'communitydragon', sourceKey: 'C', overlapKeys: ['review-x'], corpusMembershipConfirmed: true }),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].recommendedHumanAction).toBe('insufficient_evidence');
  });

  it('keeps confirmed membership separate from an unresolved production link', () => {
    const [cluster] = clusterIdentityReviewItems([item({ itemId: 'communitydragon:a', source: 'communitydragon', sourceKey: 'A', corpusMembershipConfirmed: true })]);
    expect(cluster.corpusMembership.status).toBe('confirmed');
    expect(cluster.productionIdentityLink.status).toBe('unresolved');
    expect(cluster.recommendedHumanAction).toBe('insufficient_evidence');
  });

  it('allows an exact client key to recommend same_identity with a production ID', () => {
    const [cluster] = clusterIdentityReviewItems([item({ itemId: 'opgg:a', source: 'opgg', sourceKey: 'A', exactProductionId: 'prod-a' })]);
    expect(cluster).toMatchObject({ recommendedHumanAction: 'same_identity', recommendedProductionId: 'prod-a', productionIdentityLink: { status: 'confirmed' } });
    expect(cluster.productionIdentityLink.confirmingEvidence).not.toHaveLength(0);
  });

  it('classifies an explicit upgrade representation as a source variant', () => {
    const [cluster] = clusterIdentityReviewItems([item({ itemId: 'opgg:a-upgrade', source: 'opgg', sourceKey: 'AUpgrade', variantOfProductionId: 'prod-a', variantType: 'Blossom/Upgrade representation' })]);
    expect(cluster).toMatchObject({ recommendedHumanAction: 'source_variant', variant: { baseProductionId: 'prod-a' } });
    expect(cluster.corpusMembership.status).toBe('unresolved');
  });

  it('does not resolve equally plausible production candidates', () => {
    const [cluster] = clusterIdentityReviewItems([item({ itemId: 'opgg:a', source: 'opgg', sourceKey: 'A', productionCandidates: [{ productionId: 'one', score: 1 }, { productionId: 'two', score: 1 }] })]);
    expect(cluster.recommendedHumanAction).toBe('insufficient_evidence');
    expect(cluster.productionIdentityLink.status).toBe('unresolved');
    expect(cluster.conflictingEvidence).toContainEqual(expect.stringContaining('Multiple strong'));
    expect(cluster.strongProductionCandidates).toHaveLength(2);
  });

  it('keeps one strong candidate as support without describing a conflict', () => {
    const [cluster] = clusterIdentityReviewItems([item({ itemId: 'opgg:a', source: 'opgg', sourceKey: 'A', productionCandidates: [{ productionId: 'one', score: 1 }, { productionId: 'weak', score: 0.1 }] })]);
    expect(cluster.strongProductionCandidates).toHaveLength(1);
    expect(cluster.conflictingEvidence).toEqual(['No policy-compliant production identity link exists.']);
    expect(cluster.productionIdentityLink.status).toBe('unresolved');
    expect(cluster.recommendedHumanAction).toBe('insufficient_evidence');
  });

  it('does not present zero-score ranked candidates as review-relevant or plausible', () => {
    const [cluster] = clusterIdentityReviewItems([item({ itemId: 'opgg:a', source: 'opgg', sourceKey: 'A', productionCandidates: [{ productionId: 'zero', score: 0 }, { productionId: 'weak', score: 0.05 }] })]);
    expect(cluster.rankedProductionCandidates).toHaveLength(2);
    expect(cluster.reviewRelevantProductionCandidates).toEqual([]);
    expect(cluster.conflictingEvidence).toEqual(['No policy-compliant production identity link exists.']);
  });

  it('is byte-for-byte deterministic for reordered input', () => {
    const input = [item({ itemId: 'opgg:b', source: 'opgg', sourceKey: 'B' }), item({ itemId: 'opgg:a', source: 'opgg', sourceKey: 'A' })];
    expect(JSON.stringify(clusterIdentityReviewItems(input))).toBe(JSON.stringify(clusterIdentityReviewItems([...input].reverse())));
  });

  it('reads the DataTFT review effect from effects.normal', () => {
    const result = createDataTftReviewItem({ id: 'prod-a', nameZh: 'A' }, { category: 'combat', cost: 5, effects: { normal: 'normal effect', blossom: 'upgrade' } }, []);
    expect(result.effect).toBe('normal effect');
  });

  it('uses priority-specific question shapes', () => {
    const p0 = clusterIdentityReviewItems([item({ itemId: 'datatft:x', source: 'datatft', sourceKey: 'x', overlapKeys: ['x'] }), item({ itemId: 'opgg:x', source: 'opgg', sourceKey: 'Confirmed', overlapKeys: ['x'], corpusMembershipConfirmed: true })])[0];
    const p1 = clusterIdentityReviewItems([item({ itemId: 'opgg:confirmed', source: 'opgg', sourceKey: 'Confirmed', corpusMembershipConfirmed: true })])[0];
    const p3 = clusterIdentityReviewItems([item({ itemId: 'opgg:only', source: 'opgg', sourceKey: 'Only' })])[0];
    expect(p0.currentQuestion).toMatch(/^DataTFT.*OP\.GG \/ CommunityDragon 已确认/);
    expect(p1.currentQuestion).toMatch(/^已确认的 Confirmed live corpus identity/);
    expect(p3.currentQuestion).toMatch(/^OP\.GG Only 是否对应现有 production Wisp/);
  });

  it('does not create a DataTFT overlap edge for tied or near-tied candidates', () => {
    const candidates = [
      item({ itemId: 'opgg:a', source: 'opgg', sourceKey: 'A', productionCandidates: [{ productionId: 'prod', score: 0.9 }] }),
      item({ itemId: 'opgg:b', source: 'opgg', sourceKey: 'B', productionCandidates: [{ productionId: 'prod', score: 0.88 }] }),
    ];
    expect(createDataTftReviewItem({ id: 'prod', nameZh: 'P' }, { effects: { normal: 'X' } }, candidates).overlapKeys).toEqual([]);
  });

  it('keeps generated deterministic-method metadata aligned with overlap governance', async () => {
    const output = await buildIdentityReviewPacket();
    const packet = JSON.parse(output.json);
    expect(packet.deterministicMethod).toBe(DETERMINISTIC_METHOD);
    expect(packet.deterministicMethod).toContain('top score >= 0.8');
    expect(packet.deterministicMethod).toContain('exceed second score by more than 0.05');
    expect(packet.deterministicMethod).toContain('never confirms identity');
    expect(output.markdown).toContain(DETERMINISTIC_METHOD);
    const cloneCluster = packet.clusters.find((cluster: any) => cluster.sourceItems.some((source: any) => source.sourceKey === 'CloneCompanion'));
    expect(cloneCluster.strongProductionCandidates).toHaveLength(1);
    expect(cloneCluster.strongProductionCandidates[0].productionId).toBe('snapshot_139_6fda4e76a4da');
    expect(cloneCluster.conflictingEvidence).not.toContainEqual(expect.stringContaining('Multiple strong'));
    expect(cloneCluster.productionIdentityLink.status).toBe('unresolved');
    expect(cloneCluster.recommendedHumanAction).toBe('insufficient_evidence');
  });

  it('separates LoLCHESS identity support from field follow-up', () => {
    const [cluster] = clusterIdentityReviewItems([item({ itemId: 'opgg:potted', source: 'opgg', sourceKey: 'PottedLifebloom', cost: 3, corpusMembershipConfirmed: true })]);
    addLolchessIdentityEvidence(cluster, { nameEn: 'Potted Lifebloom', cost: 2 });
    expect(cluster.supportingEvidence).toContainEqual(expect.stringContaining('exact displayed-name identity support'));
    expect(cluster.fieldReviewFollowUps).toContainEqual(expect.stringContaining('cost 2'));
    expect(cluster.productionIdentityLink.status).toBe('unresolved');
    expect(cluster.recommendedHumanAction).toBe('insufficient_evidence');
  });
});
