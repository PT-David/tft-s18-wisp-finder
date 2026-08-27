import type { Wisp } from '../domain/types';

export interface ProbabilityResult { poolSize: number; targetCount: number; targetProbability: number; perWispProbability: number }
export type StageFiveSlot = 'ordinary' | 'forced_combat' | 'uncertain';

export function calculateEqualWeight(pool: readonly Wisp[], targetIds: ReadonlySet<string>): ProbabilityResult {
  const targetCount = pool.filter((wisp) => targetIds.has(wisp.id)).length;
  return { poolSize: pool.length, targetCount, targetProbability: pool.length ? targetCount / pool.length : 0,
    perWispProbability: pool.length ? 1 / pool.length : 0 };
}

export function calculateStageFive(pool: readonly Wisp[], targets: ReadonlySet<string>, slot: StageFiveSlot) {
  const ordinary = calculateEqualWeight(pool, targets);
  const combatPool = pool.filter((wisp) => wisp.category === 'combat');
  const forcedCombat = calculateEqualWeight(combatPool, targets);
  if (slot === 'ordinary') return { mode: slot, ordinary } as const;
  if (slot === 'forced_combat') return { mode: slot, forcedCombat } as const;
  return { mode: slot, ordinary, forcedCombat } as const;
}

export function probabilityForWisp(wisp: Wisp, pool: readonly Wisp[], slot: Exclude<StageFiveSlot, 'uncertain'>): number {
  if (slot === 'forced_combat' && wisp.category !== 'combat') return 0;
  const eligible = slot === 'forced_combat' ? pool.filter((item) => item.category === 'combat') : pool;
  return eligible.some((item) => item.id === wisp.id) && eligible.length ? 1 / eligible.length : 0;
}
