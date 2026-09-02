import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { IdentityDecisionFile } from './lib/identity-decisions';

const root = resolve(import.meta.dirname, '../..');
const file = JSON.parse(await readFile(resolve(root, 'data/reviews/18.1/c4.2a-identity-decisions.json'), 'utf8')) as IdentityDecisionFile;
const same = file.decisions.filter((row) => row.action === 'same_identity').length;
const missing = file.decisions.filter((row) => row.action === 'missing_base_identity').length;
const table = file.decisions.map((row) => `| ${row.decisionId} | ${row.canonicalNameEn} / ${row.canonicalNameZh} (\`${row.communityDragonId}\`) | \`${row.action}\` | ${row.productionId ? `\`${row.productionId}\`` : '—'} | \`${row.fieldResolutionStatus}\` |`).join('\n');
const baseline = file.reviewMetadata.decisionBaseline;
const markdown = `# C4.2A4 Formal Identity Decisions — Patch 18.1

Approved identity decisions: ${file.decisions.length}

same identity: ${same}
missing base identity: ${missing}

production records changed: 0
field decisions applied: 0

| Decision | Identity | Action | Production target | Field status |
|---|---|---|---|---|
${table}

## Decision-time baseline and boundaries

At the C4.2A4 decision baseline, production contained ${baseline.productionRecordCount} records.

C4.2A4 itself changed 0 production records. At decision time, \`recommendedProductionReady\` was \`${baseline.recommendedProductionReady}\`.

These historical manual decisions approve identity existence or relationship only. Every field remains \`pending_c4.2b\`; no cost, effect, Requirement, stage, Blossom, or Prismatic truth is approved here.

Seven approved missing production identities were pending apply at the decision baseline. Fulfillment is validated dynamically against current production and reviewed mappings; a correct future apply does not invalidate the historical decisions.

Tiger governance: \`DA_TigersVisit18_Wisp\` (Tiger's Visit / 战马降临) is an independent base identity and is not \`DA_BearsVisit18_Upgrade\` or \`DA_TigersVisit18_Wisp_Upgrade\` (猛虎降临 variants).
`;
await writeFile(resolve(root, 'reports/c4.2a4-identity-decisions-18.1.md'), markdown);
console.log('Generated deterministic historical C4.2A4 identity decision report from the manual overlay.');
