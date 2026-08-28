import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseBrowserSnapshot, type BrowserSource } from './lib/browser-snapshot';

const source = process.argv[2] as BrowserSource;
const input = process.argv[3];
if (!['opgg', 'lolchess'].includes(source) || !input) throw new Error('用法: tsx scripts/data/import-browser-snapshot.ts <opgg|lolchess> <saved.html>');
const html = await readFile(resolve(input), 'utf8');
const parsed = parseBrowserSnapshot(source, html);
const importedAt = new Date().toISOString();
const snapshot = { sourceId: `${source}_set18_wisps_browser_import`, url: parsed.sourceUrl, locale: parsed.sourceUrl.match(/op\.gg\/([^/]+)/)?.[1] ?? 'en', importedAt, retrievedAt: importedAt, pageUpdatedAt: parsed.pageUpdatedAt, sha256: parsed.sha256, fetchStatus: 'browser_snapshot_imported', recordCount: parsed.records.length, records: parsed.records };
const output = resolve(`data/raw/18.1/${source === 'opgg' ? 'opgg-wisps-zh.json' : 'lolchess-wisps.json'}`);
await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`已解析 ${snapshot.recordCount} 条记录 -> ${output}`);
