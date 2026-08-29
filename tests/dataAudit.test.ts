import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { validateProvenanceSources } from '../scripts/validate-data';

const load = <T>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T;

describe('Stage C1 production audit regressions', () => {
  const dataset = load<{ records: Array<Record<string, any>> }>('data/normalized/wisps_18.1.json');

  test('corpus discrepancy is reported from source observations', () => {
    const report = load<any>('reports/data-corpus-diff-18.1.json');
    expect(report.categoryCountBySource.datatft).not.toEqual(report.categoryCountBySource.opgg);
    expect(report.confirmedMatches.every((match: any) => ['exact_client_key','exact_english_name','exact_chinese_name','reviewed_cross_source_identity'].includes(match.matchMethod))).toBe(true);
    expect(report.confirmedMatches.every((match: any) => match.confidence === 'confirmed' && match.evidence)).toBe(true);
    expect(report.candidateMatches.every((match: any) => match.reasonNotConfirmed && !match.productionId)).toBe(true);
    expect(report.confirmedIntersection).toBe(report.confirmedMatches.length);
    expect(report.dataTftUnmatched.length).toBeGreaterThan(0);
    expect(report).not.toHaveProperty('dataTftOnlyConfirmed');
    expect(report.confirmedCorpusMembership.minimum).toBeGreaterThan(0);
    expect(report.normalizedProductionCompleteness.complete).toBe(false);
    expect(report.unresolved.opgg.length).toBeGreaterThan(0);
  });

  test('CommunityDragon raw rows, deduplicated APIs, and canonical identities are audited separately', () => {
    const audit = load<any>('reports/data-communitydragon-identity-audit-18.1.json');
    expect(audit.rawBaseRows + audit.rawUpgradeRows + audit.rawPrismaticRows).toBe(audit.rawRecordCount);
    expect(audit.uniqueCanonicalBaseIdentities).toBeLessThanOrEqual(audit.uniqueBaseApiNames);
    expect(audit.safelyDeduplicatedRowCount).toBe(audit.duplicateGroups.filter((group: any) => group.payloadStatus !== 'conflicting_duplicate').reduce((sum: number, group: any) => sum + group.count - 1, 0));
    expect(audit.canonicalCollisions).toHaveLength(audit.canonicalCollisionCount);
  });

  test('a base without a distinct Upgrade variant has no Blossom', () => {
    const mitosis = dataset.records.find((record) => record.nameEn === 'Mitosis')!;
    expect(mitosis.effects.blossom).toBeNull();
    const variants = load<any>('reports/data-communitydragon-variants-18.1.json');
    expect(variants.baseVariants + variants.upgradeVariants + variants.prismaticVariants).toBe(variants.totalVariants);
  });

  test('Prismatic sources are compared record by record instead of forcing a count', () => {
    const audit = load<any>('reports/data-prismatic-audit-18.1.json');
    expect(audit.counts).toEqual({ dataTft: 20, communityDragon: 19, lolchess: 19 });
    expect(audit.status).toBe('needs_review');
    expect(audit.historicalObservation.status).toContain('superseded');
    expect(audit.fieldConflict.some((row: any) => row.nameZh === '休战' && row.nameEn === 'Truce')).toBe(true);
    expect(audit.sourceOnly.some((row: any) => row.nameZh === '休战')).toBe(false);
  });

  test('audits LoLCHESS field coverage and applies explicit knowledge evidence', () => {
    const audit = load<any>('reports/data-lolchess-field-audit-18.1.json');
    expect(audit.sourceCount).toBe(174);
    expect(audit.blossom.lolchessCount).toBe(145);
    expect(audit.requirements.lolchessCount).toBe(60);
    expect(audit.requirements.presenceAgreement.length).toBeGreaterThan(0);
    expect(audit.requirements.presenceConflict.length).toBeGreaterThan(0);
    expect(audit.requirements.structuredComparison.length).toBeGreaterThan(0);
    expect(audit.blossom.presenceConflict.map((row: any) => row.nameEn)).toEqual(expect.arrayContaining(['Bronze Spoon', 'Experienced']));
    expect(audit.stageRanges.compared).toBe(audit.exactEnglishIdentityMatches);
    expect(audit.oncePerGame.lolchessConfirmed).toEqual(['Blood Ritual', 'Hero Of Prophecy']);
    const hero = dataset.records.find((record) => record.nameEn === 'Hero Of Prophecy')!;
    expect(hero.oncePerGame).toEqual({ status: 'confirmed', value: true });
    expect(hero.sources.oncePerGame.sourceId).toContain('lolchess');
    const bloodRitual = dataset.records.find((record) => record.nameEn === 'Blood Ritual')!;
    expect(bloodRitual.oncePerGame).toEqual({ status: 'confirmed', value: true });
  });

  test('registers browser acquisition, rejects dangling provenance, and does not let WAF block availability', () => {
    const manifest = load<any>('data/source_manifest_18.1.json');
    const browser = manifest.sources.find((source: any) => source.sourceId === 'lolchess_set18_wisps_browser_import');
    expect(browser).toMatchObject({ recordCount: 174, pageUpdatedAt: 'August 28, 2026', fetchStatus: 'browser_snapshot_imported', confidence: 'verified_third_party' });
    expect(validateProvenanceSources(dataset as any, manifest)).toEqual([]);
    expect(validateProvenanceSources({ records: [{ sources: { effects: { sourceId: 'missing' } } }] }, manifest)).toContain('records[0].sources.effects.sourceId: manifest 中不存在 "missing"');
    const conflicts = load<any[]>('reports/data-conflicts-18.1.json');
    const warning = conflicts.find((item) => item.conflictType === 'acquisition_warning');
    expect(warning).toMatchObject({ blocksProductionReady: false, valueB: { status: 'browser_snapshot_imported', recordCount: 174 } });
    expect(conflicts.some((item) => item.note.includes('records unavailable'))).toBe(false);
  });

  test('uses explicit reviewed mappings while retaining unresolved review work', () => {
    const mappings = load<any>('data/overrides/18.1/reviewed-identity-mappings.json');
    expect(mappings.records).toHaveLength(17);
    expect(mappings.records.every((row: any) => row.evidence.identityChainUnique && row.reason)).toBe(true);
    const reconciliation = load<any>('reports/data-corpus-reconciliation-18.1.json');
    expect(reconciliation.matching.reviewedCrossSourceIdentityCount).toBe(17);
    expect(reconciliation.matching.dataTftUnmatchedCount).toBeGreaterThan(0);
    expect(reconciliation.confirmedCorpusMinimum).toBe(174);
    expect(reconciliation.exactCorpusSize).toBe('unresolved');
  });

  test('manual queue includes every semantic requirement review exactly once', () => {
    const fieldAudit = load<any>('reports/data-lolchess-field-audit-18.1.json');
    const manual = load<any>('reports/data-manual-review-18.1.json');
    const queued = manual.groups.requirements_semantics;
    const expected = new Set([...fieldAudit.requirements.presenceConflict, ...fieldAudit.requirements.structuredConflict, ...fieldAudit.requirements.semanticReviewRequired].map((row: any) => row.identity));
    expect(queued.map((item: any) => item.candidateMapping)).toHaveLength(expected.size);
    expect(new Set(queued.map((item: any) => item.candidateMapping))).toEqual(expected);
    expect(queued.every((item: any) => item.reviewReasons.length === new Set(item.reviewReasons).size)).toBe(true);
    expect(Object.values(manual.groups).reduce((sum: number, rows: any) => sum + rows.length, 0)).toBe(Object.values(manual.groups).flat().length);
  });

  test('manifest snapshotAt is the deterministic latest source retrieval time', () => {
    const manifest = load<any>('data/source_manifest_18.1.json');
    const latest = Math.max(...manifest.sources.map((source: any) => Date.parse(source.retrievedAt)).filter(Number.isFinite));
    expect(Date.parse(manifest.snapshotAt)).toBe(latest);
  });

  test('provenance falls back to DataTFT and unknown facts stay unknown', () => {
    const fallback = dataset.records.find((record) => record.riotId === null)!;
    expect(fallback.sources.nameZh.sourceId).toContain('datatft');
    expect(fallback.oncePerGame).toEqual({ status: 'unknown' });
    expect(fallback.reofferCooldownShops).toEqual({ status: 'unknown' });
    expect(fallback).not.toHaveProperty('minimumAffordableGold');
  });
});
