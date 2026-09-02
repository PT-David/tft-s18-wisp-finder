import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const file = JSON.parse(await readFile(resolve(root, 'data/reviews/18.1/c4.2a-identity-decisions.json'), 'utf8'));
const same = file.decisions.filter((row: any) => row.action === 'same_identity').length;
const missing = file.decisions.filter((row: any) => row.action === 'missing_base_identity').length;
const table = file.decisions.map((row: any) => `| ${row.decisionId} | ${row.canonicalNameEn} / ${row.canonicalNameZh} (\`${row.communityDragonId}\`) | \`${row.action}\` | ${row.productionId ? `\`${row.productionId}\`` : '—'} | \`${row.fieldResolutionStatus}\` |`).join('\n');
const markdown = `# C4.2A4 Formal Identity Decisions — Patch 18.1

Approved identity decisions: ${file.decisions.length}

same identity: ${same}
missing base identity: ${missing}

production records changed: 0
field decisions applied: 0

| Decision | Identity | Action | Production target | Field status |
|---|---|---|---|---|
${table}

## Boundaries and readiness

These manual decisions approve identity existence or relationship only. Every field remains \`pending_c4.2b\`; no cost, effect, Requirement, stage, Blossom, or Prismatic truth is approved here.

Production remains at 169 records and \`recommendedProductionReady=false\` because seven approved missing production identities have not yet been applied.

Tiger governance: \`DA_TigersVisit18_Wisp\` (Tiger's Visit / 战马降临) is an independent base identity and is not \`DA_BearsVisit18_Upgrade\` or \`DA_TigersVisit18_Wisp_Upgrade\` (猛虎降临 variants).
`;
await writeFile(resolve(root, 'reports/c4.2a4-identity-decisions-18.1.md'), markdown);
console.log('Generated deterministic C4.2A4 identity decision report from the manual overlay.');
