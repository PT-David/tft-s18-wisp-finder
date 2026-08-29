import { describe, expect, test } from 'vitest';
import { auditAndDeduplicateClientRecords, canonicalClientKey, clientVariantKind, reconcileRecords } from '../scripts/data/lib/reconcile';

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

  test('safely deduplicates exact and key-order-equivalent client payloads', () => {
    const exact = { apiName: 'DA_ThingamajigJar18', name: 'Thingamajig Jar', desc: 'Gain one.', effects: { Amount: 1 }, tags: ['wisp'], icon: 'jar.png' };
    const equivalentA = { apiName: 'DA_18_Equivalent', name: 'Equivalent', effects: { A: 1, B: 2 } };
    const equivalentB = { name: 'Equivalent', effects: { B: 2, A: 1 }, apiName: 'DA_18_Equivalent' };
    const result = auditAndDeduplicateClientRecords([exact, { ...exact }, equivalentA, equivalentB]);
    expect(result.audit).toMatchObject({ rawRecordCount: 4, rawBaseRows: 4, uniqueBaseApiNames: 2, uniqueCanonicalBaseIdentities: 2, exactDuplicateGroupCount: 1, equivalentDuplicateGroupCount: 1, safelyDeduplicatedRowCount: 2 });
    expect(result.baseIdentityIndex.get('thingamajigjar')?.apiName).toBe('DA_ThingamajigJar18');
  });

  test('conflicting duplicate and canonical collision fail closed', () => {
    const client = [
      { apiName: 'DA_18_Conflict', name: 'Conflict', desc: 'A' }, { apiName: 'DA_18_Conflict', name: 'Conflict', desc: 'B' },
      { apiName: 'DA_18_Collision', name: 'Collision A' }, { apiName: 'DA_Collision18', name: 'Collision B' },
    ];
    const audit = auditAndDeduplicateClientRecords(client);
    expect(audit.audit).toMatchObject({ conflictingDuplicateGroupCount: 1, canonicalCollisionCount: 1, uniqueCanonicalBaseIdentities: 0 });
    const result = reconcileRecords([opgg('Conflict', '冲突'), opgg('Collision', '碰撞')], [
      { ...production('c1', 'Conflict', '冲突'), riotId: 'DA_18_Conflict' }, { ...production('c2', 'Collision', '碰撞'), riotId: 'DA_18_Collision' },
    ], client);
    expect(result.confirmedMatches.filter(({ matchMethod }) => matchMethod === 'exact_client_key')).toHaveLength(0);
  });

  test('real duplicate shapes preserve Thingamajig Jar and Mitosis base identities only', () => {
    const jar = { apiName: 'DA_ThingamajigJar18', name: 'Thingamajig Jar', desc: 'Gain one.' };
    const mitosis = { apiName: 'DA_18_Mitosis', name: 'Mitosis', desc: 'Copy.' };
    const upgrade = { apiName: 'DA_18_Mitosis_Upgrade', name: 'Mitosis', desc: 'Copy.' };
    const result = reconcileRecords([opgg('ThingamajigJar', 'Thingamajig 罐子'), opgg('Mitosis', '有丝分裂')], [
      { ...production('jar', 'Thingamajig Jar', '小装置罐'), riotId: 'da_thingamajigjar18' },
      { ...production('mitosis', 'Mitosis', '有丝分裂'), riotId: 'da_18_mitosis' },
    ], [jar, { ...jar }, mitosis, { ...mitosis }, upgrade, { ...upgrade }]);
    expect(result.confirmedMatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ opggSourceKey: 'ThingamajigJar', productionId: 'jar', matchMethod: 'exact_client_key' }),
      expect.objectContaining({ opggSourceKey: 'Mitosis', productionId: 'mitosis', matchMethod: 'exact_client_key' }),
    ]));
    expect(result.candidateMatches).toHaveLength(0);
    expect(result.clientAudit).toMatchObject({ rawBaseRows: 4, rawUpgradeRows: 2, uniqueBaseApiNames: 2, uniqueUpgradeApiNames: 1 });
  });
});
