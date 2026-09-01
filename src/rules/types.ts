import type { WispCategory } from '../domain/types';

export const BLOSSOM_EFFECTS = ['upgraded_wisps', 'wisp_every_shop', 'gain_gold_after_purchase', 'two_purchases_per_round', 'prismatic_wisps'] as const;
export type BlossomEffect = typeof BLOSSOM_EFFECTS[number];
export const UNCONFIRMED_REAL_MODELS = ['category_then_wisp', 'equal_weight_all_eligible', 'fixed_hidden_weight_per_wisp'] as const;
export type UnconfirmedRealModel = typeof UNCONFIRMED_REAL_MODELS[number];

export interface WispRuleDataset {
  patch: string;
  official: {
    categories: WispCategory[];
    wispShopInterval: number;
    defaultPurchasesPerRound: number;
    rightmostShopSlot: boolean;
    planningPhaseOnly: boolean;
    lateGameCombatGuarantee: { startStage: number; everyNthWisp: number; interpretation: string };
    blossom: Record<string, BlossomEffect>;
  };
  observedNotOfficial: {
    defaultReofferCooldownShops: number;
    itemWispReofferCooldownShops: number;
    playerHealWispReofferCooldownShops: number;
    affordabilityRestriction: 'supported_by_observation_not_officially_fully_specified';
  };
  probabilityModel: {
    v1: 'equal_weight_among_currently_eligible_wisps';
    isClaimedRealGameProbability: false;
    autoTracksRecentShopCooldowns: boolean;
    manualExclusionSupported: boolean;
    unconfirmedRealModels: UnconfirmedRealModel[];
  };
}
