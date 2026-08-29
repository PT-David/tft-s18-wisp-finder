import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseBrowserSnapshot } from '../scripts/data/lib/browser-snapshot';

const fixture = (name: string) => readFileSync(`tests/fixtures/browser-snapshots/${name}.html`, 'utf8');
describe('browser snapshot fallback import', () => {
  test('imports OP.GG record-level JSON and validates page identity', () => {
    const result = parseBrowserSnapshot('opgg', fixture('opgg'));
    expect(result.records).toHaveLength(2);
    expect(result.declaredRecordCount).toBe(2);
    expect(result.records[0]).toMatchObject({ name: 'Alpha', nameLocalized: '阿尔法', category: 'combat', cost: 2 });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  test('imports LoLCHESS fields, page Updated, absence and knowledge values', () => {
    const result = parseBrowserSnapshot('lolchess', fixture('lolchess'));
    expect(result.pageUpdatedAt).toBe('August 26, 2026');
    expect(result.records.find(({ name }) => name === 'Mitosis')).toMatchObject({ blossom: null, oncePerGame: false });
    expect(result.records.find(({ name }) => name === 'Hero Of Prophecy')?.oncePerGame).toBe(true);
  });
  test('imports rendered LoLCHESS SSR cards with complete semantic fields', () => {
    const result = parseBrowserSnapshot('lolchess', fixture('lolchess-rendered'));
    expect(result.pageUpdatedAt).toBe('September 1, 2026');
    expect(result.records).toHaveLength(5);
    expect(result.records.find(({ name }) => name === 'Mitosis')?.blossom).toBeNull();
    expect(result.records.find(({ name }) => name === 'Quicken')).toMatchObject({ cost: 2, category: 'Combat', effect: 'Your champions gain 40% Attack Speed for 10 seconds.', blossom: 'Your champions gain 60% Attack Speed instead.', stageRanges: [{ start: { stage: 3, round: 5 }, end: { stage: 4, round: 7 } }, { start: { stage: 5, round: 1 }, end: { stage: 5, round: 7 } }] });
    expect(result.records.find(({ name }) => name === 'Counterspell')?.prismatic).toBe('Grant 80 Magic Resist.');
    expect(result.records.find(({ name }) => name === 'Wrapped In Thorns')?.requirements).toEqual(['2 or more tanks on board']);
    expect(result.records.find(({ name }) => name === 'Hero Of Prophecy')?.oncePerGame).toBe(true);
  });
  test('fails closed for the wrong page or recordless HTML', () => {
    expect(() => parseBrowserSnapshot('opgg', '<html></html>')).toThrow('身份校验失败');
    expect(() => parseBrowserSnapshot('opgg', '<link rel="canonical" href="https://op.gg/zh-cn/tft/set/18">')).toThrow('不会覆盖');
    expect(() => parseBrowserSnapshot('lolchess', '<link rel="canonical" href="https://lolchess.gg/rewards/set18/wisps?hl=en"><main>No list</main>')).toThrow('不会覆盖');
  });
  test('validates parsed count dynamically against the page declaration', () => {
    const mismatched = fixture('opgg').replace('全部 2 个 Wisps', '全部 3 个 Wisps');
    expect(() => parseBrowserSnapshot('opgg', mismatched)).toThrow('页面声明 3 条，但解析得到 2 条');
  });
});
