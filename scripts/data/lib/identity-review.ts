export type ReviewAction = 'same_identity' | 'distinct_identity' | 'source_variant' | 'obsolete_or_non_live_candidate' | 'insufficient_evidence';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';

export type ReviewItem = {
  itemId: string;
  source: 'opgg' | 'datatft' | 'communitydragon' | 'lolchess';
  sourceKey: string;
  name: string;
  category?: string | null;
  cost?: number | null;
  effect?: string | null;
  canonicalClientKey?: string | null;
  apiName?: string | null;
  corpusMembershipConfirmed?: boolean;
  productionCandidates?: Array<{ productionId: string; name?: string; score?: number; evidence?: string[] }>;
  exactProductionId?: string | null;
  variantOfProductionId?: string | null;
  variantType?: string | null;
  overlapKeys?: string[];
};

export type IdentityReviewCluster = {
  clusterId: string;
  priority: Priority;
  currentQuestion: string;
  sourceItems: ReviewItem[];
  productionCandidates: Array<{ productionId: string; name?: string; score?: number; evidence?: string[] }>;
  corpusMembership: { status: 'confirmed' | 'unresolved'; evidence: string[] };
  productionIdentityLink: { status: 'confirmed' | 'unresolved'; productionId?: string; confirmingEvidence: string[] };
  exactEvidence: string[];
  supportingEvidence: string[];
  conflictingEvidence: string[];
  recommendedHumanAction: ReviewAction;
  recommendedProductionId?: string;
  variant?: { baseProductionId: string; type: string; reason: string };
  confidence: 'strong' | 'supporting_only' | 'low';
  requiresGenuineHumanJudgement: boolean;
  insufficientEvenForHumanDecision: boolean;
  reasonHumanReviewRequired: string;
  allowedChoices: ReviewAction[];
};

const norm = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9\p{L}\p{N}]/gu, '');

class DisjointSet {
  private parent: number[];
  constructor(size: number) { this.parent = Array.from({ length: size }, (_, index) => index); }
  find(index: number): number { return this.parent[index] === index ? index : (this.parent[index] = this.find(this.parent[index])); }
  union(left: number, right: number) { const a = this.find(left); const b = this.find(right); if (a !== b) this.parent[Math.max(a, b)] = Math.min(a, b); }
}

/** Clustering only creates review neighborhoods. It never confirms a fuzzy identity link. */
export function clusterIdentityReviewItems(input: ReviewItem[]): IdentityReviewCluster[] {
  const items = [...input].sort((a, b) => a.itemId.localeCompare(b.itemId, 'en'));
  const sets = new DisjointSet(items.length);
  const owners = new Map<string, number>();
  items.forEach((item, index) => {
    const keys = [item.sourceKey, item.canonicalClientKey, item.apiName, ...(item.overlapKeys ?? [])]
      .map(norm).filter(Boolean);
    for (const key of keys) {
      const owner = owners.get(key);
      if (owner === undefined) owners.set(key, index); else sets.union(owner, index);
    }
  });
  const groups = new Map<number, ReviewItem[]>();
  items.forEach((item, index) => groups.set(sets.find(index), [...(groups.get(sets.find(index)) ?? []), item]));
  const ordered = [...groups.values()].sort((a, b) => {
    const rank = (group: ReviewItem[]) => group.some((row) => row.source === 'datatft') ? 0 : group.some((row) => row.corpusMembershipConfirmed) ? 1 : group.some((row) => row.variantOfProductionId) ? 2 : 3;
    return rank(a) - rank(b) || a[0].sourceKey.localeCompare(b[0].sourceKey, 'en');
  });
  return ordered.map((sourceItems, index) => makeCluster(sourceItems, `C4I-${String(index + 1).padStart(3, '0')}`));
}

function makeCluster(sourceItems: ReviewItem[], clusterId: string): IdentityReviewCluster {
  const exact = sourceItems.filter((row) => row.exactProductionId);
  const variants = sourceItems.filter((row) => row.variantOfProductionId);
  const exactTargets = [...new Set(exact.map((row) => row.exactProductionId!))];
  const candidateMap = new Map<string, { productionId: string; name?: string; score?: number; evidence?: string[] }>();
  for (const item of sourceItems) for (const candidate of item.productionCandidates ?? []) {
    const prior = candidateMap.get(candidate.productionId);
    if (!prior || (candidate.score ?? 0) > (prior.score ?? 0)) candidateMap.set(candidate.productionId, candidate);
  }
  const productionCandidates = [...candidateMap.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.productionId.localeCompare(b.productionId, 'en'));
  const membershipConfirmed = sourceItems.some((row) => row.corpusMembershipConfirmed);
  let action: ReviewAction = 'insufficient_evidence';
  let recommendedProductionId: string | undefined;
  let variant: IdentityReviewCluster['variant'];
  const confirmingEvidence: string[] = [];
  if (exactTargets.length === 1) {
    action = 'same_identity'; recommendedProductionId = exactTargets[0];
    confirmingEvidence.push(...exact.map((row) => `${row.source}:${row.sourceKey} exact client/reviewed identity key -> ${row.exactProductionId}`));
  } else if (!exact.length && variants.length && new Set(variants.map((row) => row.variantOfProductionId)).size === 1) {
    action = 'source_variant';
    variant = { baseProductionId: variants[0].variantOfProductionId!, type: variants[0].variantType ?? 'source representation', reason: 'Source metadata explicitly identifies a non-base representation; it is not a separate corpus member.' };
  }
  const priority: Priority = sourceItems.some((row) => row.source === 'datatft') ? 'P0' : membershipConfirmed ? 'P1' : variants.length ? 'P2' : 'P3';
  const labels = sourceItems.map((row) => `${row.source}「${row.name}」`).join('、');
  const supportingEvidence = sourceItems.flatMap((row) => (row.productionCandidates ?? []).slice(0, 3).map((candidate) => `${row.source}:${row.sourceKey} ranks ${candidate.productionId} at ${candidate.score ?? 'n/a'}; ranking is supporting evidence only.`));
  const genuine = priority === 'P0' || priority === 'P1' || action !== 'insufficient_evidence';
  return {
    clusterId, priority, currentQuestion: `${labels} 是否属于同一个真实 Wisp；若不是，是否表明 production 缺少 live 18.1 Wisp？`, sourceItems,
    productionCandidates, corpusMembership: { status: membershipConfirmed ? 'confirmed' : 'unresolved', evidence: sourceItems.filter((row) => row.corpusMembershipConfirmed).map((row) => `${row.source}:${row.sourceKey} has committed OP.GG + canonical client base evidence.`) },
    productionIdentityLink: { status: action === 'same_identity' ? 'confirmed' : 'unresolved', ...(recommendedProductionId ? { productionId: recommendedProductionId } : {}), confirmingEvidence },
    exactEvidence: confirmingEvidence, supportingEvidence,
    conflictingEvidence: exactTargets.length > 1 ? [`Conflicting exact targets: ${exactTargets.join(', ')}`] : productionCandidates.length > 1 ? ['Multiple production candidates remain plausible; similarity ranking cannot confirm identity.'] : [],
    recommendedHumanAction: action, ...(recommendedProductionId ? { recommendedProductionId } : {}), ...(variant ? { variant } : {}),
    confidence: action === 'same_identity' || action === 'source_variant' ? 'strong' : supportingEvidence.length ? 'supporting_only' : 'low',
    requiresGenuineHumanJudgement: genuine, insufficientEvenForHumanDecision: !genuine,
    reasonHumanReviewRequired: action === 'insufficient_evidence' ? (membershipConfirmed ? 'Corpus membership is confirmed, but no policy-compliant production identity link exists.' : 'Only candidate-generating or fuzzy evidence exists; it cannot confirm membership or identity.') : 'The recommendation is evidence-backed but remains a recommendation; no review decision is applied by this packet.',
    allowedChoices: ['same_identity', 'distinct_identity', 'source_variant', 'obsolete_or_non_live_candidate', 'insufficient_evidence'],
  };
}
