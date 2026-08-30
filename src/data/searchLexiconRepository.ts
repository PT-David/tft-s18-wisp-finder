import type { RuntimeSearchLexicon } from '../domain/types';

const SCHEMA_VERSION = 1;
type Metadata = { schemaVersion: number; patch: string; sourceGeneratorVersion: string; reviewedAgainstInputSha256: string; normalizedRecordCount: number };
type ConceptsArtifact = Metadata & { taxonomy: Array<{ key: string; labelZh: string }> };
type SynonymsArtifact = Metadata & { queryExpansionGroups: Array<{ groupKey: string; canonicalTerm: string; aliases: string[]; conceptKeys: string[] }> };

export const searchConceptsDataUrl = (baseUrl = import.meta.env.BASE_URL): string => `${baseUrl}data/search-concepts.json`;
export const searchSynonymsDataUrl = (baseUrl = import.meta.env.BASE_URL): string => `${baseUrl}data/search-synonyms.json`;

const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 格式无效`);
  return value as Record<string, unknown>;
};
const metadata = (value: unknown, label: string): Metadata => {
  const item = object(value, label);
  if (item.schemaVersion !== SCHEMA_VERSION) throw new Error(`${label} schemaVersion 不受支持`);
  for (const key of ['patch', 'sourceGeneratorVersion', 'reviewedAgainstInputSha256'] as const) if (typeof item[key] !== 'string' || !item[key]) throw new Error(`${label} 缺少 ${key}`);
  if (!Number.isInteger(item.normalizedRecordCount) || Number(item.normalizedRecordCount) < 1) throw new Error(`${label} normalizedRecordCount 无效`);
  return item as unknown as Metadata;
};

export function parseRuntimeSearchLexicon(conceptsValue: unknown, synonymsValue: unknown, expectedPatch = '18.1'): RuntimeSearchLexicon {
  const conceptsMeta = metadata(conceptsValue, 'search-concepts');
  const synonymsMeta = metadata(synonymsValue, 'search-synonyms');
  const concepts = conceptsValue as ConceptsArtifact; const synonyms = synonymsValue as SynonymsArtifact;
  if (conceptsMeta.patch !== expectedPatch || synonymsMeta.patch !== expectedPatch) throw new Error(`搜索词库 patch 与数据集 ${expectedPatch} 不一致`);
  for (const key of ['patch', 'sourceGeneratorVersion', 'reviewedAgainstInputSha256', 'normalizedRecordCount'] as const) {
    if (conceptsMeta[key] !== synonymsMeta[key]) throw new Error(`搜索词库 metadata.${key} 不一致`);
  }
  if (!Array.isArray(concepts.taxonomy)) throw new Error('search-concepts 缺少 taxonomy');
  if (!Array.isArray(synonyms.queryExpansionGroups)) throw new Error('search-synonyms 缺少 queryExpansionGroups');
  const keys = new Set<string>();
  for (const item of concepts.taxonomy) {
    if (!item || typeof item.key !== 'string' || typeof item.labelZh !== 'string' || !item.key || !item.labelZh) throw new Error('taxonomy 定义无效');
    if (keys.has(item.key)) throw new Error(`taxonomy key 重复: ${item.key}`); keys.add(item.key);
  }
  for (const group of synonyms.queryExpansionGroups) {
    if (!group || typeof group.groupKey !== 'string' || typeof group.canonicalTerm !== 'string' || !Array.isArray(group.aliases) || !Array.isArray(group.conceptKeys)) throw new Error('queryExpansionGroup 定义无效');
    if (!group.aliases.every(alias => typeof alias === 'string') || !group.conceptKeys.every(key => typeof key === 'string' && keys.has(key))) throw new Error(`queryExpansionGroup 引用无效: ${group.groupKey}`);
  }
  return { patch: conceptsMeta.patch, sourceGeneratorVersion: conceptsMeta.sourceGeneratorVersion, reviewedAgainstInputSha256: conceptsMeta.reviewedAgainstInputSha256, normalizedRecordCount: conceptsMeta.normalizedRecordCount, concepts: concepts.taxonomy, queryExpansionGroups: synonyms.queryExpansionGroups };
}

async function fetchJson(url: string, label: string): Promise<unknown> {
  const response = await fetch(url); if (!response.ok) throw new Error(`${label} 加载失败 (${response.status})`);
  try { return await response.json(); } catch { throw new Error(`${label} JSON 格式无效`); }
}

export async function loadRuntimeSearchLexicon(conceptsUrl = searchConceptsDataUrl(), synonymsUrl = searchSynonymsDataUrl(), expectedPatch = '18.1'): Promise<RuntimeSearchLexicon> {
  const [concepts, synonyms] = await Promise.all([fetchJson(conceptsUrl, '搜索概念数据'), fetchJson(synonymsUrl, '搜索同义词数据')]);
  return parseRuntimeSearchLexicon(concepts, synonyms, expectedPatch);
}
