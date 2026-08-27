import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type RecordWithId = { id: string; [key: string]: Json };

function differences(before: Json, after: Json, path = ''): string[] {
  if (Object.is(before, after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const size = Math.max(before.length, after.length);
    return Array.from({ length: size }, (_, index) => differences(before[index], after[index], `${path}[${index}]`)).flat();
  }
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) => differences(before[key], after[key], path ? `${path}.${key}` : key));
  }
  return [`${path}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`];
}

export function diffRecords(before: readonly RecordWithId[], after: readonly RecordWithId[]) {
  const oldMap = new Map(before.map((item) => [item.id, item]));
  const newMap = new Map(after.map((item) => [item.id, item]));
  return {
    added: after.filter((item) => !oldMap.has(item.id)).map((item) => item.id),
    removed: before.filter((item) => !newMap.has(item.id)).map((item) => item.id),
    changed: before.flatMap((item) => newMap.has(item.id) ? differences(item, newMap.get(item.id)!, item.id) : []),
  };
}

async function main() {
  const [oldPath, newPath] = process.argv.slice(2);
  if (!oldPath || !newPath) throw new Error('用法: npm run diff:data -- <旧数据.json> <新数据.json>');
  const load = async (path: string) => JSON.parse(await readFile(resolve(path), 'utf8')) as { records: RecordWithId[] };
  const result = diffRecords((await load(oldPath)).records, (await load(newPath)).records);
  console.log(`新增 (${result.added.length}): ${result.added.join(', ') || '无'}`);
  console.log(`删除 (${result.removed.length}): ${result.removed.join(', ') || '无'}`);
  console.log(`字段变化 (${result.changed.length}):\n${result.changed.map((line) => `- ${line}`).join('\n') || '无'}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
