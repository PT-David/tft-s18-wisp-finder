import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { alignCatalogRows, classifyCatalogRow } from '../scripts/data/lib/catalog-delta';
import { buildCatalogDeltaReconciliation } from '../scripts/data/catalog-delta-reconciliation-18.1';

const client = (apiName: string, name: string) => ({ apiName, name });
describe('catalog delta reconciliation', () => {
  it('classifies an appended new base row', () => expect(classifyCatalogRow({ sourceIndex: 1, nameEn: 'New' }, [client('DA_New18', 'New')], [])).toMatchObject({ classification: 'missing_base_identity_candidate', baseIdentityKey: 'DA_New18' }));
  it('classifies an existing identity newly exposed', () => expect(classifyCatalogRow({ sourceIndex: 1, nameEn: 'Known' }, [client('DA_Known18', 'Known')], [{ id: 'known', riotId: 'DA_Known18' }])).toMatchObject({ classification: 'existing_base_identity_already_in_production', productionMatches: ['known'] }));
  it('counts an explicit upgrade as a variant of one base family', () => { const clients = [client('DA_X18', 'X'), client('DA_X18_Upgrade', 'Y')]; expect(classifyCatalogRow({ sourceIndex: 1, nameEn: 'X' }, clients, []).baseIdentityKey).toBe('DA_X18'); expect(classifyCatalogRow({ sourceIndex: 2, nameEn: 'Y' }, clients, [])).toMatchObject({ classification: 'upgrade_or_variant_of_base_identity', baseIdentityKey: 'DA_X18' }); });
  it('aligns an insertion without treating subsequent ordinal shifts as new identities', () => { const result = alignCatalogRows([{ sourceIndex: 0, nameEn: 'A' }, { sourceIndex: 1, nameEn: 'B' }], [{ sourceIndex: 0, nameEn: 'A' }, { sourceIndex: 1, nameEn: 'Inserted' }, { sourceIndex: 2, nameEn: 'B' }]); expect(result.summary).toMatchObject({ unchangedRows: 1, shiftedRows: 1, freshOnlyRows: 1 }); expect(result.freshOnly[0]?.nameEn).toBe('Inserted'); });
  it('recognizes a rename only through stable identity', () => expect(alignCatalogRows([{ sourceIndex: 0, nameEn: 'Old', stableIdentity: 'DA_X18' }], [{ sourceIndex: 0, nameEn: 'New', stableIdentity: 'DA_X18' }]).mappings[0]?.status).toBe('renamed'));
  it('leaves rows without stable evidence unresolved', () => expect(classifyCatalogRow({ sourceIndex: 0, nameEn: 'Mystery' }, [], []).classification).toBe('unresolved'));
  it('resolves the committed Bear/Tiger English collision with bilingual evidence', async () => { const source = JSON.parse(await readFile('data/raw/18.1/communitydragon-wisps-en.json', 'utf8')).records; const report = JSON.parse((await buildCatalogDeltaReconciliation()).json); expect(source.find((row: any) => row.apiName === 'DA_BearsVisit18')?.name).toBe("Bear's Visit"); expect(source.find((row: any) => row.apiName === 'DA_BearsVisit18_Upgrade')?.name).toBe("Tiger's Visit"); expect(report.freshOnlyOrChangedRows.find((row: any) => row.nameEn === "Tiger's Visit")).toMatchObject({ nameZh: '战马降临', classification: 'missing_base_identity_candidate', baseIdentityKey: 'DA_TigersVisit18_Wisp' }); });
  it('is byte-for-byte deterministic', async () => expect(await buildCatalogDeltaReconciliation()).toEqual(await buildCatalogDeltaReconciliation()));
});
