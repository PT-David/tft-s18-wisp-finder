import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { knowledgeCounts, recommendation } from '../scripts/data/release-audit-18.1';

const root = resolve(import.meta.dirname, '..');
const load = async (path: string) => JSON.parse(await readFile(resolve(root, path), 'utf8'));

describe('release readiness audit', () => {
  it('derives catalog and identity counts from committed evidence', async () => {
    const report = await load('reports/release-readiness-18.1.json');
    const production = await load('data/normalized/wisps_18.1.json');
    const opgg = await load('data/raw/18.1/opgg-wisps-corpus.json');
    const candidates = await load('reports/data-corpus-diff-18.1.json');
    expect(report.normalizedCount).toBe(production.records.length);
    expect(report.sourceCounts.opgg).toBe(opgg.recordCount);
    expect(report.identity.opggCandidateGroups).toBe(candidates.candidateMatches.length);
    expect(report.identity.reviewQueue).toHaveLength(report.identity.opggCandidateGroups);
  });

  it('never recommends readiness with blockers or an unresolved corpus', () => {
    expect(recommendation(1, 'proven')).toBe(false);
    expect(recommendation(0, 'unresolved')).toBe(false);
    expect(recommendation(0, 'proven')).toBe(true);
  });

  it('does not confuse confirmed false/null, unknown, and legacy input', () => {
    expect(knowledgeCounts([{ x: { status: 'confirmed', value: false } }, { x: { status: 'unknown' } }, { x: false }], 'x')).toEqual({ confirmedTrue: 0, confirmedFalse: 1, unknown: 1, legacyTrue: 0, legacyFalse: 1 });
    expect(knowledgeCounts([{ x: { status: 'confirmed', value: null } }, { x: { status: 'unknown' } }, { x: null }], 'x', true)).toEqual({ confirmedNumber: 0, confirmedNull: 1, unknown: 1, legacyNumber: 0, legacyNull: 1 });
  });

  it('keeps catalog differences and fuzzy candidates out of confirmed membership', async () => {
    const report = await load('reports/release-readiness-18.1.json');
    expect(report.confirmedIdentityIntersection).toBeLessThan(report.sourceCounts.opgg);
    expect(report.identity.reviewQueue.every((row: any) => ['same_identity','distinct_identity','insufficient_evidence','source_variant','obsolete_or_non_live_candidate'].includes(row.recommendedHumanAction))).toBe(true);
    expect(report.exactCorpusSizeStatus).toBe('unresolved');
  });

  it('has no dangling manifest source IDs and preserves accepted unknowns', async () => {
    const report = await load('reports/release-readiness-18.1.json');
    expect(report.provenance.danglingSourceRefs).toEqual([]);
    expect(report.acceptedUnknowns.reduce((sum: number, row: any) => sum + row.count, 0)).toBeGreaterThan(0);
    expect(report.blockerCount).toBe(report.identityBlockers.length + report.provenanceBlockers.length + report.fieldConflictBlockers.category.length + report.fieldConflictBlockers.cost.length + report.fieldConflictBlockers.stageRanges.length + report.fieldConflictBlockers.blossomPresence.length + report.fieldConflictBlockers.prismatic.length + report.fieldConflictBlockers.requirements.presence.length);
  });
});
