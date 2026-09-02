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
  rankedProductionCandidates: Array<{ productionId: string; name?: string; score?: number; evidence?: string[] }>;
  reviewRelevantProductionCandidates: Array<{ productionId: string; name?: string; score?: number; evidence?: string[] }>;
  strongProductionCandidates: Array<{ productionId: string; name?: string; score?: number; evidence?: string[] }>;
  corpusMembership: { status: 'confirmed' | 'unresolved'; evidence: string[] };
  productionIdentityLink: { status: 'confirmed' | 'unresolved'; productionId?: string; confirmingEvidence: string[] };
  exactEvidence: string[];
  supportingEvidence: string[];
  conflictingEvidence: string[];
  fieldReviewFollowUps: string[];
  recommendedHumanAction: ReviewAction;
  recommendedProductionId?: string;
  variant?: { baseProductionId: string; type: string; reason: string };
  confidence: 'strong' | 'supporting_only' | 'low';
  requiresGenuineHumanJudgement: boolean;
  notCurrentlyActionableFromCommittedEvidence: boolean;
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
  const rankedCandidates = [...candidateMap.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.productionId.localeCompare(b.productionId, 'en'));
  // This threshold controls review presentation only; it can never confirm an identity.
  const reviewRelevantCandidates = rankedCandidates.filter((candidate) => (candidate.score ?? 0) >= 0.2);
  const strongCandidates = reviewRelevantCandidates.filter((candidate) => (candidate.score ?? 0) >= 0.8);
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
  const question = currentQuestion(priority, sourceItems);
  const supportingEvidence = reviewRelevantCandidates.map((candidate) => `Ranked candidate ${candidate.productionId} scores ${candidate.score ?? 'n/a'}; this is review-relevant supporting evidence only.`);
  const genuine = priority === 'P0' || priority === 'P1' || action !== 'insufficient_evidence';
  return {
    clusterId, priority, currentQuestion: question, sourceItems,
    rankedProductionCandidates: rankedCandidates, reviewRelevantProductionCandidates: reviewRelevantCandidates, strongProductionCandidates: strongCandidates,
    corpusMembership: { status: membershipConfirmed ? 'confirmed' : 'unresolved', evidence: sourceItems.filter((row) => row.corpusMembershipConfirmed).map((row) => `${row.source}:${row.sourceKey} has committed OP.GG + canonical client base evidence.`) },
    productionIdentityLink: { status: action === 'same_identity' ? 'confirmed' : 'unresolved', ...(recommendedProductionId ? { productionId: recommendedProductionId } : {}), confirmingEvidence },
    exactEvidence: confirmingEvidence, supportingEvidence,
    conflictingEvidence: exactTargets.length > 1 ? [`Conflicting exact targets: ${exactTargets.join(', ')}`] : strongCandidates.length > 1 ? ['Multiple strong, review-relevant production targets remain; ranking cannot confirm identity.'] : ['No policy-compliant production identity link exists.'],
    fieldReviewFollowUps: [],
    recommendedHumanAction: action, ...(recommendedProductionId ? { recommendedProductionId } : {}), ...(variant ? { variant } : {}),
    confidence: action === 'same_identity' || action === 'source_variant' ? 'strong' : supportingEvidence.length ? 'supporting_only' : 'low',
    requiresGenuineHumanJudgement: genuine, notCurrentlyActionableFromCommittedEvidence: !genuine,
    reasonHumanReviewRequired: action === 'insufficient_evidence' ? (membershipConfirmed ? 'Corpus membership is confirmed, but no policy-compliant production identity link exists.' : 'Only candidate-generating or fuzzy evidence exists; it cannot confirm membership or identity.') : 'The recommendation is evidence-backed but remains a recommendation; no review decision is applied by this packet.',
    allowedChoices: ['same_identity', 'distinct_identity', 'source_variant', 'obsolete_or_non_live_candidate', 'insufficient_evidence'],
  };
}

function currentQuestion(priority: Priority, items: ReviewItem[]): string {
  const dataTft = items.find((row) => row.source === 'datatft');
  const confirmed = items.find((row) => row.source === 'opgg' && row.corpusMembershipConfirmed) ?? items.find((row) => row.source === 'communitydragon');
  const opgg = items.find((row) => row.source === 'opgg');
  if (priority === 'P0' && dataTft) {
    const identity = confirmed?.sourceKey ?? confirmed?.name ?? 'confirmed source identity';
    return `DataTFT「${dataTft.name}」是否就是 OP.GG / CommunityDragon 已确认的 ${identity}；如果不是，${identity} 是否代表 production 缺失的 live Wisp？`;
  }
  if (priority === 'P1' && confirmed) {
    return `已确认的 ${confirmed.sourceKey} live corpus identity 对应当前 production 哪一条；如果没有匹配，是否说明 production 缺少该 Wisp？`;
  }
  if (priority === 'P3' && opgg) {
    return `OP.GG ${opgg.sourceKey} 是否对应现有 production Wisp、属于 source variant / obsolete/non-live row，还是可能代表缺失的 live Wisp？`;
  }
  return `${items.map((row) => `${row.source}「${row.name}」`).join('、')} 应如何链接 production identity？`;
}

export function addLolchessIdentityEvidence(cluster: IdentityReviewCluster, row: { nameEn?: string; name?: string; cost?: number | null; category?: string | null }) {
  const name = row.nameEn ?? row.name ?? 'unknown';
  cluster.supportingEvidence.push(`LoLCHESS exact displayed-name identity support: ${name}; this does not confirm the production link.`);
  const sourceCosts = [...new Set(cluster.sourceItems.filter((item) => item.source === 'opgg' || item.source === 'communitydragon').map((item) => item.cost).filter((cost): cost is number => typeof cost === 'number'))];
  if (typeof row.cost === 'number' && sourceCosts.some((cost) => cost !== row.cost)) {
    cluster.fieldReviewFollowUps.push(`Defer to C4.2B field review: LoLCHESS cost ${row.cost} conflicts with OP.GG/CommunityDragon cost ${sourceCosts.join('/')}.`);
  }
  const sourceCategories = [...new Set(cluster.sourceItems.filter((item) => item.source === 'opgg' || item.source === 'communitydragon').map((item) => item.category).filter((category): category is string => Boolean(category)))];
  if (row.category && sourceCategories.some((category) => norm(category) !== norm(row.category))) {
    cluster.fieldReviewFollowUps.push(`Defer to C4.2B field review: LoLCHESS category ${row.category} conflicts with OP.GG/CommunityDragon category ${sourceCategories.join('/')}.`);
  }
}
