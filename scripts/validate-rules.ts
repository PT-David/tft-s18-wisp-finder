import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WISP_CATEGORIES, type WispDataset } from '../src/domain/types';
import { BLOSSOM_EFFECTS, UNCONFIRMED_REAL_MODELS, type WispRuleDataset } from '../src/rules/types';

const rulesPath = resolve('rules/wisp_rules_18.1.json');
const wispsPath = resolve('data/normalized/wisps_18.1.json');
const rules = JSON.parse(readFileSync(rulesPath, 'utf8')) as WispRuleDataset;
const wisps = JSON.parse(readFileSync(wispsPath, 'utf8')) as WispDataset;
const failures: string[] = [];
const check = (condition: boolean, message: string): void => { if (!condition) failures.push(message); };
const positiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0;

check(typeof rules.patch === 'string' && rules.patch.trim().length > 0, 'patch 必须为非空字符串');
check(rules.patch === wisps.patch, `rules.patch (${rules.patch}) 必须等于 production Wisp patch (${wisps.patch})`);
check(JSON.stringify(rules.official.categories) === JSON.stringify(WISP_CATEGORIES), 'official.categories 必须与 WISP_CATEGORIES 顺序和值完全一致');
check(positiveInteger(rules.official.wispShopInterval), 'wispShopInterval 必须为正整数');
check(positiveInteger(rules.official.defaultPurchasesPerRound), 'defaultPurchasesPerRound 必须为正整数');
check(rules.official.rightmostShopSlot === true, 'rightmostShopSlot 必须为 true');
check(rules.official.planningPhaseOnly === true, 'planningPhaseOnly 必须为 true');
check(positiveInteger(rules.official.lateGameCombatGuarantee.startStage), 'late-game startStage 必须为正整数');
check(positiveInteger(rules.official.lateGameCombatGuarantee.everyNthWisp), 'everyNthWisp 必须为正整数');
const blossomEntries = Object.entries(rules.official.blossom);
check(JSON.stringify(blossomEntries.map(([level]) => Number(level))) === JSON.stringify([3, 5, 7, 9, 11]), 'Blossom milestones 必须为 3/5/7/9/11');
check(blossomEntries.every(([, value]) => BLOSSOM_EFFECTS.includes(value)), 'Blossom effect token 无效');
for (const [key, value] of Object.entries(rules.observedNotOfficial).filter(([key]) => key.endsWith('CooldownShops'))) check(positiveInteger(value as number), `${key} 必须为正整数`);
check(rules.observedNotOfficial.affordabilityRestriction === 'supported_by_observation_not_officially_fully_specified', 'affordabilityRestriction 值无效');
check(rules.probabilityModel.v1 === 'equal_weight_among_currently_eligible_wisps', 'V1 probability model 不受支持');
check(rules.probabilityModel.isClaimedRealGameProbability === false, 'V1 不得声明为真实游戏概率');
check(typeof rules.probabilityModel.autoTracksRecentShopCooldowns === 'boolean', 'autoTracksRecentShopCooldowns 必须为 boolean');
check(typeof rules.probabilityModel.manualExclusionSupported === 'boolean', 'manualExclusionSupported 必须为 boolean');
check(JSON.stringify(rules.probabilityModel.unconfirmedRealModels) === JSON.stringify(UNCONFIRMED_REAL_MODELS), 'unconfirmedRealModels 必须完整表达 RULES.md 三项未知模型');
check(wisps.records.length > 0 && wisps.records.every(wisp => wisp.patch === rules.patch), 'production Wisp records 必须非空且全部匹配 rules.patch');

if (failures.length) { console.error(failures.map(message => `- ${message}`).join('\n')); process.exit(1); }
console.log(`Rules validation passed: patch ${rules.patch}, ${wisps.records.length} Wisps, ${blossomEntries.length} Blossom milestones.`);
