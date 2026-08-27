import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateDataset } from './validation';

export async function validateFile(path: string): Promise<string[]> {
  return validateDataset(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const file = resolve(process.argv[2] ?? 'data/wisps_18.1.json');
  validateFile(file).then((errors) => {
    if (errors.length) { console.error(`数据验证失败 (${file}):\n${errors.map((error) => `- ${error}`).join('\n')}`); process.exitCode = 1; }
    else console.log(`数据验证成功: ${file}`);
  }).catch((error: unknown) => { console.error(`无法验证 ${file}:`, error); process.exitCode = 1; });
}
