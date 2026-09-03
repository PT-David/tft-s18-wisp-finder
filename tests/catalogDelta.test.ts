import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { alignCatalogRows, classifyCatalogRow, deriveC4PriorityImpact } from '../scripts/data/lib/catalog-delta';
import { buildCatalogDeltaReconciliation } from '../scripts/data/catalog-delta-reconciliation-18.1';

const client = (apiName: string, name: string, nameZh?: string) => ({ apiName, name, nameZh });
describe('catalog delta reconciliation', () => {
  it('classifies an appended new base row', () => expect(classifyCatalogRow({ sourceIndex: 1, nameEn: 'New' }, [client('DA_New18', 'New')], [])).toMatchObject({ classification: 'missing_base_identity_candidate', baseIdentityKey: 'DA_New18' }));
  it('classifies an existing identity newly exposed', () => expect(classifyCatalogRow({ sourceIndex: 1, nameEn: 'Known' }, [client('DA_Known18', 'Known')], [{ id: 'known', riotId: 'DA_Known18' }])).toMatchObject({ classification: 'existing_base_identity_already_in_production', productionMatches: ['known'] }));
  it('uses a reviewed stable mapping even when display names differ', () => expect(classifyCatalogRow(
    { sourceIndex: 1, nameEn: 'Fresh Name' }, [client('DA_Fresh18', 'Fresh Name')], [{ id: 'legacy', nameEn: 'Old Name' }],
    [{ productionId: 'legacy', communityDragonId: 'DA_Fresh18', canonicalNameEn: 'Old Name' }],
  )).toMatchObject({ classification: 'existing_base_identity_already_in_production', productionMatches: ['legacy'], reviewedMappingMatches: ['legacy'] }));
  it('counts an explicit upgrade as a variant of one base family', () => {
    const clients = [client('DA_X18', 'X'), client('DA_X18_Upgrade', 'Y')];
    expect(classifyCatalogRow({ sourceIndex: 1, nameEn: 'X' }, clients, []).baseIdentityKey).toBe('DA_X18');
    expect(classifyCatalogRow({ sourceIndex: 2, nameEn: 'Y' }, clients, [])).toMatchObject({ classification: 'upgrade_or_variant_of_base_identity', baseIdentityKey: 'DA_X18' });
  });
  it('aligns an insertion without treating subsequent ordinal shifts as new identities', () => {
    const result = alignCatalogRows([{ sourceIndex: 0, nameZh: '甲' }, { sourceIndex: 1, nameZh: '乙' }], [{ sourceIndex: 0, nameZh: '甲' }, { sourceIndex: 1, nameZh: '插入' }, { sourceIndex: 2, nameZh: '乙' }]);
    expect(result.summary).toMatchObject({ unchangedRows: 1, shiftedRows: 1, freshOnlyRows: 1 }); expect(result.freshOnly[0]?.nameZh).toBe('插入');
  });
  it('recognizes a rename only through stable identity', () => expect(alignCatalogRows([{ sourceIndex: 0, nameZh: '旧', stableIdentity: 'DA_X18' }], [{ sourceIndex: 0, nameZh: '新', stableIdentity: 'DA_X18' }]).mappings[0]?.status).toBe('renamed'));
  it('does not greedily align duplicate shared-locale names', () => {
    const result = alignCatalogRows([{ sourceIndex: 0, nameZh: '重复' }, { sourceIndex: 1, nameZh: '重复' }], [{ sourceIndex: 0, nameZh: '重复' }, { sourceIndex: 1, nameZh: '重复' }]);
    expect(result.mappings.every((row) => row.status === 'ambiguous')).toBe(true); expect(result.ambiguousFresh).toHaveLength(2); expect(result.freshOnly).toHaveLength(0);
  });
  it('leaves rows without stable evidence unresolved', () => expect(classifyCatalogRow({ sourceIndex: 0, nameEn: 'Mystery' }, [], []).classification).toBe('unresolved'));
  it('derives P1 impact and stops supporting it when the evidence row is removed or changed', () => {
    const supported = [{ affectsC4Cluster: 'C4I-002', classification: 'missing_base_identity_candidate' as const, communityDragon: { baseApiName: 'DA_MemorialDummy18' } }];
    expect(deriveC4PriorityImpact('C4I-002', 'MemorialDummy', [], supported).impact).toBe('supported');
    expect(deriveC4PriorityImpact('C4I-002', 'MemorialDummy', [], []).impact).toBe('unresolved');
    expect(deriveC4PriorityImpact('C4I-002', 'MemorialDummy', [], [{ ...supported[0]!, classification: 'existing_base_identity_already_in_production' }]).impact).toBe('weakened');
  });
  it('requires exact row-139 continuity for C4I-001 support', () => {
    expect(deriveC4PriorityImpact('C4I-001', 'CloneCompanion', [{ oldIndex: 139, freshIndex: 139, status: 'unchanged' }], []).impact).toBe('supported');
    expect(deriveC4PriorityImpact('C4I-001', 'CloneCompanion', [{ oldIndex: 139, freshIndex: 140, status: 'shifted' }], []).impact).toBe('weakened');
  });
  it('resolves committed fresh Bear/Tiger evidence using Chinese display identity', async () => {
    const focused = JSON.parse(await readFile('data/raw/18.1/20260902/communitydragon-bear-tiger.json', 'utf8'));
    const report = JSON.parse((await buildCatalogDeltaReconciliation()).json);
    expect(focused.locales.en_us.records.find((row: any) => row.apiName === 'DA_BearsVisit18_Upgrade')?.name).toBe("Tiger's Visit");
    expect(focused.locales.zh_cn.records.find((row: any) => row.apiName === 'DA_BearsVisit18_Upgrade')?.name).toBe('猛虎降临');
    expect(report.freshOnlyOrChangedRows.find((row: any) => row.nameEn === "Tiger's Visit")).toMatchObject({ nameZh: '战马降临', classification: 'existing_base_identity_already_in_production', baseIdentityKey: 'DA_TigersVisit18_Wisp' });
  });
  it('asserts no current delta row has a reviewed production target', async () => {
    const report = JSON.parse((await buildCatalogDeltaReconciliation()).json);
    expect(report.freshOnlyOrChangedRows).toHaveLength(7); expect(report.freshOnlyOrChangedRows.every((row: any) => row.reviewedMappingMatches.length === 0)).toBe(true);
  });
  it('is byte-for-byte deterministic', async () => expect(await buildCatalogDeltaReconciliation()).toEqual(await buildCatalogDeltaReconciliation()));
});
