import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const source = resolve(root, 'data/materialized/18.1');
const target = resolve(root, 'public/data');
await mkdir(target, { recursive: true });
for (const [from, to] of [['wisps.json', 'wisps.json'], ['search-concepts.json', 'search-concepts.json'], ['synonyms.json', 'search-synonyms.json']] as const) await copyFile(resolve(source, from), resolve(target, to));
console.log('Published reviewed 18.1 search artifacts to public/data (byte-for-byte).');
