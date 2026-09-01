import { WISP_CATEGORIES, type Confidence, type WispCategory } from '../domain/types';
import { filterRuleRows, type RuleIndexFilter } from '../rules/filterRuleRows';
import type { GeneralRuleView, RulesPageViewModel, WispRuleField, WispRuleRow } from '../rules/rulePageModel';
import { CONFIDENCE_LABELS } from './confidenceLabels';
import { CATEGORY_LABELS } from './viewModels';

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

const ruleRow = (wisp: WispRuleRow): HTMLElement => {
  const row = element('article', 'wisp-rule-row');
  row.dataset.wispRuleId = wisp.id;
  row.dataset.category = wisp.category;
  row.dataset.specialRules = String(wisp.hasSpecialRules);
  const heading = element('div', 'wisp-rule-name');
  const name = element('div'); name.append(element('h3', '', wisp.nameZh), element('span', '', wisp.nameEn));
  heading.append(name, element('em', '', wisp.categoryLabel)); row.append(heading);
  const stages = element('div', 'wisp-rule-field wisp-rule-stages'); stages.append(element('b', '', '阶段窗口'));
  const stageValues = element('div', 'stage-windows');
  for (const value of wisp.stageRanges.value) stageValues.append(element('span', 'stage-window', value));
  stages.append(stageValues); const stageConfidence = fieldConfidence(wisp.stageRanges); if (stageConfidence) stages.append(stageConfidence); row.append(stages);
  if (wisp.requirements.value.length) {
    const requirements = element('div', 'wisp-rule-field wisp-rule-requirements'); requirements.append(element('b', '', '出现要求'));
    const values = element('div', 'requirement-values');
    for (const value of wisp.requirements.value) values.append(element('span', 'requirement-text', value));
    requirements.append(values); const confidence = fieldConfidence(wisp.requirements); if (confidence) requirements.append(confidence); row.append(requirements);
  } else {
    const requirements = element('div', 'wisp-rule-field wisp-rule-requirements wisp-rule-none');
    requirements.append(element('b', '', '出现要求'), element('span', '', '无额外要求')); row.append(requirements);
  }
  const limits = element('div', 'wisp-rule-limits');
  if (wisp.oncePerGame) { const item = element('span', '', '每局仅一次'); const confidence = fieldConfidence(wisp.oncePerGame); if (confidence) item.append(confidence); limits.append(item); }
  if (wisp.reofferCooldownShops) { const item = element('span', '', `冷却 ${wisp.reofferCooldownShops.value} 个商店`); const confidence = fieldConfidence(wisp.reofferCooldownShops); if (confidence) item.append(confidence); limits.append(item); }
  if (wisp.minimumAffordableGold !== undefined) limits.append(element('span', '', `特殊最低金币 ${wisp.minimumAffordableGold}`));
  if (limits.childElementCount) row.append(limits);
  return row;
};

const sectionHeading = (title: string, description: string): DocumentFragment => {
  const fragment = document.createDocumentFragment();
  fragment.append(element('h2', '', title), element('p', 'rules-section-description', description));
  return fragment;
};

export function renderRulesPage(model: RulesPageViewModel): HTMLElement {
  const root = element('div', 'rules-page-inner');
  const hero = element('div', 'rules-hero');
  hero.append(element('p', 'eyebrow', `PATCH ${model.patch} · RULES`), element('h1', '', '刷新规律'), element('p', 'lead', '官方机制、实测观察、未知项与逐仙灵规则索引。'));
  const summary = element('div', 'rules-summary');
  summary.append(element('span', '', `${model.summary.wispCount} 个仙灵`), element('span', '', `${model.summary.categoryCount} 类`), element('span', '', `Patch ${model.patch}`));
  hero.append(summary);
  const legend = element('p', 'confidence-legend'); legend.append(element('b', '', '可信度：'));
  for (const confidence of Object.keys(CONFIDENCE_LABELS) as Confidence[]) legend.append(element('span', '', CONFIDENCE_LABELS[confidence]));
  hero.append(legend); root.append(hero);

  const navigation = element('nav', 'rules-navigation'); navigation.setAttribute('aria-label', '刷新规律章节');
  for (const [id, label] of [['rules-official', '官方机制'], ['rules-blossom', 'Blossom'], ['rules-observed', '高置信观察'], ['rules-unknown', '未确认'], ['rules-index', '逐仙灵索引']]) {
    const link = element('a', '', label); link.href = `#${id}`; navigation.append(link);
  }
  root.append(navigation);

  const official = element('section'); official.id = 'rules-official'; official.append(sectionHeading('官方机制', '来自当前 Patch 的官方规则数据。'), ruleCards(model.officialRules)); root.append(official);
  const blossom = element('section'); blossom.id = 'rules-blossom'; blossom.append(sectionHeading('Blossom 里程碑', '等级提升时依次解锁，窄屏会自动换行。'));
  const timeline = element('div', 'timeline');
  for (const item of model.blossomMilestones) { const row = element('div'); row.append(element('b', '', String(item.level)), element('span', '', item.label)); timeline.append(row); }
  blossom.append(timeline); root.append(blossom);
  const observed = element('section'); observed.id = 'rules-observed'; observed.append(sectionHeading('高置信观察（非官方）', '经过核验的实测规律，仍与官方确认分层展示。'), ruleCards(model.observedRules)); root.append(observed);
  const unknown = element('section'); unknown.id = 'rules-unknown'; unknown.append(sectionHeading('未确认', '保持中性呈现尚未确认的真实抽取机制。'), ruleCards(model.unknownRules)); root.append(unknown);

  const index = element('section'); index.id = 'rules-index';
  const details = element('details', 'wisp-rule-index');
  const disclosure = element('summary'); disclosure.append(element('span', '', `逐仙灵规则索引 · ${model.summary.wispCount}`), element('small', '', '按名称与类别快速定位；展开状态会在页面切换时保留。')); details.append(disclosure);
  const body = element('div', 'wisp-rule-index-body');
  const controls = element('div', 'rule-index-controls');
  const queryLabel = element('label'); queryLabel.append(element('span', '', '定位仙灵')); const query = element('input'); query.type = 'search'; query.placeholder = '输入中文名或英文名'; query.autocomplete = 'off'; queryLabel.append(query);
  const categoryLabel = element('label'); categoryLabel.append(element('span', '', '类别')); const category = element('select');
  const all = element('option', '', '全部类别'); all.value = ''; category.append(all);
  for (const key of WISP_CATEGORIES) { const option = element('option', '', CATEGORY_LABELS[key]); option.value = key; category.append(option); }
  categoryLabel.append(category);
  const specialLabel = element('label', 'rule-special-filter'); const special = element('input'); special.type = 'checkbox'; specialLabel.append(special, element('span', '', '仅显示有特殊规则'));
  const clear = element('button', 'rule-filter-clear', '清除筛选'); clear.type = 'button';
  controls.append(queryLabel, categoryLabel, specialLabel, clear);
  const status = element('p', 'rule-index-status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  const list = element('div', 'wisp-rule-list');
  const empty = element('div', 'rule-index-empty'); empty.hidden = true; empty.append(element('b', '', '没有符合条件的仙灵规则'), element('span', '', '请调整名称、类别或特殊规则筛选。'));
  const emptyClear = element('button', 'rule-filter-clear', '清除筛选'); emptyClear.type = 'button'; empty.append(emptyClear);
  body.append(controls, status, list, empty); details.append(body); index.append(details); root.append(index);

  const filter: RuleIndexFilter = { query: '', category: undefined, specialOnly: false };
  const updateRows = (): void => {
    const rows = filterRuleRows(model.wisps, filter);
    list.replaceChildren(...rows.map(ruleRow));
    status.textContent = `显示 ${rows.length} / ${model.summary.wispCount}`;
    empty.hidden = rows.length !== 0; list.hidden = rows.length === 0;
  };
  const reset = (): void => { filter.query = ''; filter.category = undefined; filter.specialOnly = false; query.value = ''; category.value = ''; special.checked = false; updateRows(); };
  query.addEventListener('input', () => { filter.query = query.value; updateRows(); });
  category.addEventListener('change', () => { filter.category = category.value ? category.value as WispCategory : undefined; updateRows(); });
  special.addEventListener('change', () => { filter.specialOnly = special.checked; updateRows(); });
  clear.addEventListener('click', reset); emptyClear.addEventListener('click', reset);
  updateRows();
  return root;
}

export function renderRulesUnavailable(patch: string): HTMLElement {
  const root = element('div', 'rules-unavailable');
  root.append(element('p', 'eyebrow', `PATCH ${patch} · RULES`), element('h1', '', '刷新规律'), element('p', 'notice', `规则数据不可用：没有与仙灵版本 ${patch} 精确匹配的规则数据集。不会回退显示旧版本规则。`));
  return root;
}
