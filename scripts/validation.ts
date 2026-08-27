import { CONFIDENCES, WISP_CATEGORIES } from '../src/domain/types';

const operators = new Set(['>', '>=', '<', '<=', '=', '!=', 'in', 'active', 'inactive']);
const numericOperators = new Set(['>', '>=', '<', '<=']);
const requiredSourceFields = ['cost', 'stageRanges', 'effects'] as const;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finiteNonNegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const stringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
const comparableValue = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));

function validateRequirement(requirement: unknown, path: string): string[] {
  if (!object(requirement)) return [`${path}: 必须是对象`];
  const errors: string[] = [];
  if (!text(requirement.type)) errors.push(`${path}.type: 必须是非空字符串`);
  if (!text(requirement.textZh)) errors.push(`${path}.textZh: 必须是非空字符串`);
  if (requirement.textEn !== undefined && typeof requirement.textEn !== 'string') errors.push(`${path}.textEn: 必须是字符串`);
  if (typeof requirement.machineEvaluable !== 'boolean') errors.push(`${path}.machineEvaluable: 必须是布尔值`);
  if (requirement.operator !== undefined && (typeof requirement.operator !== 'string' || !operators.has(requirement.operator))) errors.push(`${path}.operator: 非法操作符`);
  if (requirement.machineEvaluable === true) {
    if (typeof requirement.operator !== 'string' || !operators.has(requirement.operator)) {
      errors.push(`${path}.operator: 可机器判断的条件必须提供合法操作符`);
    } else if (numericOperators.has(requirement.operator) && !(typeof requirement.value === 'number' && Number.isFinite(requirement.value))) {
      errors.push(`${path}.value: ${requirement.operator} 操作符需要有限数值`);
    } else if ((requirement.operator === '=' || requirement.operator === '!=') && !comparableValue(requirement.value)) {
      errors.push(`${path}.value: ${requirement.operator} 操作符需要 string/number/boolean`);
    } else if (requirement.operator === 'in' && (!stringArray(requirement.value) || requirement.value.length === 0)) {
      errors.push(`${path}.value: in 操作符需要非空 string[]`);
    } else if ((requirement.operator === 'active' || requirement.operator === 'inactive') && !text(requirement.value)) {
      errors.push(`${path}.value: ${requirement.operator} 操作符需要非空字符串`);
    }
  }
  return errors;
}

export function validateDataset(input: unknown): string[] {
  const errors: string[] = [];
  if (!object(input)) return ['dataset: 必须是对象'];
  if (input.patch !== '18.1') errors.push('dataset.patch: 必须为 18.1');
  if (!Array.isArray(input.records)) return [...errors, 'dataset.records: 必须是数组'];
  const ids = new Set<string>();
  input.records.forEach((record, index) => {
    const path = `records[${index}]`;
    if (!object(record)) { errors.push(`${path}: 必须是对象`); return; }
    if (!text(record.id)) errors.push(`${path}.id: 必须是非空字符串`);
    else if (ids.has(record.id)) errors.push(`${path}.id: 重复 ID "${record.id}"`); else ids.add(record.id);
    if (record.riotId !== undefined && record.riotId !== null && typeof record.riotId !== 'string') errors.push(`${path}.riotId: 必须是字符串或 null`);
    if (!text(record.nameZh)) errors.push(`${path}.nameZh: 必须是非空字符串`);
    if (!text(record.nameEn)) errors.push(`${path}.nameEn: 必须是非空字符串`);
    if (typeof record.category !== 'string' || !WISP_CATEGORIES.includes(record.category as never)) errors.push(`${path}.category: 非法类别 "${String(record.category)}"`);
    if (!finiteNonNegative(record.cost)) errors.push(`${path}.cost: 必须是非负有限数`);
    if (record.minimumAffordableGold !== undefined && record.minimumAffordableGold !== null && !finiteNonNegative(record.minimumAffordableGold)) errors.push(`${path}.minimumAffordableGold: 必须为 null 或非负有限数`);
    if (!Array.isArray(record.stageRanges) || !record.stageRanges.length) errors.push(`${path}.stageRanges: 至少需要一个区间`);
    else record.stageRanges.forEach((range, rangeIndex) => {
      const rp = `${path}.stageRanges[${rangeIndex}]`;
      if (!object(range)) { errors.push(`${rp}: 必须是对象`); return; }
      for (const key of ['start', 'end'] as const) {
        const point = range[key];
        if (!object(point) || !Number.isInteger(point.stage) || (point.stage as number) < 1 || !Number.isInteger(point.round) || (point.round as number) < 1) errors.push(`${rp}.${key}: stage 和 round 必须是正整数`);
      }
      if (object(range.start) && object(range.end) && typeof range.start.stage === 'number' && typeof range.start.round === 'number' && typeof range.end.stage === 'number' && typeof range.end.round === 'number' && (range.start.stage > range.end.stage || (range.start.stage === range.end.stage && range.start.round > range.end.round))) errors.push(`${rp}: start 不得晚于 end`);
    });
    if (!object(record.effects)) errors.push(`${path}.effects: 必须是对象`);
    else {
      if (!text(record.effects.normal)) errors.push(`${path}.effects.normal: 必须是非空字符串`);
      for (const field of ['blossom', 'prismatic'] as const) if (record.effects[field] !== undefined && record.effects[field] !== null && typeof record.effects[field] !== 'string') errors.push(`${path}.effects.${field}: 必须是字符串或 null`);
    }
    if (!Array.isArray(record.requirements)) errors.push(`${path}.requirements: 必须是数组`);
    else record.requirements.forEach((requirement, ri) => errors.push(...validateRequirement(requirement, `${path}.requirements[${ri}]`)));
    if (typeof record.oncePerGame !== 'boolean') errors.push(`${path}.oncePerGame: 必须是布尔值`);
    if (record.reofferCooldownShops !== undefined && record.reofferCooldownShops !== null && (!Number.isInteger(record.reofferCooldownShops) || (record.reofferCooldownShops as number) < 0)) errors.push(`${path}.reofferCooldownShops: 必须为 null 或非负整数`);
    for (const field of ['searchConcepts', 'synonyms'] as const) if (!stringArray(record[field])) errors.push(`${path}.${field}: 必须是 string[]`);
    if (record.patch !== '18.1') errors.push(`${path}.patch: 必须为 18.1`);
    const sourceFields = [...requiredSourceFields, ...(Array.isArray(record.requirements) && record.requirements.length ? ['requirements'] as const : [])];
    if (!object(record.sources)) errors.push(`${path}.sources: 缺失来源元数据`);
    else {
      const sources = record.sources;
      sourceFields.forEach((field) => {
        const source = sources[field];
        if (!object(source) || !text(source.sourceId) || !text(source.verifiedAt) || typeof source.confidence !== 'string' || !CONFIDENCES.includes(source.confidence as never)) errors.push(`${path}.sources.${field}: 缺失或非法来源元数据`);
      });
    }
  });
  return errors;
}
