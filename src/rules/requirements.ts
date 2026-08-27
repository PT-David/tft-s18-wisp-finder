import type { Requirement } from '../domain/types';

export type RequirementState = Record<string, number | string | boolean | string[] | undefined>;

export function evaluateRequirement(requirement: Requirement, state: RequirementState): boolean | undefined {
  if (!requirement.machineEvaluable) return undefined;
  const actual = state[requirement.type];
  if (actual === undefined || !requirement.operator) return undefined;
  const expected = requirement.value;
  switch (requirement.operator) {
    case '>': return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case '>=': return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case '<': return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case '<=': return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case '=': return actual === expected;
    case '!=': return actual !== expected;
    case 'in': return Array.isArray(expected) && !Array.isArray(actual) && expected.includes(String(actual));
    case 'active': return Array.isArray(actual) ? actual.includes(String(expected)) : actual === expected || actual === true;
    case 'inactive': return Array.isArray(actual) ? !actual.includes(String(expected)) : actual !== expected && actual !== true;
  }
}
