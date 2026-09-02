import { describe, expect, it } from 'vitest';
import { clusterIdentityReviewItems, type ReviewItem } from '../scripts/data/lib/identity-review';

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
  });

  it('is byte-for-byte deterministic for reordered input', () => {
    const input = [item({ itemId: 'opgg:b', source: 'opgg', sourceKey: 'B' }), item({ itemId: 'opgg:a', source: 'opgg', sourceKey: 'A' })];
    expect(JSON.stringify(clusterIdentityReviewItems(input))).toBe(JSON.stringify(clusterIdentityReviewItems([...input].reverse())));
  });
});
