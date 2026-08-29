import { readFile, writeFile, mkdir } from 'node:fs/promises';
import type { WispDataset } from '../../src/domain/types';
import { generateSearchLexicon, INPUT_PATH } from './lib/search-lexicon';

const bytes = await readFile(INPUT_PATH);
const output = generateSearchLexicon(JSON.parse(bytes.toString()) as WispDataset, bytes);
await mkdir('data/overrides/18.1', { recursive: true });
await mkdir('reports', { recursive: true });
await Promise.all([
  writeFile('data/overrides/18.1/search-concepts.draft.json', `${JSON.stringify(output.conceptDraft, null, 2)}\n`),
  writeFile('data/overrides/18.1/synonyms.draft.json', `${JSON.stringify(output.synonymDraft, null, 2)}\n`),
  writeFile('reports/search-lexicon-review-18.1.json', `${JSON.stringify(output.report, null, 2)}\n`),
]);
console.log(`C2.1: ${output.report.summary.recordsScanned} records, ${output.report.summary.conceptCandidateAssignments} concept candidates, ${output.report.summary.needsReviewCandidates} need review.`);
