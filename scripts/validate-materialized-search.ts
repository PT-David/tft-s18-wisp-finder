import { readFile } from 'node:fs/promises';
import type { WispDataset } from '../src/domain/types';
import type { DecisionOverlay } from './validate-search-lexicon-decisions';
import { materializeReviewedSearch, normalizedJson, type ConceptDraft, type SynonymDraft } from './data/lib/materialized-search';

const loadText = (path: string) => readFile(path, 'utf8');
const normalizedBytes = await readFile('data/normalized/wisps_18.1.json');
const dataset = JSON.parse(normalizedBytes.toString()) as WispDataset;
const concepts = JSON.parse(await loadText('data/overrides/18.1/search-concepts.draft.json')) as ConceptDraft;
const synonymDraft = JSON.parse(await loadText('data/overrides/18.1/synonyms.draft.json')) as SynonymDraft;
const decisions = JSON.parse(await loadText('data/reviews/18.1/search-lexicon-decisions.json')) as DecisionOverlay;
const expected = materializeReviewedSearch(dataset, normalizedBytes, concepts, synonymDraft, decisions);
const outputs = [
  ['search-concepts.json', expected.searchConcepts], ['synonyms.json', expected.synonyms], ['wisps.json', expected.wisps],
] as const;
const errors: string[] = [];
for (const [name, value] of outputs) {
  const actual = await loadText(`data/materialized/18.1/${name}`);
  if (actual !== normalizedJson(value)) errors.push(`${name} is stale or non-deterministically ordered; regenerate it`);
}
const taxonomyKeys = expected.searchConcepts.taxonomy.map(item => item.key);
const taxonomy = new Set(taxonomyKeys);
if (new Set(taxonomyKeys).size !== taxonomyKeys.length) errors.push('taxonomy keys are not unique');
if (taxonomyKeys.includes('survival_duration')) errors.push('stale taxonomy key survival_duration is present');
if (!taxonomyKeys.includes('survival_condition')) errors.push('taxonomy key survival_condition is absent');
const forbidden = new Set(['d', 'roll', '妮蔻', 'ap', 'ad', 'as', 'cc']);
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().trim();
const groupKeys = new Set<string>();
for (const group of expected.synonyms.queryExpansionGroups) {
  const groupKey = normalize(group.groupKey);
  if (groupKeys.has(groupKey)) errors.push(`duplicate materialized query expansion group: ${group.groupKey}`);
  groupKeys.add(groupKey);
  const aliases = new Set<string>();
  for (const alias of group.aliases) {
    const normalized = normalize(alias);
    if (aliases.has(normalized)) errors.push(`duplicate materialized alias: ${group.groupKey}/${alias}`);
    aliases.add(normalized);
    if (forbidden.has(normalized)) errors.push(`rejected alias is materialized: ${alias}`);
  }
  const conceptKeys = new Set<string>();
  for (const conceptKey of group.conceptKeys) {
    if (conceptKeys.has(conceptKey)) errors.push(`duplicate materialized query expansion concept key: ${group.groupKey}/${conceptKey}`);
    conceptKeys.add(conceptKey);
    if (!taxonomy.has(conceptKey)) errors.push(`unknown materialized query expansion concept key: ${group.groupKey}/${conceptKey}`);
  }
}
if (expected.synonyms.recordAliases.length !== 0) errors.push('materialized record aliases require explicit manual review');
const stripSearch = (value: WispDataset) => ({ ...value, records: value.records.map(({ searchConcepts: _concepts, synonyms: _synonyms, ...record }) => record) });
if (JSON.stringify(stripSearch(dataset)) !== JSON.stringify(stripSearch(expected.wisps))) errors.push('materialized Wisp core data differs from normalized input');
if (errors.length) { console.error(errors.map(error => `- ${error}`).join('\n')); process.exitCode = 1; }
else console.log(`Patch: ${concepts.patch}\nNormalized records: ${dataset.records.length}\nReviewed assignments: ${expected.reviewSummary.assignmentDecisions}\nMaterialized assignments: ${expected.searchConcepts.assignmentCount}\nTaxonomy definitions: ${taxonomyKeys.length}\nQuery expansion groups: ${expected.synonyms.queryExpansionGroups.length}\nApproved global aliases: ${expected.synonyms.queryExpansionGroups.reduce((sum, group) => sum + group.aliases.length, 0)}\nRecord aliases: ${expected.synonyms.recordAliases.reduce((sum, item) => sum + item.aliases.length, 0)}\nUnreviewed assignments: ${expected.reviewSummary.unreviewed}\nStale decisions: ${expected.reviewSummary.staleDecisions}\nCore-data differences: 0`);
