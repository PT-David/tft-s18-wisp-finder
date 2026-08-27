import { CONFIDENCES, WISP_CATEGORIES, type WispDataset } from '../src/domain/types';

const operators = new Set(['>', '>=', '<', '<=', '=', '!=', 'in', 'active', 'inactive']);
const requiredSourceFields = ['cost', 'stageRanges', 'effects'] as const;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function validateDataset(input: unknown): string[] {
  const errors: string[] = [];
  if (!object(input) || !Array.isArray(input.records)) return ['dataset.records: 必须是数组'];
  const dataset = input as unknown as WispDataset;
  const ids = new Set<string>();
  dataset.records.forEach((wisp, index) => {
    const path = `records[${index}]`;
    if (!text(wisp.id)) errors.push(`${path}.id: 必须是非空字符串`);
    else if (ids.has(wisp.id)) errors.push(`${path}.id: 重复 ID "${wisp.id}"`); else ids.add(wisp.id);
    if (!text(wisp.nameZh)) errors.push(`${path}.nameZh: 必须是非空字符串`);
    if (!text(wisp.nameEn)) errors.push(`${path}.nameEn: 必须是非空字符串`);
    if (!WISP_CATEGORIES.includes(wisp.category)) errors.push(`${path}.category: 非法类别 "${wisp.category}"`);
    if (typeof wisp.cost !== 'number' || !Number.isFinite(wisp.cost) || wisp.cost < 0) errors.push(`${path}.cost: 必须是非负有限数`);
    if (wisp.minimumAffordableGold != null && (typeof wisp.minimumAffordableGold !== 'number' || wisp.minimumAffordableGold < 0)) errors.push(`${path}.minimumAffordableGold: 必须为 null 或非负数`);
    if (!Array.isArray(wisp.stageRanges) || !wisp.stageRanges.length) errors.push(`${path}.stageRanges: 至少需要一个区间`);
    else wisp.stageRanges.forEach((range, rangeIndex) => {
      const rp = `${path}.stageRanges[${rangeIndex}]`;
      for (const [key, point] of [['start', range.start], ['end', range.end]] as const) {
        if (!object(point) || !Number.isInteger(point.stage) || point.stage < 1 || !Number.isInteger(point.round) || point.round < 1)
          errors.push(`${rp}.${key}: stage 和 round 必须是正整数`);
      }
      if (object(range.start) && object(range.end) && (range.start.stage > range.end.stage || (range.start.stage === range.end.stage && range.start.round > range.end.round))) errors.push(`${rp}: start 不得晚于 end`);
    });
    if (!object(wisp.effects) || !text(wisp.effects.normal)) errors.push(`${path}.effects.normal: 必须是非空字符串`);
    if (object(wisp.effects) && wisp.effects.prismatic !== undefined && wisp.effects.prismatic !== null && typeof wisp.effects.prismatic !== 'string') errors.push(`${path}.effects.prismatic: 必须是字符串或 null`);
    if (!Array.isArray(wisp.requirements)) errors.push(`${path}.requirements: 必须是数组`);
    else wisp.requirements.forEach((requirement, ri) => {
      const rp = `${path}.requirements[${ri}]`;
      if (!text(requirement.type)) errors.push(`${rp}.type: 必须是非空字符串`);
      if (!text(requirement.textZh)) errors.push(`${rp}.textZh: 必须是非空字符串`);
      if (typeof requirement.machineEvaluable !== 'boolean') errors.push(`${rp}.machineEvaluable: 必须是布尔值`);
      if (requirement.operator !== undefined && !operators.has(requirement.operator)) errors.push(`${rp}.operator: 非法操作符`);
      if (requirement.machineEvaluable && !requirement.operator) errors.push(`${rp}.operator: 可机器判断的条件必须提供操作符`);
    });
    if (typeof wisp.oncePerGame !== 'boolean') errors.push(`${path}.oncePerGame: 必须是布尔值`);
    if (!Array.isArray(wisp.searchConcepts) || !Array.isArray(wisp.synonyms)) errors.push(`${path}.searchConcepts/synonyms: 必须是数组`);
    if (wisp.patch !== '18.1') errors.push(`${path}.patch: 必须为 18.1`);
    const sourceFields = [...requiredSourceFields, ...(wisp.requirements?.length ? ['requirements'] as const : [])];
    if (!object(wisp.sources)) errors.push(`${path}.sources: 缺失来源元数据`);
    else sourceFields.forEach((field) => {
      const source = wisp.sources[field];
      if (!object(source) || !text(source.sourceId) || !text(source.verifiedAt) || !CONFIDENCES.includes(source.confidence)) errors.push(`${path}.sources.${field}: 缺失或非法来源元数据`);
    });
  });
  return errors;
}
