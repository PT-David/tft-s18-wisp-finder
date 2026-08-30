import { readFile } from 'node:fs/promises';
import type { WispDataset } from '../src/domain/types';
import { parseRuntimeSearchLexicon } from '../src/data/searchLexiconRepository';
const pairs = [['data/materialized/18.1/wisps.json', 'public/data/wisps.json'], ['data/materialized/18.1/search-concepts.json', 'public/data/search-concepts.json'], ['data/materialized/18.1/synonyms.json', 'public/data/search-synonyms.json']] as const;
const errors: string[] = [];
for (const [source, target] of pairs) if (!(await readFile(source)).equals(await readFile(target))) errors.push(`${target} is not byte-for-byte equal to ${source}`);
const dataset = JSON.parse(await readFile(pairs[0][1], 'utf8')) as WispDataset;
const concepts = JSON.parse(await readFile(pairs[1][1], 'utf8')); const synonyms = JSON.parse(await readFile(pairs[2][1], 'utf8'));
try {
  const lexicon = parseRuntimeSearchLexicon(concepts, synonyms, dataset.patch);
  const assignmentCount = dataset.records.reduce((sum, record) => sum + record.searchConcepts.length, 0);
  const aliases = lexicon.queryExpansionGroups.reduce((sum, group) => sum + group.aliases.length, 0);
  const recordAliases = dataset.records.reduce((sum, record) => sum + record.synonyms.length, 0);
  for (const [actual, expected, label] of [[dataset.records.length,169,'records'],[assignmentCount,289,'assignments'],[lexicon.concepts.length,40,'taxonomy'],[lexicon.queryExpansionGroups.length,10,'groups'],[aliases,27,'aliases'],[recordAliases,0,'recordAliases']] as const) if (actual !== expected) errors.push(`expected ${expected} ${label}, got ${actual}`);
  if (!errors.length) console.log(`Runtime search valid: records=${dataset.records.length}, assignments=${assignmentCount}, taxonomy=${lexicon.concepts.length}, groups=${lexicon.queryExpansionGroups.length}, aliases=${aliases}, recordAliases=${recordAliases}`);
} catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
if (errors.length) { console.error(errors.map(error => `- ${error}`).join('\n')); process.exitCode = 1; }
