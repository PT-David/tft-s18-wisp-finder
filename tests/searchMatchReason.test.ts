import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { RuntimeSearchLexicon, WispDataset } from '../src/domain/types';
import type { SearchFieldPath, SearchMatch, SearchMatchType } from '../src/search/searchEngine';
import { readSearchField, toSearchMatchReasonView } from '../src/ui/searchMatchReason';

const conceptsArtifact = JSON.parse(readFileSync('data/materialized/18.1/search-concepts.json', 'utf8'));
const synonymsArtifact = JSON.parse(readFileSync('data/materialized/18.1/synonyms.json', 'utf8'));
const lexicon: RuntimeSearchLexicon = { patch: conceptsArtifact.patch, sourceGeneratorVersion: conceptsArtifact.sourceGeneratorVersion, reviewedAgainstInputSha256: conceptsArtifact.reviewedAgainstInputSha256, normalizedRecordCount: conceptsArtifact.normalizedRecordCount, assignmentCount: conceptsArtifact.assignmentCount, concepts: conceptsArtifact.taxonomy, conceptMembership: conceptsArtifact.records, queryExpansionGroups: synonymsArtifact.queryExpansionGroups, recordAliases: synonymsArtifact.recordAliases };
const source = (JSON.parse(readFileSync('data/wisps_18.1.json', 'utf8')) as WispDataset).records[0]!;
const wisp = { ...source, nameZh: '测试中文名', nameEn: 'Test English Name', effects: { normal: '获得ＨＰ并可以重随', blossom: '获得金币', prismatic: '获得复制器' }, requirements: [{ type: 'gold', textZh: '拥有30金币', textEn: 'Have 30 gold', machineEvaluable: false }], synonyms: ['记录别名'] };

const surface = (fieldPath: SearchFieldPath, matchedTerm: string, start: number, end: number, matchType: SearchMatchType = 'direct'): SearchMatch => ({
  clauseIndex: 0, queryTerm: matchedTerm, matchedTerm, matchType, scoreField: 'effect', fieldPath, score: 300, ranges: [{ start, end }],
});

describe('search match reason formatter', () => {
  test.each([
    ['effects.normal', '重随', 8, 10, '普通：重随'],
    ['requirements.0.textZh', '30金币', 2, 6, '条件：30金币'],
    ['nameZh', '测试中文名', 0, 5, '中文名：测试中文名'],
    ['nameEn', 'Test English Name', 0, 17, '英文名：Test English Name'],
    ['effects.blossom', '金币', 2, 4, 'Blossom：金币'],
    ['effects.prismatic', '复制器', 2, 5, 'Prismatic：复制器'],
    ['synonyms.0', '记录别名', 0, 4, '别名：记录别名'],
  ] as const)('formats %s with its user-facing field label', (path, term, start, end, expected) => {
    expect(toSearchMatchReasonView(wisp, surface(path, term, start, end), lexicon).text).toBe(expected);
  });

  test('query expansion and structured raw range preserve the actual source spelling', () => {
    expect(toSearchMatchReasonView(wisp, surface('effects.normal', 'hp', 2, 4, 'queryExpansion'), lexicon).text).toBe('同义·普通：ＨＰ');
  });

  test('an empty range falls back to matchedTerm without relocating text', () => {
    const match = { ...surface('effects.normal', 'café', 0, 1), ranges: [] };
    expect(toSearchMatchReasonView(wisp, match, lexicon).text).toBe('普通：café');
  });

  test('concept uses the reviewed Chinese taxonomy label and safely falls back to queryTerm', () => {
    const match: SearchMatch = { clauseIndex: 0, queryTerm: '弈子转化', matchType: 'concept', scoreField: 'concept', score: 100, ranges: [], conceptKey: 'champion_transform' };
    expect(toSearchMatchReasonView(wisp, match, lexicon).text).toBe('概念：弈子转化');
    expect(toSearchMatchReasonView(wisp, { ...match, queryTerm: '安全回退', conceptKey: 'missing' }, lexicon).text).toBe('概念：安全回退');
  });

  test('indexed requirement and missing paths are read safely without synthetic concatenation', () => {
    expect(readSearchField(wisp, 'requirements.0.textEn')).toBe('Have 30 gold');
    expect(readSearchField(wisp, 'requirements.9.textZh')).toBeUndefined();
    const invalid = { ...surface('requirements.9.textZh', 'fallback', 0, 8), ranges: [] };
    expect(toSearchMatchReasonView(wisp, invalid, lexicon).text).toBe('条件：fallback');
  });
});
