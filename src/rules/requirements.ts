import type { Requirement } from '../domain/types';

export type RequirementState = Record<string, number | string | boolean | string[] | undefined>;

export function evaluateRequirement(requirement: Requirement, state: RequirementState): boolean | undefined {
  if (!requirement.machineEvaluable) return undefined;
  const actual = state[requirement.type];
  if (actual === undefined || !requirement.operator) return undefined;
  const expected = requirement.value;
  switch (requirement.operator) {
    case '>': return typeof actual === 'number' && typeof expected === 'number' ? actual > expected : undefined;
    case '>=': return typeof actual === 'number' && typeof expected === 'number' ? actual >= expected : undefined;
    case '<': return typeof actual === 'number' && typeof expected === 'number' ? actual < expected : undefined;
    case '<=': return typeof actual === 'number' && typeof expected === 'number' ? actual <= expected : undefined;
    case '=':
    case '!=': {
      if (Array.isArray(actual) || Array.isArray(expected) || expected === undefined || typeof actual !== typeof expected) return undefined;
      return requirement.operator === '=' ? actual === expected : actual !== expected;
    }
    case 'in': return Array.isArray(expected) && expected.every((item) => typeof item === 'string') && typeof actual === 'string'
      ? expected.includes(actual) : undefined;
    case 'active':
    case 'inactive': {
      if (typeof expected !== 'string' || !Array.isArray(actual) || !actual.every((item) => typeof item === 'string')) return undefined;
      const active = actual.includes(expected);
      return requirement.operator === 'active' ? active : !active;
    }
  }
}
