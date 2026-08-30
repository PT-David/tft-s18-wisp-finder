import { createHash } from 'node:crypto';
import type { WispDataset } from '../../../src/domain/types';
import { summarizeAssignmentReview, validateDecisionOverlay, type DecisionOverlay } from '../../validate-search-lexicon-decisions';

export const MATERIALIZED_SCHEMA_VERSION = 1;
export const normalizedJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
export const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const compare = (a: string, b: string) => a.localeCompare(b, 'en');
const assignmentKey = (wispId: string, conceptKey: string) => `${wispId}\0${conceptKey}`;

export interface ConceptDraft {
  patch: string; generatorVersion: string; input: { sha256: string; recordCount: number };
  taxonomy: { key: string; [key: string]: unknown }[];
  assignments: { wispId: string; conceptKey: string }[];
}
export interface SynonymDraft {
  patch: string; generatorVersion: string; input: { sha256: string; recordCount: number };
  queryExpansionGroups: { key: string; canonicalTerm: string; conceptKeys?: string[]; aliases: { term: string }[] }[];
  recordAliases: { wispId: string; aliases: string[] }[];
}

export function effectiveAssignments(decisions: DecisionOverlay) {
  const result = new Set<string>();
  for (const decision of decisions.assignmentDecisions) {
    if (decision.action === 'approved') result.add(assignmentKey(decision.wispId, decision.conceptKey));
    if (decision.action === 'modified' && decision.replacementConceptKey) result.add(assignmentKey(decision.wispId, decision.replacementConceptKey));
  }
  return result;
}

export function materializeReviewedSearch(dataset: WispDataset, inputBytes: Buffer, concepts: ConceptDraft, synonyms: SynonymDraft, decisions: DecisionOverlay) {
  const errors = validateDecisionOverlay(decisions, concepts, synonyms);
  const actualSha = sha256(inputBytes);
  if (actualSha !== concepts.input.sha256 || actualSha !== decisions.metadata.reviewedAgainstInputSha256) errors.push('manual review is stale: actual normalized input SHA changed');
  if (dataset.patch !== concepts.patch || dataset.records.length !== concepts.input.recordCount) errors.push('normalized dataset metadata does not match reviewed drafts');
  const wispIds = new Set(dataset.records.map(record => record.id));
  if (wispIds.size !== dataset.records.length) errors.push('normalized dataset contains duplicate Wisp IDs');
  for (const assignment of concepts.assignments) if (!wispIds.has(assignment.wispId)) errors.push(`unknown Wisp in generated assignment: ${assignment.wispId}`);
  for (const alias of synonyms.recordAliases) if (!wispIds.has(alias.wispId)) errors.push(`unknown Wisp in record aliases: ${alias.wispId}`);
  if (errors.length) throw new Error(errors.join('\n'));

  const effective = effectiveAssignments(decisions);
  const byWisp = new Map<string, string[]>();
  for (const key of effective) {
    const [wispId, conceptKey] = key.split('\0');
    const values = byWisp.get(wispId!) ?? [];
    values.push(conceptKey!); byWisp.set(wispId!, values);
  }
  const aliasesByWisp = new Map(synonyms.recordAliases.map(item => [item.wispId, [...new Set(item.aliases)].sort(compare)]));
  const metadata = {
    schemaVersion: MATERIALIZED_SCHEMA_VERSION, patch: concepts.patch,
    sourceGeneratorVersion: concepts.generatorVersion,
    reviewedAgainstInputSha256: concepts.input.sha256,
    normalizedRecordCount: dataset.records.length,
  };
  const records = dataset.records.map(record => ({ wispId: record.id, conceptKeys: [...new Set(byWisp.get(record.id) ?? [])].sort(compare) })).sort((a, b) => compare(a.wispId, b.wispId));
  const searchConcepts = { ...metadata, assignmentCount: effective.size, taxonomy: [...concepts.taxonomy].sort((a, b) => compare(a.key, b.key)), records };
  const decisionGroups = new Map(decisions.queryExpansionDecisions.map(item => [item.groupKey.normalize('NFKC').toLocaleLowerCase().trim(), item]));
  const groups = synonyms.queryExpansionGroups.map(group => ({
    groupKey: group.key, canonicalTerm: group.canonicalTerm,
    aliases: [...decisionGroups.get(group.key.normalize('NFKC').toLocaleLowerCase().trim())!.approved].sort(compare),
    conceptKeys: [...(group.conceptKeys ?? [])].sort(compare),
  })).sort((a, b) => compare(a.groupKey, b.groupKey));
  const synonymArtifact = { ...metadata, queryExpansionGroups: groups, recordAliases: [...synonyms.recordAliases].map(item => ({ wispId: item.wispId, aliases: aliasesByWisp.get(item.wispId)! })).sort((a,b) => compare(a.wispId,b.wispId)) };
  const wisps = { ...dataset, records: dataset.records.map(record => ({ ...record, searchConcepts: [...(byWisp.get(record.id) ?? [])].sort(compare), synonyms: aliasesByWisp.get(record.id) ?? [] })) };
  return { searchConcepts, synonyms: synonymArtifact, wisps, reviewSummary: summarizeAssignmentReview(decisions, concepts) };
}
