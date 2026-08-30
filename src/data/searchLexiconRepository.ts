import type { RuntimeSearchLexicon, WispDataset } from '../domain/types';

const SCHEMA_VERSION = 1;
type Metadata = { schemaVersion: number; patch: string; sourceGeneratorVersion: string; reviewedAgainstInputSha256: string; normalizedRecordCount: number };
type ConceptsArtifact = Metadata & { assignmentCount: number; taxonomy: Array<{ key: string; labelZh: string }>; records: Array<{ wispId: string; conceptKeys: string[] }> };
type SynonymsArtifact = Metadata & { queryExpansionGroups: Array<{ groupKey: string; canonicalTerm: string; aliases: string[]; conceptKeys: string[] }>; recordAliases: Array<{ wispId: string; aliases: string[] }> };

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
  if (!Number.isInteger(concepts.assignmentCount) || concepts.assignmentCount < 0) throw new Error('search-concepts assignmentCount 无效');
  if (!Array.isArray(concepts.records)) throw new Error('search-concepts 缺少 records');
  if (!Array.isArray(synonyms.queryExpansionGroups)) throw new Error('search-synonyms 缺少 queryExpansionGroups');
  if (!Array.isArray(synonyms.recordAliases)) throw new Error('search-synonyms 缺少 recordAliases');
  const keys = new Set<string>();
  for (const item of concepts.taxonomy) {
    if (!item || typeof item.key !== 'string' || typeof item.labelZh !== 'string' || !item.key || !item.labelZh) throw new Error('taxonomy 定义无效');
    if (keys.has(item.key)) throw new Error(`taxonomy key 重复: ${item.key}`); keys.add(item.key);
  }
  for (const group of synonyms.queryExpansionGroups) {
    if (!group || typeof group.groupKey !== 'string' || typeof group.canonicalTerm !== 'string' || !Array.isArray(group.aliases) || !Array.isArray(group.conceptKeys)) throw new Error('queryExpansionGroup 定义无效');
    if (!group.aliases.every(alias => typeof alias === 'string') || !group.conceptKeys.every(key => typeof key === 'string' && keys.has(key))) throw new Error(`queryExpansionGroup 引用无效: ${group.groupKey}`);
  }
  for (const membership of concepts.records) if (!membership || typeof membership.wispId !== 'string' || !membership.wispId || !Array.isArray(membership.conceptKeys) || !membership.conceptKeys.every(key => typeof key === 'string' && keys.has(key))) throw new Error('search-concepts membership 无效');
  for (const aliases of synonyms.recordAliases) if (!aliases || typeof aliases.wispId !== 'string' || !aliases.wispId || !Array.isArray(aliases.aliases) || !aliases.aliases.every(alias => typeof alias === 'string')) throw new Error('search-synonyms recordAliases 无效');
  return { patch: conceptsMeta.patch, sourceGeneratorVersion: conceptsMeta.sourceGeneratorVersion, reviewedAgainstInputSha256: conceptsMeta.reviewedAgainstInputSha256, normalizedRecordCount: conceptsMeta.normalizedRecordCount, assignmentCount: concepts.assignmentCount, concepts: concepts.taxonomy, conceptMembership: concepts.records, queryExpansionGroups: synonyms.queryExpansionGroups, recordAliases: synonyms.recordAliases };
}

const exactSet = (left: readonly string[], right: readonly string[]): boolean => {
  const leftSet = new Set(left); const rightSet = new Set(right);
  return left.length === leftSet.size && right.length === rightSet.size && left.length === right.length && left.every(value => rightSet.has(value));
};

/** Fails closed when the independently deployed Wisp and reviewed-search artifacts diverge. */
export function assertRuntimeSearchCompatibility(dataset: WispDataset, lexicon: RuntimeSearchLexicon): void {
  if (dataset.patch !== lexicon.patch) throw new Error('仙灵数据与搜索词库 patch 不一致');
  if (dataset.records.length !== lexicon.normalizedRecordCount) throw new Error('仙灵数据与搜索词库 record count 不一致');
  const datasetIds = dataset.records.map(record => record.id); const membershipIds = lexicon.conceptMembership.map(record => record.wispId);
  if (!exactSet(datasetIds, membershipIds)) throw new Error('仙灵数据与搜索词库 Wisp identity set 不一致');
  const memberships = new Map(lexicon.conceptMembership.map(record => [record.wispId, record.conceptKeys]));
  const taxonomy = new Set(lexicon.concepts.map(concept => concept.key));
  for (const record of dataset.records) {
    if (record.searchConcepts.some(key => !taxonomy.has(key))) throw new Error(`仙灵数据包含未知搜索概念: ${record.id}`);
    if (!exactSet(record.searchConcepts, memberships.get(record.id) ?? [])) throw new Error(`仙灵数据与 reviewed concept membership 不一致: ${record.id}`);
  }
  if (dataset.records.reduce((sum, record) => sum + record.searchConcepts.length, 0) !== lexicon.assignmentCount) throw new Error('仙灵数据与搜索词库 assignment count 不一致');
  const aliases = new Map(lexicon.recordAliases.map(record => [record.wispId, record.aliases]));
  const aliasedDatasetIds = dataset.records.filter(record => record.synonyms.length > 0).map(record => record.id);
  if (!exactSet(aliasedDatasetIds, lexicon.recordAliases.map(record => record.wispId))) throw new Error('仙灵数据与搜索词库 record alias identity set 不一致');
  for (const record of dataset.records) if (!exactSet(record.synonyms, aliases.get(record.id) ?? [])) throw new Error(`仙灵数据与 reviewed record aliases 不一致: ${record.id}`);
}

async function fetchJson(url: string, label: string): Promise<unknown> {
  const response = await fetch(url); if (!response.ok) throw new Error(`${label} 加载失败 (${response.status})`);
  try { return await response.json(); } catch { throw new Error(`${label} JSON 格式无效`); }
}

export async function loadRuntimeSearchLexicon(conceptsUrl = searchConceptsDataUrl(), synonymsUrl = searchSynonymsDataUrl(), expectedPatch = '18.1'): Promise<RuntimeSearchLexicon> {
  const [concepts, synonyms] = await Promise.all([fetchJson(conceptsUrl, '搜索概念数据'), fetchJson(synonymsUrl, '搜索同义词数据')]);
  return parseRuntimeSearchLexicon(concepts, synonyms, expectedPatch);
}
