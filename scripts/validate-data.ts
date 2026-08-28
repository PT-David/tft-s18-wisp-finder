import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateDataset } from './validation';

export async function validateFile(path: string): Promise<string[]> {
  return validateDataset(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const file = resolve(process.argv[2] ?? 'data/wisps_18.1.json');
  Promise.all([validateFile(file), readFile(file, 'utf8'), readFile(resolve('public/data/wisps.json'), 'utf8'), readFile(resolve('reports/data-conflicts-18.1.json'), 'utf8')]).then(([baseErrors, normalizedText, publicText, conflictText]) => {
    const errors = [...baseErrors];
    if (process.argv.includes('--production')) {
      const dataset = JSON.parse(normalizedText) as { productionReady?: boolean; datasetStatus?: string; records: Array<Record<string, unknown>> };
      if (normalizedText !== publicText) errors.push('production: normalized 与 public 输出不一致');
      const riotIds = new Set<string>();
      dataset.records.forEach((record, index) => {
        if (typeof record.riotId === 'string') { if (riotIds.has(record.riotId)) errors.push(`records[${index}].riotId: 重复 riotId "${record.riotId}"`); riotIds.add(record.riotId); }
        if (/待.*核对|placeholder/i.test(String(record.nameZh))) errors.push(`records[${index}].nameZh: 中文占位符`);
        const sources = record.sources as Record<string, unknown> | undefined;
        for (const field of ['id','riotId','nameEn','nameZh','category','cost','minimumAffordableGold','stageRanges','effects','requirements','oncePerGame','reofferCooldownShops','patch']) if (!sources?.[field]) errors.push(`records[${index}].sources.${field}: 缺失关键字段 provenance`);
      });
      const unresolved = (JSON.parse(conflictText) as Array<{ resolution: string }>).some((item) => item.resolution === 'needs_review');
      if (unresolved && dataset.productionReady !== false) errors.push('production: 存在 needs_review 冲突时 productionReady 必须为 false');
      if (!dataset.datasetStatus) errors.push('production: 缺失 datasetStatus');
    }
    if (errors.length) { console.error(`数据验证失败 (${file}):\n${errors.map((error) => `- ${error}`).join('\n')}`); process.exitCode = 1; }
    else console.log(`数据验证成功: ${file}`);
  }).catch((error: unknown) => { console.error(`无法验证 ${file}:`, error); process.exitCode = 1; });
}
