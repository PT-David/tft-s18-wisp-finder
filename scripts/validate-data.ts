import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateDataset } from './validation';

export async function validateFile(path: string): Promise<string[]> {
  return validateDataset(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

export function validateProvenanceSources(dataset: { records: Array<Record<string, unknown>> }, manifest: { sources: Array<{ sourceId: string }> }): string[] {
  const sourceIds = new Set(manifest.sources.map(({ sourceId }) => sourceId));
  return dataset.records.flatMap((record, index) => Object.entries((record.sources as Record<string, unknown> | undefined) ?? {}).flatMap(([field, source]) => {
    const sourceId = (source as { sourceId?: string }).sourceId;
    return sourceId && !sourceIds.has(sourceId) ? [`records[${index}].sources.${field}.sourceId: manifest 中不存在 "${sourceId}"`] : [];
  }));
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const file = resolve(process.argv[2] ?? 'data/wisps_18.1.json');
  Promise.all([validateFile(file), readFile(file, 'utf8'), readFile(resolve('public/data/wisps.json'), 'utf8'), readFile(resolve('reports/data-conflicts-18.1.json'), 'utf8'), readFile(resolve('data/raw/18.1/communitydragon-wisps-en.json'), 'utf8'), readFile(resolve('data/raw/18.1/communitydragon-wisps-zh.json'), 'utf8'), readFile(resolve('data/raw/18.1/datatft-wisps-zh.json'), 'utf8'), readFile(resolve('data/source_manifest_18.1.json'), 'utf8')]).then(([baseErrors, normalizedText, publicText, conflictText, cdEnText, cdZhText, dtText, manifestText]) => {
    const errors = [...baseErrors];
    if (process.argv.includes('--production')) {
      const dataset = JSON.parse(normalizedText) as { productionReady?: boolean; datasetStatus?: string; records: Array<Record<string, unknown>> };
      if (normalizedText !== publicText) errors.push('production: normalized 与 public 输出不一致');
      const riotIds = new Set<string>();
      const cdEn = (JSON.parse(cdEnText) as { records: Array<Record<string, unknown>> }).records;
      const cdZh = (JSON.parse(cdZhText) as { records: Array<Record<string, unknown>> }).records;
      const dt = (JSON.parse(dtText) as { records: Array<Record<string, unknown>> }).records;
      errors.push(...validateProvenanceSources(dataset, JSON.parse(manifestText) as { sources: Array<{ sourceId: string }> }));
      dataset.records.forEach((record, index) => {
        if (typeof record.riotId === 'string') { if (riotIds.has(record.riotId)) errors.push(`records[${index}].riotId: 重复 riotId "${record.riotId}"`); riotIds.add(record.riotId); }
        if (/待.*核对|placeholder/i.test(String(record.nameZh))) errors.push(`records[${index}].nameZh: 中文占位符`);
        const sources = record.sources as Record<string, unknown> | undefined;
        const provenanceFields = ['id','riotId','nameEn','nameZh','category','cost','stageRanges','effects','requirements','oncePerGame','reofferCooldownShops','patch', ...(record.minimumAffordableGold === undefined ? [] : ['minimumAffordableGold'])];
        for (const field of provenanceFields) if (!sources?.[field]) errors.push(`records[${index}].sources.${field}: 缺失关键字段 provenance`);
        const nameZhSource = (sources?.nameZh as { sourceId?: string } | undefined)?.sourceId ?? '';
        if (nameZhSource.includes('communitydragon') && !cdZh.some((raw) => raw.name === record.nameZh)) errors.push(`records[${index}].sources.nameZh: CommunityDragon raw 无对应中文证据`);
        if (nameZhSource.includes('datatft') && !dt.some((raw) => raw.nameZh === record.nameZh)) errors.push(`records[${index}].sources.nameZh: DataTFT raw 无对应中文证据`);
        const nameEnSource = (sources?.nameEn as { sourceId?: string } | undefined)?.sourceId ?? '';
        if (nameEnSource.includes('communitydragon') && !cdEn.some((raw) => raw.apiName === record.riotId && raw.name === record.nameEn)) errors.push(`records[${index}].sources.nameEn: CommunityDragon raw 无对应英文证据`);
      });
      const unresolved = (JSON.parse(conflictText) as Array<{ resolution: string }>).some((item) => item.resolution === 'needs_review');
      if (unresolved && dataset.productionReady !== false) errors.push('production: 存在 needs_review 冲突时 productionReady 必须为 false');
      if (!dataset.datasetStatus) errors.push('production: 缺失 datasetStatus');
    }
    if (errors.length) { console.error(`数据验证失败 (${file}):\n${errors.map((error) => `- ${error}`).join('\n')}`); process.exitCode = 1; }
    else console.log(`数据验证成功: ${file}`);
  }).catch((error: unknown) => { console.error(`无法验证 ${file}:`, error); process.exitCode = 1; });
}
