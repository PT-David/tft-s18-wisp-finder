import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const load = <T>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T;

describe('Stage C1 production audit regressions', () => {
  const dataset = load<{ records: Array<Record<string, any>> }>('data/normalized/wisps_18.1.json');

  test('corpus discrepancy is reported from source observations', () => {
    const report = load<any>('reports/data-corpus-diff-18.1.json');
    expect(report.categoryCountBySource.datatft).not.toEqual(report.categoryCountBySource.opgg);
    expect(report.confirmedMatches.every((match: any) => ['exact_client_key','exact_english_name','exact_chinese_name','reviewed_alias'].includes(match.matchMethod))).toBe(true);
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
    expect(audit.lolchess).toHaveLength(19);
    expect(audit.communityDragonCount).toBe(19);
    expect(audit.chosenStatus).toBe('needs_review');
  });

  test('audits LoLCHESS field coverage and applies explicit knowledge evidence', () => {
    const audit = load<any>('reports/data-lolchess-field-audit-18.1.json');
    expect(audit.sourceCount).toBe(174);
    expect(audit.blossom.lolchessCount).toBe(145);
    expect(audit.requirements.lolchessCount).toBe(60);
    expect(audit.stageRanges.compared).toBe(audit.exactEnglishIdentityMatches);
    expect(audit.oncePerGame.lolchessConfirmed).toEqual(['Blood Ritual', 'Hero Of Prophecy']);
    const hero = dataset.records.find((record) => record.nameEn === 'Hero Of Prophecy')!;
    expect(hero.oncePerGame).toEqual({ status: 'confirmed', value: true });
    expect(hero.sources.oncePerGame.sourceId).toContain('lolchess');
  });

  test('provenance falls back to DataTFT and unknown facts stay unknown', () => {
    const fallback = dataset.records.find((record) => record.riotId === null)!;
    expect(fallback.sources.nameZh.sourceId).toContain('datatft');
    expect(fallback.oncePerGame).toEqual({ status: 'unknown' });
    expect(fallback.reofferCooldownShops).toEqual({ status: 'unknown' });
    expect(fallback).not.toHaveProperty('minimumAffordableGold');
  });
});
