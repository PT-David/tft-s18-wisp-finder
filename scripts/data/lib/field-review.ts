import { createHash } from 'node:crypto';

export type Json = Record<string, any>;
export const REQUIRED_FIELDS = ['riotId','nameEn','nameZh','category','cost','stageRanges','effects.normal','effects.blossom','effects.prismatic','requirements','oncePerGame','reofferCooldownShops','minimumAffordableGold'] as const;
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
export const stableJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
export const slug = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function logicalField(reason: string) {
  if (reason.startsWith('requirements:')) return 'requirements';
  if (reason === 'blossom_presence') return 'effects.blossom';
  if (reason === 'prismatic') return 'effects.prismatic';
  return reason;
}

export function consolidateRawIssues(rows: Json[]) {
  const units = new Map<string, Json>();
  for (const row of rows) for (const reason of row.reviewReasons) {
    const field = logicalField(reason);
    const propositionKey = field === 'requirements' ? requirementKey(row.requirements) : field === 'effects.blossom' ? 'production-blossom-semantics' : 'production-prismatic-semantics';
    const key = `${row.productionId}|${field}|${propositionKey}`;
    const unit = units.get(key) ?? { productionId: row.productionId, field, propositionKey, rawReasons: [] };
    if (!unit.rawReasons.includes(reason)) unit.rawReasons.push(reason);
    units.set(key, unit);
  }
  return [...units.values()].sort((a,b) => `${a.productionId}|${a.field}|${a.propositionKey}`.localeCompare(`${b.productionId}|${b.field}|${b.propositionKey}`, 'en'));
}

export function requirementKey(requirements: unknown) {
  if (!Array.isArray(requirements) || !requirements.length) return 'requirement-presence-or-wording';
  return requirements.map((r: Json) => slug(r.textEn ?? r.textZh ?? r.type ?? 'requirement')).sort().join('+') || 'requirement-presence-or-wording';
}

export function classifyValues(values: unknown[]) {
  const observed = values.filter((v) => v !== undefined);
  const normalized = new Set(observed.map((v) => stableJson(v)));
  if (!observed.length) return { evidenceState: 'unknown', reviewClass: 'insufficient_evidence', conflictType: 'missing_value' };
  if (normalized.size > 1) return { evidenceState: 'conflicting', reviewClass: 'human_conflict', conflictType: observed.every((v) => typeof v === 'number') ? 'numeric' : 'semantic' };
  return { evidenceState: 'supported', reviewClass: 'decision_ready', conflictType: 'none' };
}

export const representationDoesNotProveField = (_kind: 'upgrade'|'prismatic') => false;
export const historicalBaselineValid = (packet: Json, inputHashes: Record<string,string>) =>
  packet.reviewBaseline.inputArtifacts.every((a: Json) => inputHashes[a.path] === a.sha256);

