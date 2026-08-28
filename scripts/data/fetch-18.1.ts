import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const cache = resolve(root, 'artifacts/cache/communitydragon');
const raw = resolve(root, 'data/raw/18.1');
const retrievedAt = new Date().toISOString();
const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

async function fetchText(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return { body: await response.text(), modified: response.headers.get('last-modified') };
}

async function main() {
  await mkdir(cache, { recursive: true }); await mkdir(raw, { recursive: true });
  for (const locale of ['en_us', 'zh_cn']) {
    const url = `https://raw.communitydragon.org/latest/cdragon/tft/${locale}.json`;
    const response = await fetchText(url); await writeFile(resolve(cache, `${locale}.json`), response.body);
    const items = (JSON.parse(response.body) as { items: Array<Record<string, unknown>> }).items
      .filter((item) => String(item.icon).includes('set18_mechanicicon'))
      .map(({ apiName, name, desc, effects, icon, tags }) => ({ apiName, name, desc, effects, icon, tags }));
    const snapshot = { sourceId: `communitydragon_live_18_1_${sha256(response.body).slice(0, 12)}_${locale}`, retrievedAt, upstreamModifiedAt: response.modified, url, locale, records: items };
    await writeFile(resolve(raw, `communitydragon-wisps-${locale === 'en_us' ? 'en' : 'zh'}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
  }
  const browser = await chromium.launch(); const page = await browser.newPage({ ignoreHTTPSErrors: true });
  await page.goto('https://www.datatft.com/database#charm', { waitUntil: 'networkidle' }); await page.waitForSelector('.charm-item');
  const records = await page.locator('.charm-item').evaluateAll((cards) => cards.map((card, sourceIndex) => {
    const one = (selector: string) => card.querySelector(selector); const all = (selector: string) => [...card.querySelectorAll(selector)];
    const icon = one('.charm-type-img')?.getAttribute('src') ?? '';
    const labelsZh = all(':scope > .charm-labels .charm-label').map((node) => node.textContent?.trim() ?? '');
    const variant = (selector: string) => { const node = one(selector); return node ? { cost: Number(node.querySelector('.charm-variant-cost > div')?.textContent ?? 0), effectZh: node.querySelector('.charm-desc')?.textContent?.trim() ?? '' } : null; };
    return { sourceIndex, key: null, nameZh: one('.charm-title')?.textContent?.trim(), category: icon.match(/\/([a-z]+)_tier/)?.[1] ?? null, tier: Number(icon.match(/tier(\d+)/)?.[1] ?? 0), cost: Number(one(':scope > .charm-line .charm-cost > div')?.textContent ?? 0), effectZh: one(':scope > .charm-desc')?.textContent?.trim(), labelsZh, upgrade: variant('.charm-variant-upgrade'), prismatic: variant('.charm-variant-prismatic') };
  }));
  const updated = (await page.locator('.database-meta-value').allTextContents())[1] ?? null; await browser.close();
  const snapshot = { sourceId: `datatft_18_1_${retrievedAt.slice(0, 10).replaceAll('-', '')}`, retrievedAt, pageUpdatedAt: updated, url: 'https://www.datatft.com/database#charm', locale: 'zh_cn', records };
  await writeFile(resolve(raw, 'datatft-wisps-zh.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
  for (const source of [
    { file: 'opgg-wisps-corpus.json', sourceId: 'opgg_set18_wisps', url: 'https://op.gg/tft/set/18/wisps' },
    { file: 'lolchess-fetch-status.json', sourceId: 'lolchess_wisps_18_1', url: 'https://lolchess.gg/rewards/set18/wisps' },
  ]) {
    const previous = JSON.parse(await readFile(resolve(raw, source.file), 'utf8')) as Record<string, unknown>;
    const response = await fetch(source.url).catch(() => undefined);
    const blocked = !response?.ok || response.status === 202;
    const status = { sourceId: source.sourceId, url: source.url, retrievedAt, fetchStatus: blocked ? 'blocked_by_source_protection' : 'fetched_requires_extractor_review', httpStatus: response?.status ?? null, records: [], humanReviewObservation: previous.humanReviewObservation, warning: blocked ? 'Source protection blocked this execution path; no bypass was attempted and no empty page was accepted.' : 'HTML was reachable but is not accepted until a source-specific minimal extractor is reviewed.' };
    await writeFile(resolve(raw, source.file), `${JSON.stringify(status, null, 2)}\n`);
  }
  console.log(`Fetched ${records.length} DataTFT rows. Cache hashes: ${sha256(await readFile(resolve(cache, 'en_us.json')))}, ${sha256(await readFile(resolve(cache, 'zh_cn.json')))}`);
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
