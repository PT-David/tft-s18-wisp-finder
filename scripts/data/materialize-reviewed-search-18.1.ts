import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { WispDataset } from '../../src/domain/types';
import type { DecisionOverlay } from '../validate-search-lexicon-decisions';
import { materializeReviewedSearch, normalizedJson, type ConceptDraft, type SynonymDraft } from './lib/materialized-search';

const paths = {
  normalized: 'data/normalized/wisps_18.1.json', concepts: 'data/overrides/18.1/search-concepts.draft.json',
  synonyms: 'data/overrides/18.1/synonyms.draft.json', decisions: 'data/reviews/18.1/search-lexicon-decisions.json',
  output: 'data/materialized/18.1',
};
const inputBytes = await readFile(paths.normalized);
const dataset = JSON.parse(inputBytes.toString()) as WispDataset;
const concepts = JSON.parse(await readFile(paths.concepts, 'utf8')) as ConceptDraft;
const synonyms = JSON.parse(await readFile(paths.synonyms, 'utf8')) as SynonymDraft;
const decisions = JSON.parse(await readFile(paths.decisions, 'utf8')) as DecisionOverlay;
const result = materializeReviewedSearch(dataset, inputBytes, concepts, synonyms, decisions);
await mkdir(paths.output, { recursive: true });
await Promise.all([
  writeFile(`${paths.output}/search-concepts.json`, normalizedJson(result.searchConcepts)),
  writeFile(`${paths.output}/synonyms.json`, normalizedJson(result.synonyms)),
  writeFile(`${paths.output}/wisps.json`, normalizedJson(result.wisps)),
]);
console.log(`Patch: ${concepts.patch}\nNormalized records: ${dataset.records.length}\nReviewed assignments: ${result.reviewSummary.assignmentDecisions}\nMaterialized assignments: ${result.searchConcepts.assignmentCount}\nTaxonomy definitions: ${result.searchConcepts.taxonomy.length}\nQuery expansion groups: ${result.synonyms.queryExpansionGroups.length}\nApproved global aliases: ${result.synonyms.queryExpansionGroups.reduce((sum, group) => sum + group.aliases.length, 0)}\nRecord aliases: ${result.synonyms.recordAliases.reduce((sum, item) => sum + item.aliases.length, 0)}\nUnreviewed assignments: ${result.reviewSummary.unreviewed}\nStale decisions: ${result.reviewSummary.staleDecisions}\nCore-data differences: 0`);
