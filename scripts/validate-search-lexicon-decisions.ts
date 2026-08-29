import { readFileSync } from 'node:fs';

export interface DecisionOverlay {
  metadata: { schemaVersion: number; patch: string; reviewedAgainstGeneratorVersion: string; reviewedAgainstInputSha256: string };
  policy: { precisionFirst: boolean };
  taxonomyDecisions: { action: string; key: string; fromKey?: string; reason: string }[];
  queryExpansionDecisions: { groupKey: string; approved: string[]; rejected: { alias: string; reason: string }[] }[];
  assignmentDecisions: { wispId: string; conceptKey: string }[];
}
interface Draft { patch: string; generatorVersion: string; input: { sha256: string }; taxonomy?: { key: string }[]; assignments?: { wispId: string; conceptKey: string }[]; queryExpansionGroups?: { key: string; aliases: { term: string }[] }[] }

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
  const groups = new Map(synonyms.queryExpansionGroups?.map(group => [group.key, group]));
  for (const decision of decisions.queryExpansionDecisions ?? []) {
    const group = groups.get(decision.groupKey);
    if (!group) { errors.push(`unknown query expansion group: ${decision.groupKey}`); continue; }
    const approved = new Set(decision.approved.map(x => x.normalize('NFKC').toLocaleLowerCase()));
    const rejected = new Set<string>();
    for (const item of decision.rejected) {
      const alias = item.alias.normalize('NFKC').toLocaleLowerCase();
      if (!item.reason) errors.push(`rejected alias lacks reason: ${decision.groupKey}/${item.alias}`);
      if (approved.has(alias)) errors.push(`alias is both approved and rejected: ${decision.groupKey}/${item.alias}`);
      rejected.add(alias);
    }
    const draftAliases = new Set(group.aliases.map(x => x.term.normalize('NFKC').toLocaleLowerCase()));
    for (const alias of approved) if (!draftAliases.has(alias)) errors.push(`approved alias missing from draft: ${decision.groupKey}/${alias}`);
    if (approved.size !== draftAliases.size) errors.push(`draft group contains alias not approved by decisions: ${decision.groupKey}`);
    if (rejected.size !== decision.rejected.length) errors.push(`duplicate rejected alias: ${decision.groupKey}`);
  }
  const assignments = new Set(concepts.assignments?.map(x => `${x.wispId}\0${x.conceptKey}`));
  for (const item of decisions.assignmentDecisions ?? []) if (!assignments.has(`${item.wispId}\0${item.conceptKey}`)) errors.push(`assignment decision not found in draft: ${item.wispId}/${item.conceptKey}`);
  return errors;
}

if (process.argv[1]?.endsWith('validate-search-lexicon-decisions.ts')) {
  const decisions = JSON.parse(readFileSync('data/reviews/18.1/search-lexicon-decisions.json', 'utf8')) as DecisionOverlay;
  const concepts = JSON.parse(readFileSync('data/overrides/18.1/search-concepts.draft.json', 'utf8')) as Draft;
  const synonyms = JSON.parse(readFileSync('data/overrides/18.1/synonyms.draft.json', 'utf8')) as Draft;
  const errors = validateDecisionOverlay(decisions, concepts, synonyms);
  if (errors.length) { console.error(errors.map(error => `- ${error}`).join('\n')); process.exitCode = 1; }
  else console.log(`Search lexicon decisions valid for ${concepts.patch} / ${concepts.generatorVersion} / ${concepts.input.sha256}.`);
}
