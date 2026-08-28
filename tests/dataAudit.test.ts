import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const load = <T>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T;

describe('Stage C1 production audit regressions', () => {
  const dataset = load<{ records: Array<Record<string, any>> }>('data/normalized/wisps_18.1.json');

  test('corpus discrepancy is reported from source observations', () => {
    const report = load<any>('reports/data-corpus-diff-18.1.json');
    expect(report.categoryCountBySource.datatft).not.toEqual(report.categoryCountBySource.opgg);
    expect(report.needsReview[0].count).toBeGreaterThan(0);
  });

  test('a base without a distinct Upgrade variant has no Blossom', () => {
    const mitosis = dataset.records.find((record) => record.nameEn === 'Mitosis')!;
    expect(mitosis.effects.blossom).toBeNull();
    const variants = load<any>('reports/data-communitydragon-variants-18.1.json');
    expect(variants.baseVariants + variants.upgradeVariants + variants.prismaticVariants).toBe(variants.totalVariants);
  });

  test('Prismatic discrepancy remains explicit instead of forcing a count', () => {
    const audit = load<any>('reports/data-prismatic-audit-18.1.json');
    expect(audit.dataTftCount).not.toBe(audit.lolchessHumanObservedCount);
    expect(audit.chosenStatus).toBe('needs_review');
  });

  test('provenance falls back to DataTFT and unknown facts stay unknown', () => {
    const fallback = dataset.records.find((record) => record.riotId === null)!;
    expect(fallback.sources.nameZh.sourceId).toContain('datatft');
    expect(fallback.oncePerGame).toEqual({ status: 'unknown' });
    expect(fallback.reofferCooldownShops).toEqual({ status: 'unknown' });
    expect(fallback).not.toHaveProperty('minimumAffordableGold');
  });
});
