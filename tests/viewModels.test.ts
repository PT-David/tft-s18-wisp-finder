import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import type { WispDataset } from '../src/domain/types';
import { toCardViewModel } from '../src/ui/viewModels';

const wisps = (JSON.parse(readFileSync('data/wisps_18.1.json', 'utf8')) as WispDataset).records;

test('卡片 view-model 保留折叠态条件、标识、阶段和展开态限制/来源', () => {
  const hero = toCardViewModel(wisps.find(({ id }) => id === 'hero_of_prophecy')!, 'prismatic');
  expect(hero.requirements).toEqual(expect.arrayContaining(['至少拥有 35 金币', '玩家生命值至少为 50', '等级至少为 10']));
  expect(hero.oncePerGame).toBe(true);
  expect(hero.stageText).toContain('6-1 ～ 10-1');
  expect(hero.summaryMode).toBe('normal');
  expect(hero.sources.length).toBeGreaterThan(0);
});

test('不存在 Prismatic 时 view-model 不产生空区块数据', () => {
  const card = toCardViewModel(wisps.find(({ id }) => id === 'petrify_shields')!, 'normal');
  expect(card.hasPrismatic).toBe(false);
  expect(card.prismatic).toBeUndefined();
  expect(card.hasBlossom).toBe(true);
});
