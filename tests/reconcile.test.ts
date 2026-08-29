import { describe, expect, test } from 'vitest';
import { canonicalClientKey, clientVariantKind, reconcileRecords } from '../scripts/data/lib/reconcile';

const production = (id: string, nameEn: string, nameZh: string, effect = '') => ({ id, nameEn, nameZh, category: 'combat', cost: 1, effect });
const opgg = (sourceKey: string, name: string, effect = '', appearanceCondition?: string) => ({ sourceKey, name, category: 'combat', cost: 1, effect, appearanceCondition });

describe('conservative corpus reconciliation', () => {
  test('does not exhaust rows to manufacture a maximal one-to-one intersection', () => {
    const result = reconcileRecords(
      [opgg('A', '甲', 'same'), opgg('B', '乙', 'unrelated'), opgg('C', '丙', 'unrelated')],
      [production('a', 'A', '甲', 'same'), production('x', 'X', '叉', 'different')], [],
    );
    expect(result.confirmedMatches.map(({ productionId }) => productionId)).toEqual(['a']);
    expect(result.candidateMatches).toHaveLength(2);
    expect(result.matchedProduction.has('x')).toBe(false);
  });

  test('close runner-up candidates remain ambiguous and fuzzy signals never confirm', () => {
    const result = reconcileRecords([opgg('Unknown', '未知', '造成100伤害')], [
      production('x', 'X', '叉', '造成100伤害'), production('y', 'Y', '歪', '造成100伤害'),
    ], []);
    expect(result.confirmedMatches).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0]?.bestVsSecondMargin).toBe(0);
  });

  test('normalizes documented base client ids and rejects field variants', () => {
    expect(canonicalClientKey('DA_18_Mitosis')).toBe('mitosis');
    expect(canonicalClientKey('DA_Hireling18')).toBe('hireling');
    expect(canonicalClientKey('DA_Hireling18_Upgrade')).toBeNull();
    expect(canonicalClientKey('DA_Hireling18_Prismatic')).toBeNull();
    expect(clientVariantKind('DA_Hireling18_Prismatic')).toBe('prismatic');
  });

  test('confirms an exact base client identity with auditable evidence', () => {
    const result = reconcileRecords([opgg('Mitosis', '有丝分裂')], [{ ...production('m', 'Mitosis', '有丝分裂'), riotId: 'DA_18_Mitosis' }], [{ apiName: 'DA_18_Mitosis' }, { apiName: 'DA_18_Mitosis_Upgrade' }]);
    expect(result.confirmedMatches).toEqual([expect.objectContaining({ productionId: 'm', matchMethod: 'exact_client_key', confidence: 'confirmed', evidence: expect.objectContaining({ communityDragonApiName: 'DA_18_Mitosis', variantKind: 'base' }) })]);
  });

  test('appearanceCondition does not change identity or auto-confirm corpus membership', () => {
    const conditional = reconcileRecords([opgg('Unknown', '未知', '效果', '已激活某羁绊')], [production('x', 'X', '叉', '别的效果')], []);
    const unconditional = reconcileRecords([opgg('Unknown', '未知', '效果')], [production('x', 'X', '叉', '别的效果')], []);
    expect(conditional.confirmedMatches).toEqual(unconditional.confirmedMatches);
    expect(conditional.candidateMatches[0]?.reasonNotConfirmed).toBe(unconditional.candidateMatches[0]?.reasonNotConfirmed);
  });
});
