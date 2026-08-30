import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { RuntimeSearchLexicon, Wisp, WispDataset } from '../src/domain/types';
import {
  buildQueryClauses, findNormalizedSearchRanges, normalizeSearchText, normalizeSearchTextWithMap,
  type SearchFieldPath, type SearchHit, searchWisps,
} from '../src/search/searchEngine';

const conceptsArtifact = JSON.parse(readFileSync('data/materialized/18.1/search-concepts.json', 'utf8'));
const synonymsArtifact = JSON.parse(readFileSync('data/materialized/18.1/synonyms.json', 'utf8'));
const lexicon: RuntimeSearchLexicon = { patch: conceptsArtifact.patch, sourceGeneratorVersion: conceptsArtifact.sourceGeneratorVersion, reviewedAgainstInputSha256: conceptsArtifact.reviewedAgainstInputSha256, normalizedRecordCount: conceptsArtifact.normalizedRecordCount, assignmentCount: conceptsArtifact.assignmentCount, concepts: conceptsArtifact.taxonomy, conceptMembership: conceptsArtifact.records, queryExpansionGroups: synonymsArtifact.queryExpansionGroups, recordAliases: synonymsArtifact.recordAliases };
const production = (JSON.parse(readFileSync('public/data/wisps.json', 'utf8')) as WispDataset).records;
const seed = (JSON.parse(readFileSync('data/wisps_18.1.json', 'utf8')) as WispDataset).records[0]!;
const fixture = (id: string, changes: Partial<Wisp>): Wisp => ({ ...seed, id, nameZh: id, nameEn: id, effects: { normal: '普通效果' }, requirements: [], searchConcepts: [], synonyms: [], ...changes });

function rawField(wisp: Wisp, path: SearchFieldPath): string {
  if (path === 'nameZh' || path === 'nameEn') return wisp[path];
  if (path === 'effects.normal') return wisp.effects.normal;
  if (path === 'effects.blossom') return wisp.effects.blossom!;
  if (path === 'effects.prismatic') return wisp.effects.prismatic!;
  const requirement = path.match(/^requirements\.(\d+)\.(textZh|textEn)$/);
  if (requirement) return wisp.requirements[Number(requirement[1])]![requirement[2] as 'textZh' | 'textEn']!;
  return wisp.synonyms[Number(path.match(/^synonyms\.(\d+)$/)![1])]!;
}

function validateHit(hit: SearchHit, query: string): void {
  expect(hit.matches).toHaveLength(buildQueryClauses(query, lexicon).length);
  expect(hit.matches.map(match => match.clauseIndex)).toEqual(hit.matches.map((_, index) => index));
  expect(hit.matchedFields).toEqual([...new Set(hit.matches.map(match => match.scoreField))]);
  for (const match of hit.matches) {
    expect(match.score).toBeGreaterThan(0);
    if (match.matchType === 'concept') {
      expect(match).toMatchObject({ scoreField: 'concept', ranges: [] });
      expect(match.conceptKey).toBeTruthy(); expect(match.fieldPath).toBeUndefined(); expect(match.matchedTerm).toBeUndefined();
      continue;
    }
    expect(match.matchedTerm).toBeTruthy(); expect(match.fieldPath).toBeTruthy(); expect(match.ranges.length).toBeGreaterThan(0);
    const raw = rawField(hit.wisp, match.fieldPath!);
    for (const range of match.ranges) {
      expect(range.start).toBeGreaterThanOrEqual(0); expect(range.start).toBeLessThan(range.end); expect(range.end).toBeLessThanOrEqual(raw.length);
      expect(normalizeSearchText(raw.slice(range.start, range.end))).toBe(match.matchedTerm);
    }
  }
}

describe('structured SearchHit metadata', () => {
  test('direct surface evidence wins once over the same concept', () => {
    const target = fixture('direct-and-concept', { effects: { normal: '获得法术加成' }, searchConcepts: ['ability_power'] });
    const hit = searchWisps([target], '法术加成', lexicon)[0]!;
    expect(hit.matches).toEqual([expect.objectContaining({ clauseIndex: 0, queryTerm: '法术加成', matchedTerm: '法术加成', matchType: 'direct', scoreField: 'effect', fieldPath: 'effects.normal', score: 300 })]);
    validateHit(hit, '法术加成');
  });

  test('query expansion surface evidence beats concept without changing its synonym score bucket', () => {
    const target = fixture('expanded-and-concept', { effects: { normal: '获得20法术加成。' }, searchConcepts: ['ability_power'] });
    const hit = searchWisps([target], '法强', lexicon)[0]!;
    expect(hit.matches[0]).toMatchObject({ queryTerm: '法强', matchedTerm: '法术加成', matchType: 'queryExpansion', scoreField: 'synonym', fieldPath: 'effects.normal', score: 140 });
    expect(target.effects.normal.slice(hit.matches[0]!.ranges[0]!.start, hit.matches[0]!.ranges[0]!.end)).toBe('法术加成');
    validateHit(hit, '法强');
  });

  test('concept-only evidence has a canonical key and never fabricates a surface location', () => {
    const target = fixture('concept-only', { effects: { normal: '获得一个随机效果' }, searchConcepts: ['champion_transform'] });
    const hit = searchWisps([target], '弈子转化', lexicon)[0]!;
    expect(hit.matches).toEqual([{ clauseIndex: 0, queryTerm: '弈子转化', matchType: 'concept', scoreField: 'concept', score: 100, ranges: [], conceptKey: 'champion_transform' }]);
    validateHit(hit, '弈子转化');
  });

  test('record aliases and indexed Chinese/English requirements identify the exact raw field', () => {
    const alias = searchWisps([fixture('alias', { synonyms: ['测试别名'] })], '测试别名', lexicon)[0]!;
    expect(alias.matches[0]).toMatchObject({ matchType: 'direct', scoreField: 'synonym', fieldPath: 'synonyms.0', score: 140 });
    const target = fixture('requirements-zh', { requirements: [
      { type: 'zh', textZh: '当前拥有至少30金币', machineEvaluable: false },
    ] });
    const englishTarget = fixture('requirements-en', { requirements: [
      { type: 'zh', textZh: '其它条件', machineEvaluable: false },
      { type: 'en', textZh: '其它条件', textEn: 'Have at least 30 gold', machineEvaluable: false },
    ] });
    expect(searchWisps([target], '30金币', lexicon)[0]!.matches[0]!.fieldPath).toBe('requirements.0.textZh');
    expect(searchWisps([englishTarget], '30 gold', lexicon)[0]!.matches.map(match => match.fieldPath)).toEqual(['requirements.1.textEn', 'requirements.1.textEn']);
    validateHit(alias, '测试别名'); validateHit(searchWisps([target], '30金币', lexicon)[0]!, '30金币'); validateHit(searchWisps([englishTarget], '30 gold', lexicon)[0]!, '30 gold');
  });

  test('multi-clause AND, phrase clauses, repeated occurrences, and empty queries retain their contracts', () => {
    const target = fixture('multi', { effects: { normal: '获得生命值，并根据生命值获得金币和英雄复制器，且免费重随' } });
    const multi = searchWisps([target], '重随 金币', lexicon)[0]!;
    expect(multi.matches.map(match => match.clauseIndex)).toEqual([0, 1]);
    expect(searchWisps([target], 'Champion Duplicator', lexicon)[0]!.matches).toHaveLength(1);
    expect(searchWisps([target], '生命值', lexicon)[0]!.matches[0]!.ranges).toHaveLength(2);
    expect(searchWisps([target], '', lexicon)[0]).toMatchObject({ score: 0, matchedFields: [], matches: [] });
    validateHit(multi, '重随 金币');
  });

  test.each([
    ['ＨＰ', 'hp', 'ＨＰ'],
    ['Champion-Duplicator', 'Champion Duplicator', 'Champion-Duplicator'],
    ['Cafe\u0301', 'café', 'Cafe\u0301'],
    ['😀获得生命值', '生命值', '生命值'],
    ['Champion    Duplicator', 'champion duplicator', 'Champion    Duplicator'],
  ])('maps normalized %s evidence back to safe raw UTF-16 offsets', (raw, term, expectedSlice) => {
    expect(normalizeSearchTextWithMap(raw).normalized).toBe(normalizeSearchText(raw));
    const ranges = findNormalizedSearchRanges(raw, term);
    expect(ranges).toHaveLength(1);
    expect(raw.slice(ranges[0]!.start, ranges[0]!.end)).toBe(expectedSlice);
    expect(normalizeSearchText(raw.slice(ranges[0]!.start, ranges[0]!.end))).toBe(normalizeSearchText(term));
  });

  test('reviewed production hits satisfy metadata invariants and fixed B1 result counts', () => {
    const expectedCounts: Record<string, number> = { '重随': 20, '弈子转化': 4, '重随 金币': 8, '弈子星级': 19 };
    for (const query of ['血量', '重随', 'Champion Duplicator', '法强', '攻击力', '弈子转化', '弈子星级', '临时装备', '重随 金币']) {
      const hits = searchWisps(production, query, lexicon); expect(hits.length).toBeGreaterThan(0); hits.forEach(hit => validateHit(hit, query));
      if (expectedCounts[query] !== undefined) expect(hits).toHaveLength(expectedCounts[query]);
    }
  });
});
