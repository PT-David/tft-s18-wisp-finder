import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const productionConcepts = JSON.parse(readFileSync('public/data/search-concepts.json', 'utf8'));
const productionSynonyms = JSON.parse(readFileSync('public/data/search-synonyms.json', 'utf8'));
const runtimeUrls = ['**/data/wisps.json', '**/data/search-concepts.json', '**/data/search-synonyms.json'] as const;

async function routeRuntimeFixture(page: Page, dataset: { patch: string; records: Array<{ id: string; searchConcepts: string[]; synonyms: string[] }> }): Promise<void> {
  for (const url of runtimeUrls) await page.unroute(url);
  const metadata = { patch: dataset.patch, normalizedRecordCount: dataset.records.length, sourceGeneratorVersion: 'e2e-fixture', reviewedAgainstInputSha256: 'e2e-fixture' };
  const concepts = { ...productionConcepts, ...metadata, assignmentCount: dataset.records.reduce((sum, record) => sum + record.searchConcepts.length, 0), records: dataset.records.map(record => ({ wispId: record.id, conceptKeys: record.searchConcepts })) };
  const synonyms = { ...productionSynonyms, ...metadata, recordAliases: dataset.records.filter(record => record.synonyms.length).map(record => ({ wispId: record.id, aliases: record.synonyms })) };
  await page.route(runtimeUrls[0], route => route.fulfill({ json: dataset }));
  await page.route(runtimeUrls[1], route => route.fulfill({ json: concepts }));
  await page.route(runtimeUrls[2], route => route.fulfill({ json: synonyms }));
}

async function useProductionRuntime(page: Page): Promise<void> { for (const url of runtimeUrls) await page.unroute(url); }

test.beforeEach(async ({ page }) => {
  const seed = JSON.parse(readFileSync('data/wisps_18.1.json', 'utf8'));
  await routeRuntimeFixture(page, seed);
  await page.goto('/');
  await expect(page.locator('#resultCount')).toHaveText('10 个结果');
});

test('production corpus smoke: 完整数据可加载且 reference autocomplete 可用', async ({ page }) => {
  await useProductionRuntime(page);
  await page.reload();
  const production = JSON.parse(readFileSync('public/data/wisps.json', 'utf8')) as { records: unknown[] };
  expect(production.records.length).toBeGreaterThan(10);
  await expect(page.locator('#resultCount')).toHaveText(`${production.records.length} 个结果`);
  await page.locator('#advancedFilters summary').click();
  await page.locator('#referenceQuery').fill('有丝分裂');
  await expect(page.locator('[data-reference-option]')).not.toHaveCount(0);
});

test('逐字输入、caret 编辑与连续 Backspace 保持原生行为', async ({ page }) => {
  const search = page.locator('#query');
  await search.pressSequentially('hero');
  await expect(search).toHaveValue('hero');
  await expect.poll(() => search.evaluate((node) => (node as HTMLInputElement).selectionStart)).toBe(4);
  await search.press('ArrowLeft');
  await search.press('X');
  await expect(search).toHaveValue('herXo');
  await search.press('Backspace');
  await expect(search).toHaveValue('hero');
  await search.press('Delete');
  await expect(search).toHaveValue('her');
  await search.press('End');
  await search.press('Backspace'); await search.press('Backspace'); await search.press('Backspace');
  await expect(search).toHaveValue('');
});

test('非法 4-8 不进入候选条件，改回 4-7 后恢复过滤', async ({ page }) => {
  const initial = await page.locator('.card').count();
  await page.locator('#exactStage').fill('4-8');
  await expect(page.locator('#formError')).toContainText('精确回合无效');
  await expect(page.locator('.card')).toHaveCount(initial);
  await page.locator('#exactStage').fill('4-7');
  await expect(page.locator('#formError')).toBeEmpty();
  await expect(page.locator('.card')).not.toHaveCount(initial);
});

test('composition 生命周期不会替换搜索节点，Unicode 查询可正常执行', async ({ page }) => {
  const search = page.locator('#query');
  const stable = await search.evaluateHandle((node) => node);
  await search.evaluate((node) => {
    node.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }));
    (node as HTMLInputElement).value = 'yingxiong';
    node.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'yingxiong' }));
    node.dispatchEvent(new InputEvent('input', { data: 'yingxiong', inputType: 'insertCompositionText', bubbles: true, isComposing: true }));
  });
  expect(await page.locator('#query').evaluate((node, original) => node === original, stable)).toBe(true);
  await search.evaluate((node) => {
    (node as HTMLInputElement).value = '英雄';
    node.dispatchEvent(new CompositionEvent('compositionend', { data: '英雄', bubbles: true }));
  });
  await expect(search).toHaveValue('英雄');
  for (const value of ['英雄', '复制器', '玩家生命']) {
    await search.fill(''); await search.pressSequentially(value);
    await expect(search).toHaveValue(value);
  }
});

test('真实搜索支持名称、中文同义词、phrase synonym 和 AND', async ({ page }) => {
  const search = page.locator('#query');
  const scenarios = [
    ['复制器', 3], ['血量', 2], ['阵亡 复制', 0], ['Mitosis', 1], ['Champion Duplicator', 3],
  ] as const;
  for (const [query, count] of scenarios) {
    await search.fill(query);
    await expect(page.locator('.card')).toHaveCount(count);
  }
});

test('AND 只作为弱辅助说明，多关键词继续同时满足', async ({ page }) => {
  await expect(page.locator('kbd')).toHaveCount(0);
  await expect(page.locator('.search-help')).toHaveText('多关键词同时满足');
  await page.locator('#query').fill('英雄 生命');
  await expect(page.locator('.card')).toHaveCount(2);
});

test('版本选择器只在 header 显示一次，移动端值仍可读', async ({ page }) => {
  await expect(page.locator('#patch')).toHaveCount(1);
  await expect(page.locator('header #patch')).toHaveValue('18.1');
  await expect(page.locator('#queryPanel #patch')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const fontSize = await page.locator('#patch').evaluate((node) => parseFloat(getComputedStyle(node).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(11);
});

test('reference autocomplete 可搜索、选择、生效及清除', async ({ page }) => {
  await page.locator('#advancedFilters summary').click();
  await page.locator('#referenceQuery').fill('Petri');
  await expect(page.locator('[data-reference-option="petrify_shields"]')).toBeVisible();
  await page.locator('[data-reference-option="petrify_shields"]').click();
  await expect(page.locator('#referenceChip')).toContainText('Petrify Shields');
  await expect(page.locator('.card')).toHaveCount(7);
  await page.locator('[data-clear-reference]').click();
  await expect(page.locator('.card')).toHaveCount(10);
});

test('卡片轻量操作可直接设为阶段参考', async ({ page }) => {
  await page.locator('[data-wisp-id="mitosis"] [data-set-reference]').click();
  await expect(page.locator('#referenceChip')).toContainText('Mitosis');
  await expect(page.locator('.card')).toHaveCount(1);
});

test('搜索只改变 Displayed Results/K，不改变 Candidate Pool N', async ({ page }) => {
  await page.locator('#probabilityMode').check();
  await expect(page.locator('[data-stat="n"]').first()).toHaveText('10');
  await page.locator('#query').fill('Mitosis');
  await expect(page.locator('[data-stat="n"]').first()).toHaveText('10');
  await expect(page.locator('[data-stat="k"]').first()).toHaveText('1');
});

test('可负担开关使用 boolean，并允许 3 金浏览 Field of Mice', async ({ page }) => {
  await page.locator('#query').fill('Field of Mice');
  await page.locator('#gold').fill('3');
  await expect(page.locator('[data-wisp-id="field_of_mice"]')).toHaveCount(0);
  await page.locator('#advancedFilters').evaluate((details: HTMLDetailsElement) => { details.open = true; });
  await page.locator('#affordableOnly').selectOption('false');
  await expect(page.locator('[data-wisp-id="field_of_mice"]')).toBeVisible();
});

test('排除后 N 减少，并可单项恢复或清空', async ({ page }) => {
  await page.locator('#probabilityMode').check();
  await expect(page.locator('[data-stat="n"]').first()).toHaveText('10');
  await page.locator('[data-wisp-id="mitosis"] [data-exclude]').click();
  await expect(page.locator('[data-stat="n"]').first()).toHaveText('9');
  await expect(page.locator('#excludedRegion')).toContainText('已排除 1 个');
  await page.locator('[data-restore="mitosis"]').click();
  await expect(page.locator('[data-stat="n"]').first()).toHaveText('10');
  await page.locator('[data-wisp-id="mitosis"] [data-exclude]').click();
  await page.locator('[data-clear-excluded]').click();
  await expect(page.locator('[data-stat="n"]').first()).toHaveText('10');
});

test('高级筛选及卡片 details 节点状态在无关输入后保持稳定', async ({ page }) => {
  const advanced = page.locator('#advancedFilters');
  await advanced.evaluate((details: HTMLDetailsElement) => { details.open = true; });
  await page.locator('#minCost').fill('1');
  await expect(advanced).toHaveJSProperty('open', true);
  const source = page.locator('[data-wisp-id="mitosis"] .source-details');
  await source.evaluate((details: HTMLDetailsElement) => { details.open = true; });
  await page.locator('#query').fill('复制器');
  await expect(source).toHaveJSProperty('open', true);
});

test('桌面滚动时完整查询面板不 sticky 遮挡结果', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.card').last().scrollIntoViewIfNeeded();
  const positions = await page.evaluate(() => ({ panelBottom: document.querySelector('#queryPanel')!.getBoundingClientRect().bottom, headerBottom: document.querySelector('header')!.getBoundingClientRect().bottom }));
  expect(positions.panelBottom).toBeLessThanOrEqual(positions.headerBottom);
});

test('搜索 SVG 垂直居中，桌面卡片正文可读且不溢出', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.search-icon')).toHaveCount(1);
  const metrics = await page.evaluate(() => {
    const icon = document.querySelector('.search-icon')!.getBoundingClientRect();
    const input = document.querySelector('#query')!.getBoundingClientRect();
    const card = document.querySelector('[data-wisp-id="field_of_mice"]') as HTMLElement;
    const effect = card.querySelector('.effect span') as HTMLElement;
    const requirement = card.querySelector('.requirements') as HTMLElement;
    const title = card.querySelector('h3') as HTMLElement;
    return {
      centerDelta: Math.abs((icon.top + icon.height / 2) - (input.top + input.height / 2)),
      iconPointerEvents: getComputedStyle(document.querySelector('.search-icon')!).pointerEvents,
      effectSize: parseFloat(getComputedStyle(effect).fontSize), requirementSize: parseFloat(getComputedStyle(requirement).fontSize),
      titleSize: parseFloat(getComputedStyle(title).fontSize), overflow: card.scrollWidth > card.clientWidth,
    };
  });
  expect(metrics.centerDelta).toBeLessThanOrEqual(1);
  expect(metrics.iconPointerEvents).toBe('none');
  expect(metrics.effectSize).toBeGreaterThanOrEqual(14);
  expect(metrics.requirementSize).toBeGreaterThanOrEqual(13);
  expect(metrics.titleSize).toBeGreaterThanOrEqual(17);
  expect(metrics.overflow).toBe(false);
});

test('patch 切换隔离卡片缓存、reference 与 excluded', async ({ page }) => {
  const source = JSON.parse(readFileSync('public/data/wisps.json', 'utf8')) as { records: Array<Record<string, unknown>> };
  const base = source.records[0]!;
  const fixture = {
    ...source,
    records: [
      { ...base, id: 'shared-18-1', nameZh: '共享仙灵', nameEn: 'Shared Wisp', patch: '18.1', effects: { normal: '18.1 旧效果' } },
      { ...base, id: 'shared-18-2', nameZh: '共享仙灵', nameEn: 'Shared Wisp', patch: '18.2', effects: { normal: '18.2 新效果' } },
    ],
  };
  await routeRuntimeFixture(page, fixture);
  await page.reload();
  await expect(page.locator('.normal-effect')).toContainText('18.1 旧效果');
  await page.locator('[data-set-reference="shared-18-1"]').click();
  await page.locator('#probabilityMode').check();
  await page.locator('[data-exclude="shared-18-1"]').click();
  await expect(page.locator('#excludedRegion')).toContainText('已排除 1 个');
  await page.locator('#patch').selectOption('18.2');
  await expect(page.locator('.normal-effect')).toContainText('18.2 新效果');
  await expect(page.locator('.normal-effect')).not.toContainText('18.1 旧效果');
  await expect(page.locator('#referenceChip')).toBeHidden();
  await expect(page.locator('#excludedRegion')).toBeHidden();
  await expect(page.locator('[data-stat="n"]').first()).toHaveText('1');
});

test('直接切换 patch 时只保留当前版本卡片', async ({ page }) => {
  const source = JSON.parse(readFileSync('public/data/wisps.json', 'utf8')) as { records: Array<Record<string, unknown>> };
  const base = source.records[0]!;
  const fixture = {
    ...source,
    records: [
      { ...base, id: 'shared-direct-old', patch: '18.1', effects: { normal: '直接切换旧效果' } },
      { ...base, id: 'shared-direct-new', patch: '18.2', effects: { normal: '直接切换新效果' } },
    ],
  };
  await routeRuntimeFixture(page, fixture);
  await page.reload();
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.normal-effect')).toContainText('直接切换旧效果');
  await page.locator('#patch').selectOption('18.2');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('.normal-effect')).toContainText('直接切换新效果');
  await expect(page.locator('.normal-effect')).not.toContainText('直接切换旧效果');
});

test('reviewed runtime synonyms, concepts, AND, and probability denominator work in the browser', async ({ page }) => {
  await useProductionRuntime(page);
  await page.reload();
  const search = page.locator('#query');
  await search.fill('重随');
  await expect(page.locator('.card')).toHaveCount(20);
  await expect(page.locator('[data-wisp-id="da_refreshinglight18"]')).toBeVisible();
  await search.fill('弈子转化');
  await expect(page.locator('.card')).toHaveCount(4);
  await expect(page.locator('[data-wisp-id="da_18_majorpolymorph"]')).toBeVisible();
  await search.fill('重随 金币');
  await expect(page.locator('.card')).toHaveCount(8);
  await page.locator('#probabilityMode').check();
  await expect(page.locator('[data-stat="n"]').first()).toHaveText('169');
  await search.fill('弈子星级');
  await expect(page.locator('[data-stat="n"]').first()).toHaveText('169');
  await expect(page.locator('[data-stat="k"]').first()).toHaveText('19');
});

test('missing reviewed runtime lexicon fails initialization instead of falling back', async ({ page }) => {
  await page.route('**/data/search-synonyms.json', route => route.fulfill({ status: 404 }));
  await page.reload();
  await expect(page.locator('.loading.error')).toContainText('搜索同义词数据 加载失败 (404)');
  await expect(page.locator('#query')).toHaveCount(0);
});

test('Wisp dataset 与 reviewed membership 不一致时浏览器初始化 fail-closed', async ({ page }) => {
  const seed = JSON.parse(readFileSync('data/wisps_18.1.json', 'utf8')) as { patch: string; records: Array<{ id: string; searchConcepts: string[] }> };
  const incompatibleConcepts = {
    ...productionConcepts,
    patch: seed.patch,
    normalizedRecordCount: seed.records.length,
    sourceGeneratorVersion: 'e2e-fixture',
    reviewedAgainstInputSha256: 'e2e-fixture',
    assignmentCount: 1,
    records: seed.records.map((record, index) => ({ wispId: record.id, conceptKeys: index === 0 ? ['champion_transform'] : record.searchConcepts })),
  };
  await page.route('**/data/search-concepts.json', route => route.fulfill({ json: incompatibleConcepts }));
  await page.reload();
  await expect(page.locator('.loading.error')).toContainText('reviewed concept membership 不一致');
  await expect(page.locator('#query')).toHaveCount(0);
});
