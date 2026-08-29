import { createHash } from 'node:crypto';
import type { Requirement, Wisp, WispDataset } from '../../../src/domain/types';

export const GENERATOR_VERSION = 'c2.1-v8';
export const INPUT_PATH = 'data/normalized/wisps_18.1.json';

export type RiskGroup = 'player_vs_unit_health' | 'death_kill_execute' | 'item_semantics' |
  'gold_cost_vs_reward' | 'clone_vs_duplicator' | 'reroll_vs_refresh' |
  'survival_vs_once_per_game' | 'other_ambiguous';
export interface TaxonomyEntry { key: string; labelZh: string; description: string; riskGroup?: RiskGroup }
export interface Evidence { field: string; text: string; matchedTerms: string[]; requirementIndex?: number; requirementType?: string; requirementOperator?: string; requirementValue?: Requirement['value'] }
export interface Assignment { wispId: string; conceptKey: string; evidence: Evidence[]; confidence: 'candidate_high_confidence' | 'needs_review'; reviewFlags: string[] }
export interface ReviewItem extends Evidence { wispId: string; rule: string; reason: string; decision: string }

const T = (key: string, labelZh: string, description: string, riskGroup?: RiskGroup): TaxonomyEntry => ({ key, labelZh, description, ...(riskGroup ? { riskGroup } : {}) });
export const TAXONOMY: TaxonomyEntry[] = [
  T('ability_power', '法术强度', '改变弈子的法术强度。'), T('ally_death', '友军阵亡', '由友军或己方弈子阵亡触发。', 'death_kill_execute'),
  T('artifact_item', '神器', '获得、转化或使用神器装备。', 'item_semantics'), T('attack_damage', '攻击力', '改变弈子的攻击力。'),
  T('attack_speed', '攻击速度', '改变弈子的攻击速度。'), T('board_composition', '阵容条件', '由棋盘或备战席阵容构成决定。'),
  T('champion_cost_tier', '弈子费用等级', '指向特定费用等级的弈子。'), T('champion_duplicator', '英雄复制器', '明确获得或使用英雄复制器道具。', 'clone_vs_duplicator'),
  T('champion_obtain', '获得弈子', '直接获得弈子或使弈子加入队伍。'), T('champion_star_level', '弈子星级', '涉及弈子的当前或指定星级、星级 Requirement、星级比较、按星级选择或计数，以及直接获得或召唤指定星级弈子。'),
  T('champion_star_up', '弈子升星', '现有弈子实际发生升星或星级提升动作。'),
  T('champion_transform', '弈子转化', '将弈子转换为另一形态或对象。'), T('completed_item', '成装', '明确涉及完整装备或成装。', 'item_semantics'),
  T('crowd_control', '控制', '施加眩晕等控制效果。'), T('delayed_trigger', '延迟触发', '在战斗开始后的明确时间点触发效果；不表示普通持续时间或存活奖励。'), T('enemy_death', '敌方阵亡', '由敌方单位阵亡触发。', 'death_kill_execute'),
  T('execute_threshold', '处决阈值', '在目标低于生命阈值时处决。', 'death_kill_execute'), T('free_reroll', '免费刷新', '明确提供免费商店刷新。', 'reroll_vs_refresh'),
  T('gold_gain', '获得金币', '奖励或产出金币。', 'gold_cost_vs_reward'), T('gold_payment', '支付或失去金币', '效果明确要求实际支付、花费或失去金币。', 'gold_cost_vs_reward'),
  T('gold_requirement', '金币条件', '明确检查当前持有金币阈值。', 'gold_cost_vs_reward'),
  T('item_component', '基础装备', '明确涉及基础装备或散件。', 'item_semantics'), T('item_requirement', '装备条件', 'Requirement 对装备的持有、携带、数量或满装状态施加条件或限制。', 'item_semantics'),
  T('item_shop', '装备商店', '开启或使用装备商店。', 'item_semantics'), T('kill_takedown', '击杀或参与击杀', '明确的击杀或参与击杀语义。', 'death_kill_execute'),
  T('loss_streak', '连败', '涉及连败状态或连败计数。'), T('player_health_gain', '玩家生命恢复', '明确增加或治疗玩家生命。', 'player_vs_unit_health'),
  T('player_health_loss', '玩家生命损失', '明确失去玩家生命。', 'player_vs_unit_health'), T('player_health_threshold', '玩家生命阈值', 'Requirement 或文本明确检查玩家生命。', 'player_vs_unit_health'),
  T('reforger', '重铸器', '明确涉及装备重铸器。', 'item_semantics'), T('shield', '护盾', '涉及提供、提升、削减护盾，或以护盾为作用对象。'),
  T('shop_price', '商店价格', '商店中商品的金币购买价格或价格范围。', 'gold_cost_vs_reward'), T('shop_reroll', '商店刷新', '明确刷新 TFT 商店。', 'reroll_vs_refresh'),
  T('survival_condition', '存活结算', '明确以单位是否存活、存活时间或存活友军数量作为效果触发或结算依据。', 'survival_vs_once_per_game'),
  T('temporary_item', '临时装备', '明确为临时且可装备或明确是装备的对象。', 'item_semantics'), T('time_stage', '回合或阶段时机/条件', '描述回合、阶段或准备阶段的时机或条件；不包含普通效果持续时间。'),
  T('trait_active', '羁绊激活', '涉及羁绊处于激活或未激活状态，或使羁绊激活。'), T('true_damage', '真实伤害', '造成真实伤害。'),
  T('win_streak', '连胜', '涉及连胜状态或连胜计数。'), T('xp_gain', '获得经验', '奖励经验值。'),
].sort((a, b) => a.key.localeCompare(b.key));

type Field = { field: string; text: string; requirement?: Requirement; requirementIndex?: number };
const fieldsOf = (w: Wisp): Field[] => [
  { field: 'nameZh', text: w.nameZh }, { field: 'nameEn', text: w.nameEn },
  { field: 'effects.normal', text: w.effects.normal },
  ...(['blossom', 'prismatic'] as const).flatMap((key) => w.effects[key] ? [{ field: `effects.${key}`, text: w.effects[key]! }] : []),
  ...w.requirements.flatMap((r, i) => [{ field: `requirements[${i}].textZh`, text: r.textZh, requirement: r, requirementIndex: i }, ...(r.textEn ? [{ field: `requirements[${i}].textEn`, text: r.textEn, requirement: r, requirementIndex: i }] : [])]),
];
const evidence = (f: Field, terms: string[]): Evidence => ({ field: f.field, text: f.text, matchedTerms: [...new Set(terms)].sort(), ...(f.requirement ? { requirementIndex: f.requirementIndex, requirementType: f.requirement.type, ...(f.requirement.operator ? { requirementOperator: f.requirement.operator } : {}), ...(f.requirement.value !== undefined ? { requirementValue: f.requirement.value } : {}) } : {}) });

interface Rule { key: string; regex: RegExp; confidence?: Assignment['confidence']; risk?: RiskGroup; reviewReason?: string; decision?: string; field?: (f: Field) => boolean; wisp?: (w: Wisp) => boolean }
const R: Rule[] = [
  { key: 'gold_gain', regex: /获得(?:相当于[^。]*的)?\d*(?:x[^。]*)?金币|获得[^。，]*(?:和|以及)\d+金币|掉落\d+金币|金币卖出/ },
  { key: 'gold_payment', regex: /失去\d+金币|花费\d+金币|支付\d+金币/ },
  { key: 'gold_requirement', regex: /至少拥有\d+金币|金币少于\d+|拥有足够的金币/, risk: 'gold_cost_vs_reward', confidence: 'needs_review', reviewReason: '当前金币条件不是支付行为，且部分 source_text 尚不可机器求值。', decision: '确认阈值方向、数值及该条件是否应作为搜索概念。' },
  { key: 'shop_price', regex: /(?:装备的|随机装备的)?费用在\d+到\d+金币/, risk: 'gold_cost_vs_reward', confidence: 'needs_review', reviewReason: '商品价格范围不是玩家已经支付的金币。', decision: '确认这是可检索的商店售价信息，而非购买 Requirement。' },
  { key: 'xp_gain', regex: /获得\d+经验值|获得\d+经验|gain[s]? \d+ xp/i },
  { key: 'player_health_loss', regex: /失去\d+玩家生命值|每失去\d+玩家生命值/ },
  { key: 'player_health_gain', regex: /获得\d+玩家生命值|治疗\d+生命值/ , confidence: 'needs_review', risk: 'player_vs_unit_health', reviewReason: '“治疗生命值”未显式写明玩家，需避免与弈子治疗混淆。', decision: '确认治疗对象是否为玩家/Little Legend。' },
  { key: 'player_health_threshold', regex: /玩家生命值|已损失至少\d+点生命值|处于高生命值|生命值高于\d+/, field: f => f.field.startsWith('requirements['), confidence: 'needs_review', risk: 'player_vs_unit_health', reviewReason: 'Requirement 的文本或类型未始终明确写出玩家。', decision: '确认该阈值检查玩家生命而非弈子生命。' },
  { key: 'free_reroll', regex: /免费(?:刷新|重随)/ }, { key: 'shop_reroll', regex: /刷新(?:你的)?商店|商店[^。]*刷新|刷新次数|\d+次(?:免费)?刷新|免费(?:刷新|重随)/ },
  { key: 'champion_duplicator', regex: /(?:微型|次级)?英雄复制器|champion duplicator/i },
  { key: 'champion_star_up', regex: /会变为[2-5]星|暂时升星|将会升星/ }, { key: 'champion_star_level', regex: /(?<!变为)[1-5]星级|(?<!变为)[1-5]星|星级/ }, { key: 'champion_cost_tier', regex: /[1-5]费弈子/ },
  { key: 'champion_obtain', regex: /获得\d+个[^。]*弈子|获得每个[1-5]费弈子各\d+个|获得总价值\d+金币的随机弈子|弈子加入(?:你的|己方)?队伍/ },
  { key: 'champion_obtain', regex: /获得\d+个【(?![^】]*器】)[^】]+】/, wisp: w => w.category === 'champion' },
  { key: 'champion_obtain', regex: /获得第\d+名阵亡的友军的\d+个复制体/ },
  { key: 'champion_transform', regex: /弈子[^。]*变形为[^。]*弈子|弈子[^。]*转化为|单位[^。]*转化为/ },
  { key: 'ally_death', regex: /友军[^。]*阵亡|己方弈子[^。]*阵亡|(?:第(?:一|\d+)名|最先)阵亡的(?:\d+名)?友军|最先阵亡的\d*个?弈子|第\d+个阵亡的弈子|你的[^。]*弈子们在阵亡时/ },
  { key: 'enemy_death', regex: /阵亡的敌人|敌人.*阵亡/ }, { key: 'execute_threshold', regex: /处决生命值低于\d+%|生命值低于\d+%.*处决/ },
  { key: 'kill_takedown', regex: /参与击杀|完成击杀|每(?:获得)?\d*次?击杀|至少击杀|将所有[^。]*击杀/ },
  { key: 'survival_condition', regex: /每有\d+名存活的友军|弈子在战斗中存活|存活(?:达到|至少|满)\d+秒/ },
  { key: 'delayed_trigger', regex: /在\d+(?:\.\d+)?(?:(?:和|、)\d+(?:\.\d+)?)*秒后/ },
  { key: 'shield', regex: /护盾/ }, { key: 'attack_speed', regex: /攻击速度/ }, { key: 'ability_power', regex: /法术强度|法术加成|法强/ },
  { key: 'attack_damage', regex: /攻击力|物理加成/ }, { key: 'true_damage', regex: /真实伤害/ }, { key: 'crowd_control', regex: /晕眩|眩晕|控制/ },
  { key: 'item_component', regex: /基础装备|装备组件|散件/ }, { key: 'completed_item', regex: /成装|完整装备/ },
  { key: 'artifact_item', regex: /神器(?:锻造器|装备)?/ }, { key: 'reforger', regex: /装备重铸器/ },
  { key: 'temporary_item', regex: /临时(?:的)?(?:、)?可装备|临时(?:的)?推荐装备|临时的(?:某|一|\d+)?(?:件)?装备|临时(?:的)?纹章/ },
  { key: 'temporary_item', regex: /临时(?:的)?【/, wisp: w => w.category === 'item' || /护甲|手套|背心|腰带|armor|gloves?|belts?|vest/i.test(`${w.nameZh} ${w.nameEn}`) },
  { key: 'item_shop', regex: /装备商店/ }, { key: 'item_requirement', regex: /(?:拥有|携带|带着|满)[^。]*装备|装备单位|至少(?:拥有|有)\d+件[^。]*装备/, field: f => f.field.startsWith('requirements[') },
  { key: 'win_streak', regex: /连胜/ }, { key: 'loss_streak', regex: /连败/ },
  { key: 'trait_active', regex: /激活.*羁绊|已激活【|未激活【/, field: f => f.field.startsWith('requirements[') },
  { key: 'trait_active', regex: /(?:未激活|已激活)的羁绊[^。]*激活|使[^。]*羁绊激活/ },
  { key: 'board_composition', regex: /场上至少有\d+个|上阵了\d+个[^。]*弈子|棋盘价值|备战席上有弈子/, field: f => f.field.startsWith('requirements[') },
  { key: 'time_stage', regex: /准备阶段|(?:上|本|这|每|下一|下个|第\d+)回合|(?:下一场|下一个)玩家对战|在\d+场玩家对战后|接下来的?\d+场玩家对战/ },
];

const AMBIGUOUS: { regex: RegExp; risk: RiskGroup; rule: string; reason: string; decision: string }[] = [
  { regex: /生命值/i, risk: 'player_vs_unit_health', rule: 'bare_health_guard', reason: '裸“生命值/health”不能判定为玩家生命；它也常描述弈子或单位。', decision: '判断生命值主体；仅在主体为玩家时批准 player_health 概念。' },
  { regex: /(?:复制体|复制你|复制的弈子|clone|copy)/i, risk: 'clone_vs_duplicator', rule: 'generic_copy_guard', reason: '普通复制机制不是英雄复制器道具。', decision: '判断是否明确指向 Champion Duplicator 道具；否则不得批准 champion_duplicator。' },
  { regex: /装备/, risk: 'item_semantics', rule: 'generic_item_guard', reason: '“装备”可能表示获得、条件、临时装备、组件、成装或商店。', decision: '选择精确装备 concept，或确认无需分配。' },
  { regex: /阵亡|击杀|处决/, risk: 'death_kill_execute', rule: 'death_kill_execute_guard', reason: '阵亡、击杀奖励和阈值处决是不同触发语义。', decision: '确认主体与触发类型，不得把这些概念无条件合并。' },
  { regex: /刷新/, risk: 'reroll_vs_refresh', rule: 'refresh_context_guard', reason: '刷新只有明确指向 TFT 商店或刷新次数时才是 reroll。', decision: '确认这是商店 reroll，而非普通更新/重置。' },
];

export interface QueryGroup { key: string; canonicalTerm: string; conceptKeys?: string[]; aliases: { term: string; language: string }[]; evidence: string; intrinsicRisks: string[]; reviewStatus: 'draft_candidate' | 'needs_review' }
const GROUPS = ([
  { key: 'ability_power_terms', canonicalTerm: '法术强度', conceptKeys: ['ability_power'], aliases: [{ term: '法术强度', language: 'zh' }, { term: '法术加成', language: 'zh' }, { term: '法强', language: 'zh' }], evidence: '人工审核批准的 Set 18 法术加成表达', intrinsicRisks: [], reviewStatus: 'draft_candidate' },
  { key: 'attack_damage_terms', canonicalTerm: '攻击力', conceptKeys: ['attack_damage'], aliases: [{ term: '攻击力', language: 'zh' }, { term: '物理加成', language: 'zh' }], evidence: '人工审核批准的 Set 18 物理加成表达', intrinsicRisks: [], reviewStatus: 'draft_candidate' },
  { key: 'attack_speed_terms', canonicalTerm: '攻击速度', conceptKeys: ['attack_speed'], aliases: [{ term: '攻击速度', language: 'zh' }, { term: '攻速', language: 'zh' }], evidence: '人工审核批准的低歧义中文缩写', intrinsicRisks: [], reviewStatus: 'draft_candidate' },
  { key: 'champion_duplicator_terms', canonicalTerm: 'Champion Duplicator', conceptKeys: ['champion_duplicator'], aliases: [{ term: 'Champion Duplicator', language: 'en' }, { term: '英雄复制器', language: 'zh' }, { term: '复制器', language: 'zh' }], evidence: '人工审核移除有英雄名歧义的旧俗称', intrinsicRisks: ['clone_vs_duplicator'], reviewStatus: 'needs_review' },
  { key: 'death_terms', canonicalTerm: '阵亡', aliases: [{ term: '阵亡', language: 'zh' }, { term: '死亡', language: 'zh' }], evidence: '主体中立的死亡查询表达', intrinsicRisks: [], reviewStatus: 'draft_candidate' },
  { key: 'experience_terms', canonicalTerm: '经验', conceptKeys: ['xp_gain'], aliases: [{ term: '经验', language: 'zh' }, { term: '经验值', language: 'zh' }, { term: 'XP', language: 'en' }, { term: 'experience', language: 'en' }], evidence: '人工审核批准的经验查询表达', intrinsicRisks: [], reviewStatus: 'draft_candidate' },
  { key: 'health_terms', canonicalTerm: '生命值', aliases: [{ term: 'HP', language: 'en' }, { term: 'health', language: 'en' }, { term: '生命值', language: 'zh' }, { term: '血量', language: 'game_slang' }], evidence: '通用 health 查询表达；不推断玩家或弈子主体', intrinsicRisks: ['player_vs_unit_health'], reviewStatus: 'needs_review' },
  { key: 'kill_terms', canonicalTerm: '击杀', conceptKeys: ['kill_takedown'], aliases: [{ term: '击杀', language: 'zh' }, { term: 'takedown', language: 'en' }], evidence: '人工审核批准的击杀查询表达；不与死亡或处决合并', intrinsicRisks: [], reviewStatus: 'draft_candidate' },
  { key: 'reroll_terms', canonicalTerm: '刷新', conceptKeys: ['shop_reroll', 'free_reroll'], aliases: [{ term: 'reroll', language: 'en' }, { term: '刷新', language: 'zh' }, { term: '重随', language: 'zh' }], evidence: '人工审核移除单字符及名称碰撞 alias', intrinsicRisks: ['reroll_vs_refresh'], reviewStatus: 'needs_review' },
  { key: 'true_damage_terms', canonicalTerm: '真实伤害', conceptKeys: ['true_damage'], aliases: [{ term: '真实伤害', language: 'zh' }, { term: '真伤', language: 'zh' }], evidence: '人工审核批准的低歧义中文缩写', intrinsicRisks: [], reviewStatus: 'draft_candidate' },
] satisfies QueryGroup[]).sort((a, b) => a.key.localeCompare(b.key));

/** Actual collision means the same normalized alias occurs in distinct semantic groups. */
export function detectAliasCollisions(groups: readonly QueryGroup[]) {
  const aliases = new Map<string, { groups: Set<string>; concepts: Set<string> }>();
  for (const group of groups) for (const alias of group.aliases) {
    const key = alias.term.normalize('NFKC').toLocaleLowerCase().trim();
    const entry = aliases.get(key) ?? { groups: new Set(), concepts: new Set() };
    entry.groups.add(group.key); (group.conceptKeys ?? []).forEach((concept) => entry.concepts.add(concept)); aliases.set(key, entry);
  }
  return [...aliases].filter(([, x]) => x.groups.size > 1).map(([alias, x]) => ({ alias, groupKeys: [...x.groups].sort(), conceptKeys: [...x.concepts].sort(), reviewStatus: 'needs_review' as const })).sort((a, b) => a.alias.localeCompare(b.alias));
}

function auditAliases(groups: readonly QueryGroup[], records: readonly Wisp[]) {
  return groups.flatMap((group) => group.aliases.map((alias) => {
    const needle = alias.term.normalize('NFKC').toLocaleLowerCase();
    const occurrences = records.flatMap((wisp) => fieldsOf(wisp)
      .filter((field) => field.text.normalize('NFKC').toLocaleLowerCase().includes(needle))
      .map((field) => ({ wispId: wisp.id, field: field.field, text: field.text })));
    return { groupKey: group.key, alias: alias.term, occurrences, occurrenceCount: occurrences.length };
  })).sort((a, b) => a.groupKey.localeCompare(b.groupKey) || a.alias.localeCompare(b.alias));
}

export function generateSearchLexicon(dataset: WispDataset, inputBytes: Buffer) {
  const assignments: Assignment[] = []; const review: Record<RiskGroup, ReviewItem[]> = {
    player_vs_unit_health: [], death_kill_execute: [], item_semantics: [], gold_cost_vs_reward: [],
    clone_vs_duplicator: [], reroll_vs_refresh: [], survival_vs_once_per_game: [], other_ambiguous: [],
  };
  for (const wisp of dataset.records) for (const f of fieldsOf(wisp)) {
    for (const rule of R) { if ((rule.field && !rule.field(f)) || (rule.wisp && !rule.wisp(wisp))) continue; const match = f.text.match(rule.regex); if (!match) continue; const ev = evidence(f, [match[0]]); let item = assignments.find(a => a.wispId === wisp.id && a.conceptKey === rule.key); if (!item) { item = { wispId: wisp.id, conceptKey: rule.key, evidence: [], confidence: rule.confidence ?? 'candidate_high_confidence', reviewFlags: rule.risk && rule.confidence === 'needs_review' ? [rule.risk] : [] }; assignments.push(item); } item.evidence.push(ev); if (rule.risk && rule.confidence === 'needs_review') review[rule.risk].push({ wispId: wisp.id, ...ev, rule: `${rule.key}_rule`, reason: rule.reviewReason!, decision: rule.decision! }); }
    for (const guard of AMBIGUOUS) { const match = f.text.match(guard.regex); if (match) review[guard.risk].push({ wispId: wisp.id, ...evidence(f, [match[0]]), rule: guard.rule, reason: guard.reason, decision: guard.decision }); }
  }
  for (const a of assignments) { a.evidence.sort((x,y) => x.field.localeCompare(y.field) || x.text.localeCompare(y.text)); a.reviewFlags.sort(); }
  assignments.sort((a,b) => a.wispId.localeCompare(b.wispId) || a.conceptKey.localeCompare(b.conceptKey));
  for (const items of Object.values(review)) { const unique = new Map(items.map(i => [`${i.wispId}\0${i.field}\0${i.rule}`, i])); items.splice(0, items.length, ...[...unique.values()].sort((a,b) => a.wispId.localeCompare(b.wispId) || a.field.localeCompare(b.field) || a.rule.localeCompare(b.rule))); }
  const queryExpansionGroups = GROUPS.map(g => ({ ...g, aliases: [...g.aliases].sort((a,b) => a.term.normalize('NFKC').toLocaleLowerCase().localeCompare(b.term.normalize('NFKC').toLocaleLowerCase())) }));
  const actualAliasCollisions = detectAliasCollisions(queryExpansionGroups);
  const intrinsicAliasRisks = queryExpansionGroups.flatMap(group => group.intrinsicRisks.map(risk => ({ groupKey: group.key, risk, reviewStatus: 'needs_review' as const })));
  const aliasCorpusAudit = auditAliases(queryExpansionGroups, dataset.records);
  const input = { path: INPUT_PATH, sha256: createHash('sha256').update(inputBytes).digest('hex'), recordCount: dataset.records.length };
  const common = { schemaVersion: 1, patch: '18.1', generatorVersion: GENERATOR_VERSION, input };
  const conceptDraft = { ...common, taxonomy: TAXONOMY, assignments };
  const synonymDraft = { ...common, queryExpansionGroups, recordAliases: [], actualAliasCollisions, intrinsicAliasRisks };
  const high = assignments.filter(a => a.confidence === 'candidate_high_confidence').length;
  const reviewGroups = { player_vs_unit_health: review.player_vs_unit_health, death_kill_execute: review.death_kill_execute, item_semantics: review.item_semantics, gold_cost_vs_reward: review.gold_cost_vs_reward, clone_vs_duplicator: review.clone_vs_duplicator, reroll_vs_refresh: review.reroll_vs_refresh, other_ambiguous: [...review.survival_vs_once_per_game, ...review.other_ambiguous] };
  const reviewItems = Object.values(reviewGroups).flat();
  const reviewGroupCounts = Object.fromEntries(Object.entries(reviewGroups).map(([key, items]) => [key, items.length]));
  const assignmentsByConcept = Object.fromEntries(TAXONOMY.map(({ key }) => [key, assignments.filter(a => a.conceptKey === key).length]));
  const report = { ...common, summary: { recordsScanned: dataset.records.length, taxonomyDefinitions: TAXONOMY.length, conceptCandidateAssignments: assignments.length, conceptKeysUsed: new Set(assignments.map(a => a.conceptKey)).size, assignmentsByConcept, queryExpansionGroups: queryExpansionGroups.length, recordAliases: 0, highConfidenceAssignments: high, needsReviewAssignments: assignments.length - high, reviewItems: reviewItems.length, uniqueWispsWithReviewItems: new Set(reviewItems.map(item => item.wispId)).size, actualAliasCollisions: actualAliasCollisions.length, intrinsicAliasRisks: intrinsicAliasRisks.length, riskyQueryExpansionGroups: queryExpansionGroups.filter(g => g.intrinsicRisks.length).length, aliasLiteralOccurrences: aliasCorpusAudit.reduce((sum, item) => sum + item.occurrenceCount, 0), reviewGroupCounts }, reviewGroups, actualAliasCollisions, intrinsicAliasRisks, aliasCorpusAudit };
  return { conceptDraft, synonymDraft, report };
}
