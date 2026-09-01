import rawRules18_1 from '../../rules/wisp_rules_18.1.json';
import type { WispRuleDataset } from './types';

const rules18_1 = rawRules18_1 as WispRuleDataset;
const DATASETS: Readonly<Record<string, WispRuleDataset>> = { [rules18_1.patch]: rules18_1 };

export const ruleDatasetForPatch = (patch: string): WispRuleDataset | undefined => DATASETS[patch];
