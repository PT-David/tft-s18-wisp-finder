import './style.css';
import rules from '../rules/wisp_rules_18.1.json';
import { JsonWispRepository, loadWispDataset } from './data/wispRepository';
import type { StagePoint, Wisp, WispCategory } from './domain/types';
import { WISP_CATEGORIES } from './domain/types';
import type { CandidateCriteria } from './filter/candidates';
import { calculateStageFive, probabilityForWisp, type StageFiveSlot } from './probability/equalWeight';
import { runQuery } from './query/queryModel';
import { CATEGORY_LABELS, EFFECT_LABELS, slotLabel, toCardViewModel, type EffectMode } from './ui/viewModels';

const app = document.querySelector<HTMLDivElement>('#app')!;
const percent = (value: number) => `${(value * 100).toFixed(value && value < .01 ? 2 : 1)}%`;
const esc = (value: unknown) => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!);
const readPoint = (value: string): StagePoint | undefined => {
  const match = value.match(/^(\d+)-(\d+)$/); return match ? { stage: Number(match[1]), round: Number(match[2]) } : undefined;
};

interface UIState {
  tab: 'finder' | 'rules'; query: string; exactStage: string; rangeStart: string; rangeEnd: string; gold: string;
  affordableOnly: boolean; categories: Set<WispCategory>; prismaticOnly: boolean; effectMode: EffectMode; probabilityMode: boolean;
  slot: StageFiveSlot; minCost: string; maxCost: string; referenceId: string; excluded: Set<string>;
}
const state: UIState = { tab: 'finder', query: '', exactStage: '', rangeStart: '', rangeEnd: '', gold: '', affordableOnly: true,
  categories: new Set(), prismaticOnly: false, effectMode: 'normal', probabilityMode: false, slot: 'ordinary', minCost: '', maxCost: '', referenceId: '', excluded: new Set() };
let wisps: readonly Wisp[] = [];

function criteria(): CandidateCriteria {
  const exact = readPoint(state.exactStage), start = readPoint(state.rangeStart), end = readPoint(state.rangeEnd);
  const reference = wisps.find(({ id }) => id === state.referenceId);
  return {
    stage: exact, stageRange: !exact && start && end ? { start, end } : undefined,
    currentGold: state.gold === '' ? undefined : Number(state.gold), affordableOnly: state.affordableOnly,
    categories: [...state.categories], prismaticOnly: state.prismaticOnly, excludedIds: state.excluded,
    referenceRanges: reference?.stageRanges, referenceFrom: exact || start,
    minCost: state.minCost === '' ? undefined : Number(state.minCost), maxCost: state.maxCost === '' ? undefined : Number(state.maxCost),
  };
}

function controls(): string {
  return `<section class="query-panel" aria-label="查询条件">
    <label class="search"><span>搜索</span><input id="query" type="search" value="${esc(state.query)}" placeholder="搜索仙灵名称或效果……" autocomplete="off"><kbd>AND</kbd></label>
    <div class="filters">
      <label>精确回合<input id="exactStage" value="${esc(state.exactStage)}" placeholder="如 4-3"></label>
      <label>范围开始<input id="rangeStart" value="${esc(state.rangeStart)}" placeholder="如 3-1"></label>
      <label>范围结束<input id="rangeEnd" value="${esc(state.rangeEnd)}" placeholder="如 4-7"></label>
      <label>当前金币<input id="gold" type="number" min="0" value="${esc(state.gold)}" placeholder="不限"></label>
    </div>
    <fieldset><legend>官方类别</legend><div class="chips">${WISP_CATEGORIES.map((category) => `<label class="chip category-${category}"><input data-category="${category}" type="checkbox" ${state.categories.has(category) ? 'checked' : ''}>${CATEGORY_LABELS[category]}</label>`).join('')}</div></fieldset>
    <div class="switch-row"><label><input id="prismaticOnly" type="checkbox" ${state.prismaticOnly ? 'checked' : ''}> 仅 Prismatic</label><label><input id="probabilityMode" type="checkbox" ${state.probabilityMode ? 'checked' : ''}> 概率模式</label>
      <label>效果模式<select id="effectMode">${(['normal', 'blossom', 'prismatic'] as EffectMode[]).map((mode) => `<option value="${mode}" ${state.effectMode === mode ? 'selected' : ''}>${EFFECT_LABELS[mode]}</option>`).join('')}</select></label></div>
    <details class="advanced"><summary>高级筛选</summary><div class="filters advanced-grid"><label><span>可负担候选</span><select id="affordableOnly"><option value="true" ${state.affordableOnly ? 'selected' : ''}>只看当前可负担</option><option value="false" ${!state.affordableOnly ? 'selected' : ''}>允许浏览买不起的</option></select></label>
      <label>参考仙灵剩余窗口<select id="referenceId"><option value="">不启用</option>${wisps.map((w) => `<option value="${w.id}" ${state.referenceId === w.id ? 'selected' : ''}>${esc(w.nameZh)}</option>`).join('')}</select></label>
      <label>最低售价<input id="minCost" type="number" min="0" value="${esc(state.minCost)}" placeholder="不限"></label><label>最高售价<input id="maxCost" type="number" min="0" value="${esc(state.maxCost)}" placeholder="不限"></label></div></details>
  </section>`;
}

function probabilityPanel(pool: readonly Wisp[], displayedIds: Set<string>): string {
  if (!state.probabilityMode) return '';
  const result = calculateStageFive(pool, displayedIds, state.slot);
  const block = (label: string, value: { poolSize: number; targetCount: number; targetProbability: number; perWispProbability: number }) =>
    `<div><strong>${label}</strong><span>Candidate Pool <b>${value.poolSize}</b></span><span>搜索目标 K <b>${value.targetCount}</b></span><span>K/N <b>${percent(value.targetProbability)}</b></span><span>单仙灵 <b>${percent(value.perWispProbability)}</b></span></div>`;
  return `<section class="probability"><div class="prob-head"><div><p class="eyebrow">等权工具模型 · 非真实刷新率</p><h2>概率概览</h2></div><label>Stage 5+ 位型<select id="slot">${(['ordinary', 'forced_combat', 'uncertain'] as StageFiveSlot[]).map((slot) => `<option value="${slot}" ${state.slot === slot ? 'selected' : ''}>${slotLabel(slot)}</option>`).join('')}</select></label></div><div class="prob-grid">${result.ordinary ? block('普通位', result.ordinary) : ''}${result.forcedCombat ? block('强制 Combat 位', result.forcedCombat) : ''}</div></section>`;
}

function card(wisp: Wisp, pool: readonly Wisp[]): string {
  const vm = toCardViewModel(wisp, state.effectMode);
  const sourceRows = vm.sources.map((source) => `${source.sourceId} · ${source.confidence} · ${source.verifiedAt}`).filter((v, i, a) => a.indexOf(v) === i);
  const slot = state.slot === 'uncertain' ? 'ordinary' : state.slot;
  return `<article class="card category-border-${vm.category}"><div class="card-top"><span class="category-pill category-${vm.category}">${vm.categoryLabel}</span><span class="cost">◈ ${vm.cost}</span></div><h3>${esc(vm.nameZh)}</h3><p class="name-en">${esc(vm.nameEn)}</p>
    <p class="stages">◷ ${vm.stageText}</p><div class="badges">${vm.hasBlossom ? '<span>✦ Blossom</span>' : ''}${vm.hasPrismatic ? '<span class="prismatic">✧ Prismatic</span>' : ''}</div>
    <p class="mode-label">${EFFECT_LABELS[vm.summaryMode]}效果</p><p class="summary">${esc(vm.summary)}</p>${vm.requirements.length ? `<div class="requirements"><b>出现条件</b>${vm.requirements.map((text) => `<span>${esc(text)}</span>`).join('')}</div>` : ''}
    ${state.probabilityMode ? `<div class="card-prob"><span>此仙灵：<b>${percent(probabilityForWisp(wisp, pool, slot))}</b></span><label><input data-exclude="${wisp.id}" type="checkbox"> 排除此仙灵</label></div>` : ''}
    <details class="card-details"><summary>查看完整信息</summary><dl><dt>普通效果</dt><dd>${esc(vm.normal)}</dd>${vm.blossom ? `<dt>Blossom Upgrade</dt><dd>${esc(vm.blossom)}</dd>` : ''}${vm.prismatic ? `<dt>Prismatic Blossom</dt><dd>${esc(vm.prismatic)}</dd>` : ''}${vm.requirements.length ? `<dt>Requirements</dt><dd>${vm.requirements.map(esc).join('<br>')}</dd>` : ''}<dt>限制</dt><dd>${vm.oncePerGame ? '每局仅一次' : '非 once-per-game'} · ${vm.cooldown === undefined ? '再次出现冷却未知' : `再次出现冷却 ${vm.cooldown} 个商店`}</dd><dt>完整阶段</dt><dd>${vm.stageText}</dd><dt>来源 / 可信度 / 核验</dt><dd>${sourceRows.map(esc).join('<br>')}</dd><dt>版本</dt><dd>${vm.patch}</dd></dl></details></article>`;
}

function finder(): string {
  const result = runQuery(wisps, criteria(), state.query);
  const displayed = result.displayedResults;
  const displayedIds = new Set(displayed.map(({ wisp }) => wisp.id));
  return `${controls()}<div class="content">${probabilityPanel(result.candidatePool, displayedIds)}<div class="result-heading"><div><p class="eyebrow">DISPLAYED RESULTS</p><h2>${displayed.length} 个结果</h2></div><p>基础候选池 ${result.candidatePool.length} · 搜索和排序不会改变分母</p></div><section class="cards">${displayed.map(({ wisp }) => card(wisp, result.candidatePool)).join('') || '<div class="empty"><b>没有匹配结果</b><span>请调整搜索词或公共筛选。</span></div>'}</section></div>`;
}

function rulesPage(): string {
  const official = [
    ['购买时机', '仅可在备战阶段购买', 'official'], ['商店位置', '正常每隔一个商店出现，位于最右侧', 'official'], ['每回合购买', `${rules.official.defaultPurchasesPerRound} 个`, 'official'],
    ['Stage 5+', '每隔一个仙灵位保证为 Combat；普通位仍可出现 Combat', 'official'],
  ];
  const blossom = Object.entries(rules.official.blossom);
  return `<div class="rules-page content"><p class="eyebrow">PATCH 18.1 · RULES</p><h1>刷新规律</h1><p class="lead">只展示项目现有规则数据，并明确区分官方机制、观察结论与未知项。</p><section><h2>官方机制</h2><div class="rule-grid">${official.map(([title, text, confidence]) => `<article><span class="confidence">${confidence}</span><h3>${title}</h3><p>${text}</p></article>`).join('')}</div></section><section><h2>Blossom 里程碑</h2><div class="timeline">${blossom.map(([level, effect]) => `<div><b>${level}</b><span>${effect.replaceAll('_', ' ')}</span></div>`).join('')}</div></section><section><h2>高置信观察（非官方）</h2><div class="rule-grid"><article><span class="confidence observed">community observation</span><h3>再次出现冷却</h3><p>常见约 ${rules.observedNotOfficial.defaultReofferCooldownShops} 个商店；装备类约 ${rules.observedNotOfficial.itemWispReofferCooldownShops} 个商店。</p></article><article><span class="confidence observed">community observation</span><h3>可负担观察</h3><p>可能排除当前无法负担的仙灵，完整公式尚未公开。</p></article></div></section><section><h2>概率边界</h2><p class="notice">V1 只提供“当前合资格仙灵等权”的工具模型。真实游戏可能包含类别抽取、隐藏权重或其他机制，当前均未确认。</p></section></div>`;
}

function render(): void {
  app.innerHTML = `<header><a class="brand" href="#" data-tab="finder"><span>✦</span><b>WISP FINDER</b><small>SET 18</small></a><nav><button data-tab="finder" class="${state.tab === 'finder' ? 'active' : ''}">仙灵查询</button><button data-tab="rules" class="${state.tab === 'rules' ? 'active' : ''}">刷新规律</button></nav><span class="patch">PATCH 18.1</span></header><main>${state.tab === 'finder' ? finder() : rulesPage()}</main><footer>当前为部分核验种子数据，并非完整仙灵全集。</footer>`;
}

app.addEventListener('input', (event) => {
  const input = event.target as HTMLInputElement | HTMLSelectElement;
  const checked = input instanceof HTMLInputElement && input.checked;
  if (input.dataset.category) checked ? state.categories.add(input.dataset.category as WispCategory) : state.categories.delete(input.dataset.category as WispCategory);
  else if (input.dataset.exclude) { checked ? state.excluded.add(input.dataset.exclude) : state.excluded.delete(input.dataset.exclude); }
  else if (input.id in state) (state as unknown as Record<string, unknown>)[input.id] = input.type === 'checkbox' ? checked : input.value;
  else return;
  render();
  if (input.id) (document.getElementById(input.id) as HTMLElement | null)?.focus();
});
app.addEventListener('click', (event) => {
  const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab as UIState['tab'] | undefined;
  if (tab) { event.preventDefault(); state.tab = tab; render(); }
});

app.innerHTML = '<div class="loading">正在读取开发种子数据…</div>';
loadWispDataset().then((dataset) => { wisps = new JsonWispRepository(dataset).getAll(); render(); }).catch((error: unknown) => {
  app.innerHTML = `<div class="loading error">${esc(error instanceof Error ? error.message : '数据加载失败')}</div>`;
});
