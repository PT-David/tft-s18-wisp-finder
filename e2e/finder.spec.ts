import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#resultCount')).toHaveText('10 个结果');
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
