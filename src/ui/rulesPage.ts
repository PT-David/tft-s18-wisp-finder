import type { Confidence } from '../domain/types';
import type { GeneralRuleView, RulesPageViewModel, WispRuleField } from '../rules/rulePageModel';
import { CONFIDENCE_LABELS } from './confidenceLabels';

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const badge = (confidence: Confidence, compact = false): HTMLElement => {
  const node = element('span', `confidence confidence-${confidence}${compact ? ' confidence-compact' : ''}`, CONFIDENCE_LABELS[confidence]);
  node.title = `可信度：${CONFIDENCE_LABELS[confidence]}`;
  return node;
};
const ruleCards = (rules: readonly GeneralRuleView[]): HTMLElement => {
  const grid = element('div', 'rule-grid');
  for (const rule of rules) {
    const card = element('article'); card.dataset.ruleId = rule.id;
    card.append(badge(rule.confidence), element('h3', '', rule.title), element('p', '', rule.text)); grid.append(card);
  }
  return grid;
};
const fieldConfidence = <T>(field: WispRuleField<T>): HTMLElement | undefined => field.confidence ? badge(field.confidence, true) : undefined;

export function renderRulesPage(model: RulesPageViewModel): HTMLElement {
  const root = element('div');
  root.append(element('p', 'eyebrow', `PATCH ${model.patch} · RULES`), element('h1', '', '刷新规律'), element('p', 'lead', '规则事实来自版本化规则数据与已审核仙灵数据；官方、观察与未知项分层展示。'));
  const official = element('section'); official.append(element('h2', '', '官方机制'), ruleCards(model.officialRules)); root.append(official);
  const blossom = element('section'); blossom.append(element('h2', '', 'Blossom 里程碑'));
  const timeline = element('div', 'timeline');
  for (const item of model.blossomMilestones) { const row = element('div'); row.append(element('b', '', String(item.level)), element('span', '', item.label)); timeline.append(row); }
  blossom.append(timeline); root.append(blossom);
  const observed = element('section'); observed.append(element('h2', '', '高置信观察（非官方）'), ruleCards(model.observedRules)); root.append(observed);
  const unknown = element('section'); unknown.append(element('h2', '', '未确认'), ruleCards(model.unknownRules)); root.append(unknown);

  const index = element('section');
  const details = element('details', 'wisp-rule-index');
  details.append(element('summary', '', `逐仙灵规则索引 · ${model.wisps.length}`));
  const list = element('div', 'wisp-rule-list');
  for (const wisp of model.wisps) {
    const row = element('article', 'wisp-rule-row'); row.dataset.wispRuleId = wisp.id;
    const heading = element('div', 'wisp-rule-name'); heading.append(element('h3', '', wisp.nameZh), element('span', '', wisp.nameEn), element('em', '', wisp.categoryLabel)); row.append(heading);
    const stages = element('div', 'wisp-rule-field'); stages.append(element('b', '', '阶段窗口'));
    for (const value of wisp.stageRanges.value) stages.append(element('span', 'stage-window', value));
    const stageConfidence = fieldConfidence(wisp.stageRanges); if (stageConfidence) stages.append(stageConfidence); row.append(stages);
    if (wisp.requirements.value.length) {
      const requirements = element('div', 'wisp-rule-field'); requirements.append(element('b', '', 'Requirements'));
      for (const value of wisp.requirements.value) requirements.append(element('span', 'requirement-text', value));
      const confidence = fieldConfidence(wisp.requirements); if (confidence) requirements.append(confidence); row.append(requirements);
    }
    const limits = element('div', 'wisp-rule-limits');
    if (wisp.oncePerGame) { const item = element('span', '', '每局仅一次'); const confidence = fieldConfidence(wisp.oncePerGame); if (confidence) item.append(confidence); limits.append(item); }
    if (wisp.reofferCooldownShops) { const item = element('span', '', `再次出现冷却 ${wisp.reofferCooldownShops.value} 个商店`); const confidence = fieldConfidence(wisp.reofferCooldownShops); if (confidence) item.append(confidence); limits.append(item); }
    if (wisp.minimumAffordableGold !== undefined) limits.append(element('span', '', `特殊最低金币 ${wisp.minimumAffordableGold}`));
    if (limits.childElementCount) row.append(limits);
    list.append(row);
  }
  details.append(list); index.append(details); root.append(index);
  return root;
}

export function renderRulesUnavailable(patch: string): HTMLElement {
  const root = element('div', 'rules-unavailable');
  root.append(element('p', 'eyebrow', `PATCH ${patch} · RULES`), element('h1', '', '刷新规律'), element('p', 'notice', `规则数据不可用：没有与仙灵版本 ${patch} 精确匹配的规则数据集。不会回退显示旧版本规则。`));
  return root;
}
