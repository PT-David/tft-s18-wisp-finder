export const WISP_CATEGORIES = ['champion', 'combat', 'misc', 'shop', 'gold_xp', 'risky', 'item'] as const;
export type WispCategory = typeof WISP_CATEGORIES[number];
export const CONFIDENCES = ['official', 'client_data', 'verified_third_party', 'community_high_confidence', 'unverified'] as const;
export type Confidence = typeof CONFIDENCES[number];
export type RequirementOperator = '>' | '>=' | '<' | '<=' | '=' | '!=' | 'in' | 'active' | 'inactive';
export interface StagePoint { stage: number; round: number }
export interface StageRange { start: StagePoint; end: StagePoint }
export interface Requirement {
  type: string; operator?: RequirementOperator; value?: number | string | boolean | string[];
  textZh: string; textEn?: string; machineEvaluable: boolean;
}
export interface FieldSource { sourceId: string; verifiedAt: string; confidence: Confidence }
export type Knowledge<T> = { status: 'unknown' } | { status: 'confirmed'; value: T };
export type KnowledgeInput<T> = Knowledge<T> | T | null | undefined;
export const knownValue = <T>(input: KnowledgeInput<T>): T | undefined => {
  if (input && typeof input === 'object' && 'status' in input) return input.status === 'confirmed' ? input.value : undefined;
  return input === null || input === undefined ? undefined : input;
};
export interface Wisp {
  id: string; riotId?: string | null; nameZh: string; nameEn: string; category: WispCategory;
  cost: number; minimumAffordableGold?: number | null; stageRanges: StageRange[];
  effects: { normal: string; blossom?: string | null; prismatic?: string | null };
  requirements: Requirement[]; oncePerGame: KnowledgeInput<boolean>; reofferCooldownShops?: KnowledgeInput<number | null>;
  searchConcepts: string[]; synonyms: string[]; sources: Record<string, FieldSource>; patch: '18.1';
}
export interface WispDataset {
  patch: string; datasetStatus?: string; warning?: string; verifiedAt?: string; records: Wisp[];
}
