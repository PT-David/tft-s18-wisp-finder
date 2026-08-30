import { readFileSync } from 'node:fs';

export interface DecisionOverlay {
  metadata: { schemaVersion: number; patch: string; reviewedAgainstGeneratorVersion: string; reviewedAgainstInputSha256: string };
  policy: { precisionFirst: boolean };
  taxonomyDecisions: { action: string; key: string; fromKey?: string; reason: string }[];
  queryExpansionDecisions: { groupKey: string; approved: string[]; rejected: { alias: string; reason: string }[] }[];
  assignmentDecisions: AssignmentDecision[];
}
export interface AssignmentDecision {
  wispId: string;
  conceptKey: string;
  action: 'approved' | 'rejected' | 'modified';
  reason: string;
  replacementConceptKey?: string;
}
interface Draft { patch: string; generatorVersion: string; input: { sha256: string }; taxonomy?: { key: string }[]; assignments?: { wispId: string; conceptKey: string; confidence?: string }[]; queryExpansionGroups?: { key: string; conceptKeys?: string[]; aliases: { term: string }[] }[]; recordAliases?: unknown[] }

export interface AssignmentReviewSummary {
  generatedAssignments: number;
  assignmentDecisions: number;
  approved: number;
  rejected: number;
  modified: number;
  unreviewed: number;
  staleDecisions: number;
}

const assignmentKey = ({ wispId, conceptKey }: { wispId: string; conceptKey: string }) => `${wispId}\0${conceptKey}`;

export function summarizeAssignmentReview(decisions: DecisionOverlay, concepts: Draft): AssignmentReviewSummary {
  const generatedKeys = new Set((concepts.assignments ?? []).map(assignmentKey));
  const decisionKeys = new Set((decisions.assignmentDecisions ?? []).map(assignmentKey));
  const actionCount = (action: AssignmentDecision['action']) => decisions.assignmentDecisions.filter(item => item.action === action).length;
  return {
    generatedAssignments: concepts.assignments?.length ?? 0,
    assignmentDecisions: decisions.assignmentDecisions?.length ?? 0,
    approved: actionCount('approved'),
    rejected: actionCount('rejected'),
    modified: actionCount('modified'),
    unreviewed: [...generatedKeys].filter(key => !decisionKeys.has(key)).length,
    staleDecisions: [...decisionKeys].filter(key => !generatedKeys.has(key)).length,
  };
}

export function validateDecisionOverlay(decisions: DecisionOverlay, concepts: Draft, synonyms: Draft): string[] {
  const errors: string[] = [];
  if (decisions.metadata.schemaVersion !== 1) errors.push('unsupported decision schemaVersion');
  if (!decisions.policy?.precisionFirst) errors.push('precisionFirst policy must be true');
  if (decisions.metadata.patch !== concepts.patch || concepts.patch !== synonyms.patch) errors.push('decision patch does not match current drafts');
  if (decisions.metadata.reviewedAgainstGeneratorVersion !== concepts.generatorVersion || concepts.generatorVersion !== synonyms.generatorVersion) errors.push('manual review is stale: generator version changed; re-review and update reviewedAgainstGeneratorVersion');
  if (decisions.metadata.reviewedAgainstInputSha256 !== concepts.input.sha256 || concepts.input.sha256 !== synonyms.input.sha256) errors.push('manual review is stale: normalized input SHA changed; re-review and update reviewedAgainstInputSha256');
  const taxonomy = new Set(concepts.taxonomy?.map(x => x.key));
  for (const item of decisions.taxonomyDecisions ?? []) {
    if (!taxonomy.has(item.key)) errors.push(`unknown taxonomy decision key: ${item.key}`);
    if (!item.reason) errors.push(`taxonomy decision lacks reason: ${item.key}`);
  }
  const normalizeGroupKey = (key: string) => key.normalize('NFKC').toLocaleLowerCase().trim();
  const normalizeAlias = (alias: string) => alias.normalize('NFKC').toLocaleLowerCase().trim();
  const generatedGroups = synonyms.queryExpansionGroups ?? [];
  const generatedGroupCounts = new Map<string, number>();
  for (const group of generatedGroups) {
    const groupKey = normalizeGroupKey(group.key);
    generatedGroupCounts.set(groupKey, (generatedGroupCounts.get(groupKey) ?? 0) + 1);
    const conceptKeys = new Set<string>();
    for (const conceptKey of group.conceptKeys ?? []) {
      if (conceptKeys.has(conceptKey)) errors.push(`duplicate query expansion concept key: ${group.key}/${conceptKey}`);
      conceptKeys.add(conceptKey);
      if (!taxonomy.has(conceptKey)) errors.push(`unknown query expansion concept key: ${group.key}/${conceptKey}`);
    }
  }
  for (const [groupKey, count] of generatedGroupCounts) if (count > 1) errors.push(`duplicate generated query expansion group: ${groupKey}`);
  if ((synonyms.recordAliases?.length ?? 0) !== 0) errors.push('record aliases require explicit manual review before materialization');
  const groups = new Map(generatedGroups.map(group => [normalizeGroupKey(group.key), group]));
  const decisionGroupCounts = new Map<string, number>();
  for (const decision of decisions.queryExpansionDecisions ?? []) {
    const groupKey = normalizeGroupKey(decision.groupKey);
    decisionGroupCounts.set(groupKey, (decisionGroupCounts.get(groupKey) ?? 0) + 1);
  }
  for (const group of generatedGroups) {
    if (!decisionGroupCounts.has(normalizeGroupKey(group.key))) errors.push(`query expansion group has no manual review decision: ${group.key}`);
  }
  for (const [groupKey, count] of decisionGroupCounts) {
    if (count > 1) errors.push(`duplicate query expansion group decision: ${groupKey}`);
    if (!groups.has(groupKey)) errors.push(`unknown query expansion group: ${groupKey}`);
  }
  for (const decision of decisions.queryExpansionDecisions ?? []) {
    const group = groups.get(normalizeGroupKey(decision.groupKey));
    if (!group) continue;
    const approved = new Set<string>();
    for (const alias of decision.approved) {
      const normalized = normalizeAlias(alias);
      if (approved.has(normalized)) errors.push(`duplicate approved alias: ${decision.groupKey}/${alias}`);
      approved.add(normalized);
    }
    const rejected = new Set<string>();
    for (const item of decision.rejected) {
      const alias = normalizeAlias(item.alias);
      if (!item.reason) errors.push(`rejected alias lacks reason: ${decision.groupKey}/${item.alias}`);
      if (approved.has(alias)) errors.push(`alias is both approved and rejected: ${decision.groupKey}/${item.alias}`);
      rejected.add(alias);
    }
    const draftAliases = new Set(group.aliases.map(x => normalizeAlias(x.term)));
    for (const alias of approved) if (!draftAliases.has(alias)) errors.push(`approved alias missing from draft: ${decision.groupKey}/${alias}`);
    if (approved.size !== draftAliases.size) errors.push(`draft group contains alias not approved by decisions: ${decision.groupKey}`);
    if (rejected.size !== decision.rejected.length) errors.push(`duplicate rejected alias: ${decision.groupKey}`);
  }
  const assignments = new Set(concepts.assignments?.map(assignmentKey));
  const generatedWispIds = new Set(concepts.assignments?.map(item => item.wispId));
  const assignmentDecisionKeys = new Set<string>();
  for (const item of decisions.assignmentDecisions ?? []) {
    const key = `${item.wispId}\0${item.conceptKey}`;
    if (assignmentDecisionKeys.has(key)) errors.push(`duplicate assignment decision: ${item.wispId}/${item.conceptKey}`);
    assignmentDecisionKeys.add(key);
    if (!assignments.has(key)) errors.push(`assignment decision not found in draft: ${item.wispId}/${item.conceptKey}`);
    if (!generatedWispIds.has(item.wispId)) errors.push(`unknown Wisp in assignment decision: ${item.wispId}`);
    if (!taxonomy.has(item.conceptKey)) errors.push(`unknown concept in assignment decision: ${item.conceptKey}`);
    if (!['approved', 'rejected', 'modified'].includes(item.action)) errors.push(`invalid assignment decision action: ${item.wispId}/${item.conceptKey}/${String(item.action)}`);
    if (!item.reason?.trim()) errors.push(`assignment decision lacks reason: ${item.wispId}/${item.conceptKey}`);
    if (item.action === 'modified') {
      if (!item.replacementConceptKey) errors.push(`modified assignment decision requires replacementConceptKey: ${item.wispId}/${item.conceptKey}`);
      else {
        if (!taxonomy.has(item.replacementConceptKey)) errors.push(`unknown replacement taxonomy key: ${item.replacementConceptKey}`);
        if (item.replacementConceptKey === item.conceptKey) errors.push(`replacement concept must differ from original: ${item.wispId}/${item.conceptKey}`);
      }
    } else if (item.replacementConceptKey !== undefined) {
      errors.push(`${item.action} assignment decision must not have replacementConceptKey: ${item.wispId}/${item.conceptKey}`);
    }
  }
  for (const item of concepts.assignments ?? []) {
    const key = assignmentKey(item);
    if (!assignmentDecisionKeys.has(key)) errors.push(`generated assignment has no manual review decision: ${item.wispId}/${item.conceptKey}`);
  }
  return errors;
}

if (process.argv[1]?.endsWith('validate-search-lexicon-decisions.ts')) {
  const decisions = JSON.parse(readFileSync('data/reviews/18.1/search-lexicon-decisions.json', 'utf8')) as DecisionOverlay;
  const concepts = JSON.parse(readFileSync('data/overrides/18.1/search-concepts.draft.json', 'utf8')) as Draft;
  const synonyms = JSON.parse(readFileSync('data/overrides/18.1/synonyms.draft.json', 'utf8')) as Draft;
  const errors = validateDecisionOverlay(decisions, concepts, synonyms);
  if (errors.length) { console.error(errors.map(error => `- ${error}`).join('\n')); process.exitCode = 1; }
  else {
    const summary = summarizeAssignmentReview(decisions, concepts);
    console.log(`Search lexicon decisions valid for ${concepts.patch} / ${concepts.generatorVersion} / ${concepts.input.sha256}.`);
    console.log(`Assignment review: ${JSON.stringify(summary)}`);
  }
}
