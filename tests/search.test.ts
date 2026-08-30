import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import type { RuntimeSearchLexicon, Wisp, WispDataset } from '../src/domain/types';
import { runQuery } from '../src/query/queryModel';
import { buildQueryClauses, normalizeSearchText, searchWisps, tokenizeQuery } from '../src/search/searchEngine';

const conceptsArtifact = JSON.parse(readFileSync('data/materialized/18.1/search-concepts.json', 'utf8'));
const synonymsArtifact = JSON.parse(readFileSync('data/materialized/18.1/synonyms.json', 'utf8'));
const lexicon: RuntimeSearchLexicon = { patch: conceptsArtifact.patch, sourceGeneratorVersion: conceptsArtifact.sourceGeneratorVersion, reviewedAgainstInputSha256: conceptsArtifact.reviewedAgainstInputSha256, normalizedRecordCount: conceptsArtifact.normalizedRecordCount, concepts: conceptsArtifact.taxonomy, queryExpansionGroups: synonymsArtifact.queryExpansionGroups };
const seed = (JSON.parse(readFileSync('data/wisps_18.1.json', 'utf8')) as WispDataset).records[0]!;
const fixture = (id: string, changes: Partial<Wisp>): Wisp => ({ ...seed, id, nameZh: id, nameEn: id, effects: { normal: '普通效果' }, requirements: [], searchConcepts: [], synonyms: [], ...changes });

describe('搜索引擎', () => {
  test('归一化大小写、全半角和常见标点', () => {
    expect(normalizeSearchText('  ＨＰ，Champion-Duplicator！')).toBe('hp champion duplicator');
    expect(tokenizeQuery('复制　阵亡，复制')).toEqual(['复制', '阵亡']);
  });

  test('复制器可从效果、内部概念或记录同义词命中', () => {
    const records = [
      fixture('effect', { effects: { normal: '获得英雄复制器' } }),
      fixture('concept', { searchConcepts: ['复制英雄'], synonyms: ['复制器'] }),
      fixture('none', { effects: { normal: '获得金币' } }),
    ];
    expect(searchWisps(records, '复制器', lexicon).map(({ wisp }) => wisp.id)).toEqual(['effect', 'concept']);
  });

  test('多关键词为 AND，而非 OR', () => {
    const records = [
      fixture('both', { effects: { normal: '首次己方阵亡后复制英雄' } }),
      fixture('death', { effects: { normal: '敌方阵亡时获得金币' } }),
      fixture('copy', { effects: { normal: '复制一个英雄' } }),
    ];
    expect(searchWisps(records, '阵亡 复制', lexicon).map(({ wisp }) => wisp.id)).toEqual(['both']);
  });

  test('query expansion 让“血量”命中“生命值”', () => {
    const health = fixture('health', { effects: { normal: '获得 100 生命值' } });
    expect(searchWisps([health], '血量', lexicon)[0]?.wisp.id).toBe('health');
  });

  test('中文、单词和多词英文同义词形成一个通用 phrase clause', () => {
    const duplicator = fixture('duplicator', { effects: { normal: '获得英雄复制器' } });
    expect(searchWisps([duplicator], '妮蔻', lexicon)).toHaveLength(0);
    expect(searchWisps([duplicator], '英雄复制器', lexicon)).toHaveLength(1);
    expect(searchWisps([duplicator], 'Champion Duplicator', lexicon)).toHaveLength(1);
    expect(buildQueryClauses('Champion Duplicator', lexicon)).toEqual([expect.objectContaining({ source: 'champion duplicator' })]);
  });

  test('precision-first expansions avoid D, roll, and 妮蔻 pollution', () => {
    const records = [
      fixture('letter-d', { nameEn: 'Golden Dividend' }),
      fixture('die-roll', { nameEn: 'Die Roll' }),
      fixture('rolling-bones', { nameEn: 'Rolling Bones' }),
      fixture('neeko', { effects: { normal: '获得妮蔻' } }),
      fixture('reroll', { effects: { normal: '获得一次免费重随' } }),
      fixture('duplicator', { effects: { normal: '获得英雄复制器' } }),
    ];
    expect(searchWisps(records, '刷新', lexicon).map(hit => hit.wisp.id)).toEqual(['reroll']);
    expect(searchWisps(records, '重随', lexicon).map(hit => hit.wisp.id)).toEqual(['reroll']);
    expect(searchWisps(records, '复制器', lexicon).map(hit => hit.wisp.id)).toEqual(['duplicator']);
  });

  test.each([['法强', '法术强度'], ['攻速', '攻击速度'], ['真伤', '真实伤害']])('%s safely expands to %s', (query, text) => {
    expect(searchWisps([fixture('target', { effects: { normal: `获得${text}` } })], query, lexicon)).toHaveLength(1);
  });

  test.each([['法强', '法术加成'], ['攻击力', '物理加成']])('%s expands to current production wording %s', (query, text) => {
    expect(searchWisps([fixture('target', { effects: { normal: `获得${text}` } })], query, lexicon)).toHaveLength(1);
  });

  test('AP and AD remain literal queries rather than substring-risk expansions', () => {
    const target = fixture('target', { effects: { normal: '获得法术加成和物理加成' } });
    expect(searchWisps([target], 'AP', lexicon)).toHaveLength(0);
    expect(searchWisps([target], 'AD', lexicon)).toHaveLength(0);
  });

  test('multi-token AND 可与 phrase synonym 同时使用', () => {
    const both = fixture('both', { effects: { normal: '己方阵亡时获得英雄复制器' } });
    const copyOnly = fixture('copy-only', { effects: { normal: '获得英雄复制器' } });
    expect(searchWisps([copyOnly, both], 'Champion Duplicator 阵亡', lexicon).map(({ wisp }) => wisp.id)).toEqual(['both']);
  });

  test('taxonomy label can match exact canonical concept membership without surface text', () => {
    const target = fixture('concept-only', { effects: { normal: '获得一个随机效果' }, searchConcepts: ['champion_transform'] });
    const hit = searchWisps([target], '弈子转化', lexicon)[0];
    expect(hit).toMatchObject({ score: 100, matchedFields: ['concept'] });
  });

  test('one clause uses its highest field score rather than adding concept score', () => {
    const target = fixture('direct-and-concept', { effects: { normal: '获得法术加成' }, searchConcepts: ['ability_power'] });
    expect(searchWisps([target], '法术加成', lexicon)[0]).toMatchObject({ score: 300, matchedFields: ['effect'] });
  });

  test('concept-aware multi-clause queries retain AND semantics', () => {
    const both = fixture('both-semantics', { effects: { normal: '获得一次免费重随' }, searchConcepts: ['champion_star_level'] });
    const rerollOnly = fixture('reroll-only', { effects: { normal: '获得一次免费重随' } });
    expect(searchWisps([rerollOnly, both], '重随 弈子星级', lexicon).map(hit => hit.wisp.id)).toEqual(['both-semantics']);
  });

  test('字段优先级：名称完全匹配 > 名称前缀 > 正文 > 条件 > 同义词 > 概念', () => {
    const records = [
      fixture('concept', { searchConcepts: ['shield'] }), fixture('synonym', { synonyms: ['护盾'] }),
      fixture('requirement', { requirements: [{ type: 'x', textZh: '需要护盾', machineEvaluable: false }] }),
      fixture('effect', { effects: { normal: '获得护盾' } }), fixture('护盾精灵', {}), fixture('护盾', {}),
    ];
    expect(searchWisps(records, '护盾', lexicon).map(({ wisp }) => wisp.id)).toEqual(['护盾', '护盾精灵', 'effect', 'requirement', 'synonym', 'concept']);
  });
});

describe('查询状态分层', () => {
  const records = [fixture('target-a', { effects: { normal: '复制英雄', prismatic: '棱彩复制' } }), fixture('target-b', { effects: { normal: '复制装备' } }), fixture('other', { effects: { normal: '金币' } })];
  test('仅 Prismatic 属于 Candidate Pool 筛选', () => expect(runQuery(records, { prismaticOnly: true }, '', lexicon).candidatePool.map(({ id }) => id)).toEqual(['target-a']));
  test('搜索只生成 Displayed Results，概率 K 使用搜索结果而 N 保持 Candidate Pool', () => {
    const result = runQuery(records, {}, '复制', lexicon);
    expect(result.candidatePool).toHaveLength(3);
    expect(result.displayedResults).toHaveLength(2);
    expect(result.probability).toMatchObject({ poolSize: 3, targetCount: 2, targetProbability: 2 / 3, perWispProbability: 1 / 3 });
  });
  test('手动排除后从 Candidate Pool 移除并重算', () => {
    const result = runQuery(records, { excludedIds: new Set(['other']) }, '复制', lexicon);
    expect(result.probability).toMatchObject({ poolSize: 2, targetCount: 2, targetProbability: 1 });
  });
});
