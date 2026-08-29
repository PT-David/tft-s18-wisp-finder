import { describe, expect, test } from 'vitest';
import { confirmedCorpusMinimum, requirementFacts, requirementsManualReview } from '../scripts/data/lib/audit';

describe('Stage C1 audit calculations', () => {
  test.each([
    [169, 1, 6, 174],
    [169, 6, 6, 169],
    [169, 0, 6, 175],
    [169, 4, 0, 169],
  ])('computes conservative corpus minimum for production=%i unmatched=%i incomplete=%i', (production, unmatched, incomplete, expected) => {
    expect(confirmedCorpusMinimum(production, unmatched, incomplete)).toBe(expected);
  });

  test.each([
    ['at least 20 gold', [{ type: 'gold', operator: '>=', value: 20 }]],
    ['at least 30 player health', [{ type: 'player_health', operator: '>=', value: 30 }]],
    ['至少拥有20金币', [{ type: 'gold', operator: '>=', value: 20 }]],
    ['生命值至少30', [{ type: 'player_health', operator: '>=', value: 30 }]],
    ['at least 20 gold; at least 30 player HP', [{ type: 'gold', operator: '>=', value: 20 }, { type: 'player_health', operator: '>=', value: 30 }]],
  ])('extracts requirement fields without cross-field matches: %s', (input, expected) => {
    expect(requirementFacts([input])).toEqual(expected);
  });

  test('unions semantic review rows and aggregates reasons once per identity', () => {
    const presence = [{ identity: 'a', status: 'semantic_review_required' }];
    const structured = [{ identity: 'a', status: 'structured_conflict' }];
    const semantic = [{ identity: 'a', status: 'semantic_review_required' }, { identity: 'b', status: 'semantic_review_required' }];
    expect(requirementsManualReview(presence, structured, semantic)).toEqual([
      { row: presence[0], reviewReasons: ['presence_conflict', 'structured_conflict', 'semantic_review_required'] },
      { row: semantic[1], reviewReasons: ['semantic_review_required'] },
    ]);
  });
});
