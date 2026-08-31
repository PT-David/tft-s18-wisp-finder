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

async function searchHighlightRanges(page: Page): Promise<Array<{ text: string; wispId: string | null; field: string | null }>> {
  return page.evaluate(() => {
    const highlight = CSS.highlights.get('wisp-search-match');
    return highlight ? [...highlight].map((range) => {
      const parent = range.startContainer.parentElement;
      return { text: range.toString(), wispId: parent?.closest<HTMLElement>('[data-wisp-id]')?.dataset.wispId ?? null, field: parent?.dataset.searchField ?? null };
    }) : [];
  });
}

test.beforeEach(async ({ page }) => {
  const seed = JSON.parse(readFileSync('data/wisps_18.1.json', 'utf8'));
  await routeRuntimeFixture(page, seed);
  await page.goto('/');
  await expect(page.locator('#resultCount')).toHaveText('10 个结果');
});

test('结果数量保留二级标题语义与 polite announcement，搜索不抢 focus', async ({ page }) => {
  const resultHeading = page.getByRole('heading', { level: 2, name: /个结果/ });
  await expect(resultHeading).toHaveText('10 个结果');
  await expect(resultHeading).toHaveAttribute('aria-live', 'polite');
  await expect(resultHeading).toHaveAttribute('aria-atomic', 'true');
  await expect(resultHeading).not.toHaveAttribute('role', 'status');

  const search = page.locator('#query');
  await search.fill('Mitosis');
  await expect(resultHeading).toHaveText('1 个结果');
  await expect(search).toBeFocused();
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
  await expect(page.locator('[data-wisp-id="da_refreshinglight18"] [data-match-reason]')).toContainText('重随');
  await search.fill('弈子转化');
  await expect(page.locator('.card')).toHaveCount(4);
  await expect(page.locator('[data-wisp-id="da_18_majorpolymorph"]')).toBeVisible();
  await expect(page.locator('[data-wisp-id="da_18_majorpolymorph"] [data-match-reason]')).toHaveText('概念：弈子转化');
  await expect(page.locator('.cards')).not.toContainText('champion_transform');
  await search.fill('重随 金币');
  await expect(page.locator('.card')).toHaveCount(8);
  const multiReasons = page.locator('.card').first().locator('[data-match-reason]');
  await expect(multiReasons).toHaveCount(2);
  await expect(multiReasons.nth(0)).toHaveText('同义·普通：刷新');
  await expect(multiReasons.nth(1)).toContainText('金币');
  await page.locator('#probabilityMode').check();
  await expect(page.locator('[data-stat="n"]').first()).toHaveText('169');
  await search.fill('弈子星级');
  await expect(page.locator('[data-stat="n"]').first()).toHaveText('169');
  await expect(page.locator('[data-stat="k"]').first()).toHaveText('19');
});

test('match reasons update cached cards, clear cleanly, preserve phrases, and never highlight', async ({ page }) => {
  await useProductionRuntime(page);
  await page.reload();
  const search = page.locator('#query');
  const happy = page.locator('.card', { hasText: '元气满满' });
  await search.fill('法强');
  await expect(happy.locator('[data-match-reason]')).toHaveText('同义·普通：法术加成');
  const original = await happy.evaluateHandle(node => node);
  await search.fill('攻击力');
  await expect(happy.locator('[data-match-reason]')).toHaveText('同义·普通：物理加成');
  expect(await happy.evaluate((node, cached) => node === cached, original)).toBe(true);
  await expect(happy.locator('[data-match-reasons]')).not.toContainText('法术加成');
  await search.fill('Champion Duplicator');
  await expect(page.locator('.card').first().locator('[data-match-reason]')).toHaveCount(1);
  await expect(page.locator('mark')).toHaveCount(0);
  await search.fill('');
  await expect(page.locator('[data-match-reasons]:visible')).toHaveCount(0);
  await expect(page.locator('[data-match-reason]')).toHaveCount(0);
  await expect(search).toBeFocused();
});

test('optional structured highlights default off, refresh cached cards, and preserve K/N', async ({ page }) => {
  await useProductionRuntime(page);
  await page.reload();
  await expect.poll(() => page.evaluate(() => typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && 'highlights' in CSS)).toBe(true);
  const toggle = page.getByLabel('高亮匹配');
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();
  const search = page.locator('#query');
  await search.fill('法强');
  await expect(page.locator('.card')).toHaveCount(4);
  await expect(page.locator('.card', { hasText: '元气满满' }).locator('[data-match-reason]')).toHaveText('同义·普通：法术加成');
  expect(await searchHighlightRanges(page)).toEqual([]);
  await page.locator('#probabilityMode').check();
  const before = await page.locator('.prob-block').first().innerText();
  await toggle.check();
  const ranges = await searchHighlightRanges(page);
  expect(ranges.some(({ text, field }) => text === '法术加成' && field === 'effects.normal')).toBe(true);
  expect(ranges.every(({ field }) => field !== null)).toBe(true);
  expect(await page.locator('.prob-block').first().innerText()).toBe(before);
  await expect(page.locator('.card')).toHaveCount(4);
  await expect(page.locator('mark')).toHaveCount(0);

  await search.fill('攻击力');
  const updated = await searchHighlightRanges(page);
  expect(updated.some(({ text }) => text === '物理加成')).toBe(true);
  expect(updated.some(({ text }) => text === '法术加成')).toBe(false);
  await search.fill('');
  expect(await searchHighlightRanges(page)).toEqual([]);
  await expect(toggle).toBeChecked();
  await search.fill('法强');
  expect((await searchHighlightRanges(page)).length).toBeGreaterThan(0);
  await toggle.uncheck();
  expect(await searchHighlightRanges(page)).toEqual([]);
  await expect(page.locator('[data-match-reason]')).not.toHaveCount(0);
});

test('direct, concept-only, multi-clause, and collapsed Prismatic ranges use structured targets', async ({ page }) => {
  await useProductionRuntime(page);
  await page.reload();
  const search = page.locator('#query');
  await page.getByLabel('高亮匹配').check();
  await search.fill('重随');
  await expect(page.locator('.card')).toHaveCount(20);
  expect((await searchHighlightRanges(page)).some(({ text, wispId, field }) => text === '重随' && wispId === 'da_refreshinglight18' && field === 'effects.normal')).toBe(true);

  await search.fill('弈子转化');
  await expect(page.locator('.card')).toHaveCount(4);
  await expect(page.locator('[data-wisp-id="da_18_majorpolymorph"] [data-match-reason]')).toHaveText('概念：弈子转化');
  expect((await searchHighlightRanges(page)).filter(({ wispId }) => wispId === 'da_18_majorpolymorph')).toEqual([]);

  await search.fill('重随 金币');
  await expect(page.locator('.card')).toHaveCount(8);
  const multi = await searchHighlightRanges(page);
  expect(new Set(multi.map(({ text }) => text)).has('刷新')).toBe(true);
  expect(multi.some(({ text }) => text.includes('金币'))).toBe(true);
  await expect(page.locator('.card').first().locator('[data-match-reason]')).toHaveCount(2);

  await search.fill('提高150');
  const prismatic = page.locator('[data-wisp-id="da_18_counterspell"] .prismatic-details');
  await expect(prismatic).toBeVisible();
  await expect(prismatic).not.toHaveAttribute('open', '');
  expect((await searchHighlightRanges(page)).some(({ text, field }) => text === '提高150' && field === 'effects.prismatic')).toBe(true);
  await prismatic.locator('summary').click();
  await expect(prismatic).toHaveAttribute('open', '');
});

test('all structured occurrences share one registry entry and tabs clear/rebuild it', async ({ page }) => {
  const source = JSON.parse(readFileSync('public/data/wisps.json', 'utf8')) as { records: Array<Record<string, unknown>> };
  const fixture = { ...source, records: [{ ...source.records[0], id: 'repeated', nameZh: '重复测试', nameEn: 'Repeated', effects: { normal: '生命值……生命值', blossom: null, prismatic: null }, searchConcepts: [], synonyms: [] }] };
  await routeRuntimeFixture(page, fixture as Parameters<typeof routeRuntimeFixture>[1]);
  await page.reload();
  await page.locator('#query').fill('生命值');
  await page.getByLabel('高亮匹配').check();
  expect((await searchHighlightRanges(page)).map(({ text }) => text).filter(text => text === '生命值')).toHaveLength(2);
  await page.getByRole('button', { name: '刷新规律' }).click();
  expect(await searchHighlightRanges(page)).toEqual([]);
  await page.getByRole('button', { name: '仙灵查询' }).click();
  expect((await searchHighlightRanges(page)).map(({ text }) => text).filter(text => text === '生命值')).toHaveLength(2);
});

test('match reason chips wrap without card overflow on desktop and mobile', async ({ page }) => {
  await useProductionRuntime(page);
  await page.reload();
  await page.locator('#query').fill('重随 金币');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const overflows = await page.locator('.card').evaluateAll(cards => cards.map(card => card.scrollWidth > card.clientWidth));
    expect(overflows).not.toContain(true);
  }
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
