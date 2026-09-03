import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { exactCorpusStatus, knowledgeCounts, recommendation, releaseReportState, type ReleaseCriteria } from '../scripts/data/release-audit-18.1';

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

  it('recommends readiness only when every explicit criterion is satisfied', () => {
    const allClear: ReleaseCriteria = {
      exactCorpusBoundaryProven: true, identityReviewQueueEmpty: true, dataTftUnmatchedEmpty: true,
      communityDragonConfirmedUnlinkedEmpty: true, criticalFieldReviewQueueEmpty: true,
      provenanceBlockersEmpty: true, noStalePbeOverride: true, allRequiredSchemaFieldsValid: true,
    };
    expect(recommendation(allClear)).toBe(true);
    for (const criterion of Object.keys(allClear) as Array<keyof ReleaseCriteria>) {
      expect(recommendation({ ...allClear, [criterion]: false }), criterion).toBe(false);
    }
  });

  it('derives a complete all-clear report state without unresolved blockers', () => {
    const state = releaseReportState({ exactCorpusSizeStatus: 'proven', identityReviewItemCount: 0, dataTftUnmatchedCount: 0, communityDragonConfirmedUnlinkedCount: 0, criticalFieldReviewCount: 0, provenanceBlockerCount: 0, stalePbeOverrideCount: 0, requiredSchemaValid: true });
    expect(state).toMatchObject({ exactCorpusSizeStatus: 'proven', recommendedProductionReady: true, verdict: 'READY FOR RELEASE DATA-WISE', identityBlockers: [] });
    expect(state.releaseCriteria.exactCorpusBoundaryProven).toBe(true);
  });

  it('distinguishes review-only and corpus-only not-ready states', () => {
    const reviewOnly = releaseReportState({ exactCorpusSizeStatus: 'proven', identityReviewItemCount: 1, dataTftUnmatchedCount: 0, communityDragonConfirmedUnlinkedCount: 0, criticalFieldReviewCount: 0, provenanceBlockerCount: 0, stalePbeOverrideCount: 0, requiredSchemaValid: true });
    expect(reviewOnly.recommendedProductionReady).toBe(false);
    expect(reviewOnly.verdict).toBe('TARGETED HUMAN REVIEW REQUIRED');
    expect(reviewOnly.verdict).not.toContain('CORPUS COMPLETENESS UNRESOLVED');
    expect(reviewOnly.identityBlockers.map((item) => item.id)).toEqual(['opgg-identity-review']);

    const corpusOnly = releaseReportState({ exactCorpusSizeStatus: 'unresolved', identityReviewItemCount: 0, dataTftUnmatchedCount: 0, communityDragonConfirmedUnlinkedCount: 0, criticalFieldReviewCount: 0, provenanceBlockerCount: 0, stalePbeOverrideCount: 0, requiredSchemaValid: true });
    expect(corpusOnly.recommendedProductionReady).toBe(false);
    expect(corpusOnly.verdict).toBe('NOT READY — CORPUS COMPLETENESS UNRESOLVED');
    expect(corpusOnly.verdict).not.toContain('TARGETED HUMAN REVIEW REQUIRED');
    expect(corpusOnly.identityBlockers.map((item) => item.id)).toEqual(['exact-corpus-boundary']);
  });

  it('derives exact corpus status from committed report shapes', () => {
    expect(exactCorpusStatus({ exactCorpusSizeStatus: 'proven' }, { exactCorpusSize: 'unresolved' })).toBe('proven');
    expect(exactCorpusStatus({ exactCorpusSize: { status: 'proven' } })).toBe('proven');
    expect(exactCorpusStatus({ exactCorpusSize: 'unresolved' })).toBe('unresolved');
    expect(exactCorpusStatus({})).toBe('unresolved');
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
    expect(report.releaseCriteria.exactCorpusBoundaryProven).toBe(false);
    expect(report.verdict).toContain('CORPUS COMPLETENESS UNRESOLVED');
    expect(report.verdict).toContain('TARGETED HUMAN REVIEW REQUIRED');
  });

  it('does not turn client corpus membership into a same-identity recommendation', async () => {
    const report = await load('reports/release-readiness-18.1.json');
    const clientSupported = report.identity.reviewQueue.filter((row: any) => row.evidence.clientKey);
    expect(clientSupported).toHaveLength(1);
    expect(clientSupported.every((row: any) => row.recommendedHumanAction === 'insufficient_evidence' && row.recommendedProductionId === null)).toBe(true);
    expect(report.identity.reviewQueue.filter((row: any) => row.recommendedHumanAction === 'same_identity').every((row: any) => Boolean(row.recommendedProductionId))).toBe(true);
  });

  it('deduplicates requirement reasons into one release review identity queue', async () => {
    const report = await load('reports/release-readiness-18.1.json');
    const requirements = report.fieldConflictBlockers.requirements;
    const identities = requirements.manualReviewQueue.map((item: any) => item.row.identity);
    expect(new Set(identities).size).toBe(identities.length);
    expect(report.blockerSummary.requirementUniqueReviewIdentities).toBe(identities.length);
    expect(identities.length).toBeLessThan(requirements.presence.length + requirements.semanticReviewRequired.length);
  });

  it('has no dangling manifest source IDs and preserves accepted unknowns', async () => {
    const report = await load('reports/release-readiness-18.1.json');
    expect(report.provenance.danglingSourceRefs).toEqual([]);
    expect(report.acceptedUnknowns.reduce((sum: number, row: any) => sum + row.count, 0)).toBeGreaterThan(0);
    expect(report).not.toHaveProperty('blockerCount');
    expect(report.blockerSummary.provenanceItems).toBe(report.provenanceBlockers.length);
    expect(report.recommendedProductionReady).toBe(recommendation(report.releaseCriteria));
  });
});
