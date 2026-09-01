import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generateReleaseAudit } from './data/release-audit-18.1';

const root = resolve(import.meta.dirname, '..');
const stable = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const { output, report } = await generateReleaseAudit(false);
const invalidSameIdentity = output.identity.reviewQueue.filter((item) => item.recommendedHumanAction === 'same_identity' && !item.recommendedProductionId);
if (invalidSameIdentity.length) throw new Error(`same_identity recommendations require recommendedProductionId: ${invalidSameIdentity.map((item) => item.candidateIdentity).join(', ')}`);
const committedJson = await readFile(resolve(root, 'reports/release-readiness-18.1.json'), 'utf8');
const committedMarkdown = await readFile(resolve(root, 'reports/release-data-audit-18.1.md'), 'utf8');
if (committedJson !== stable(output) || committedMarkdown !== report) throw new Error('Committed release audit is stale. Run npm run data:release-audit:18.1.');
console.log(`Release audit is current (${output.normalizedCount} records, ready=${output.recommendedProductionReady}).`);
