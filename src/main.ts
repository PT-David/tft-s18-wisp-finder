import './style.css';
import rules from '../rules/wisp_rules_18.1.json';
import { JsonWispRepository, loadWispDataset } from './data/wispRepository';
import { assertRuntimeSearchCompatibility, loadRuntimeSearchLexicon } from './data/searchLexiconRepository';
import type { RuntimeSearchLexicon, Wisp, WispCategory } from './domain/types';
import { WISP_CATEGORIES } from './domain/types';
import { calculateStageFive, probabilityForWisp, type StageFiveSlot } from './probability/equalWeight';
import { runQuery } from './query/queryModel';
import { normalizeSearchText } from './search/searchEngine';
import { criteriaFromUI, validationMessage, type QueryUIState } from './ui/queryState';
import { toSearchMatchReasonView } from './ui/searchMatchReason';
import { CATEGORY_LABELS, EFFECT_LABELS, slotLabel, toCardViewModel, type EffectMode } from './ui/viewModels';

const app = document.querySelector<HTMLDivElement>('#app')!;
const percent = (value: number) => `${(value * 100).toFixed(value && value < .01 ? 2 : 1)}%`;
const esc = (value: unknown) => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]!);
const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let wisps: readonly Wisp[] = [];
let searchLexicon: RuntimeSearchLexicon;
let composing = false;
const cardNodes = new Map<string, HTMLElement>();
const state: QueryUIState = {
  query: '', exactStage: '', rangeStart: '', rangeEnd: '', gold: '', affordableOnly: true,
  categories: new Set(), prismaticOnly: false, effectMode: 'normal', probabilityMode: false,
  slot: 'ordinary', minCost: '', maxCost: '', referenceId: '', excluded: new Set(), patch: '18.1',
};

const activeWisps = (): readonly Wisp[] => wisps.filter((wisp) => wisp.patch === state.patch);

function controlsHtml(): string {
  return `<section class="query-panel" id="queryPanel" aria-label="查询条件">
    <div class="search-row"><label class="search"><span>搜索</span><svg class="search-icon" aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path></svg><input id="query" type="search" placeholder="搜索仙灵名称或效果……" autocomplete="off"></label>
      <span class="search-help">多关键词同时满足</span></div>
    <div class="filters primary-filters">
      <label>精确回合<input id="exactStage" placeholder="如 4-3"></label><label>范围开始<input id="rangeStart" placeholder="如 3-1"></label>
      <label>范围结束<input id="rangeEnd" placeholder="如 4-7"></label><label>当前金币<input id="gold" inputmode="numeric" placeholder="不限"></label>
      <label>强调效果<select id="effectMode">${(['normal', 'blossom', 'prismatic'] as EffectMode[]).map((mode) => `<option value="${mode}">${EFFECT_LABELS[mode]}</option>`).join('')}</select></label>
    </div>
    <div class="compact-row"><fieldset><legend>官方类别</legend><div class="chips">${WISP_CATEGORIES.map((category) => `<label class="chip category-${category}"><input data-category="${category}" type="checkbox">${CATEGORY_LABELS[category]}</label>`).join('')}</div></fieldset>
      <div class="switches"><label><input id="prismaticOnly" type="checkbox"> 仅 Prismatic</label><label><input id="probabilityMode" type="checkbox"> 概率模式</label></div></div>
    <details class="advanced" id="advancedFilters"><summary>高级筛选</summary><div class="filters advanced-grid">
      <label>可负担候选<select id="affordableOnly"><option value="true">只看当前可负担</option><option value="false">允许浏览买不起的</option></select></label>
      <div class="reference-picker"><label for="referenceQuery">阶段参考仙灵</label><div id="referenceInputWrap"><input id="referenceQuery" autocomplete="off" placeholder="输入中文名或英文名" aria-controls="referenceOptions" aria-autocomplete="list"></div><div class="reference-options" id="referenceOptions" role="listbox" hidden></div><div class="reference-chip" id="referenceChip" hidden></div><small id="referenceHint">与参考仙灵阶段重叠</small></div>
      <label>最低售价<input id="minCost" inputmode="numeric" placeholder="不限"></label><label>最高售价<input id="maxCost" inputmode="numeric" placeholder="不限"></label>
    </div></details><p class="form-error" id="formError" role="status"></p>
  </section>`;
}

function probabilityHtml(pool: readonly Wisp[], targetIds: Set<string>): string {
  const result = calculateStageFive(pool, targetIds, state.slot);
  const block = (label: string, value: { poolSize: number; targetCount: number; targetProbability: number; perWispProbability: number }) =>
    `<div class="prob-block"><strong>${label}</strong><span>Candidate Pool <b data-stat="n">${value.poolSize}</b></span><span>搜索目标 K <b data-stat="k">${value.targetCount}</b></span><span>K/N <b>${percent(value.targetProbability)}</b></span><span>单仙灵 <b>${percent(value.perWispProbability)}</b></span></div>`;
  return `<div class="prob-head"><div><p class="eyebrow">等权工具模型 · 非真实刷新率</p><h2>概率概览</h2></div><label>Stage 5+ 位型<select id="slot">${(['ordinary', 'forced_combat', 'uncertain'] as StageFiveSlot[]).map((slot) => `<option value="${slot}" ${state.slot === slot ? 'selected' : ''}>${slotLabel(slot)}</option>`).join('')}</select></label></div><div class="prob-grid">${result.ordinary ? block('普通位', result.ordinary) : ''}${result.forcedCombat ? block('强制 Combat 位', result.forcedCombat) : ''}</div>`;
}

function createCard(wisp: Wisp): HTMLElement {
  const vm = toCardViewModel(wisp);
  const sourceRows = vm.sources.map((source) => `${source.sourceId} · ${source.confidence} · ${source.verifiedAt}`).filter((value, index, all) => all.indexOf(value) === index);
  const node = document.createElement('article');
  node.className = `card category-border-${vm.category}`;
  node.dataset.wispId = vm.id;
  node.dataset.cardKey = `${wisp.patch}:${wisp.id}`;
  node.innerHTML = `<div class="card-top"><span class="category-pill category-${vm.category}">${vm.categoryLabel}</span><span class="cost">◈ ${vm.cost}</span></div>
    <h3>${esc(vm.nameZh)}</h3><p class="name-en">${esc(vm.nameEn)}</p><p class="stages">◷ ${vm.stageText}</p>
    <div class="match-reasons" data-match-reasons hidden></div>
    <div class="effect normal-effect"><b>普通</b><span>${esc(vm.normal)}</span></div>
    ${vm.blossom ? `<div class="effect blossom-effect"><b>✦ Blossom</b><span>${esc(vm.blossom)}</span></div>` : ''}
    ${vm.requirements.length ? `<div class="requirements"><b>出现条件</b>${vm.requirements.map((text) => `<span>${esc(text)}</span>`).join('')}</div>` : ''}
    ${(vm.oncePerGame || vm.cooldown !== undefined) ? `<div class="limits">${vm.oncePerGame ? '<span>每局仅一次</span>' : ''}${vm.cooldown !== undefined ? `<span>冷却 ${vm.cooldown} 商店</span>` : ''}</div>` : ''}
    ${vm.prismatic ? `<details class="mini-details prismatic-details"><summary>✧ Prismatic Blossom</summary><p>${esc(vm.prismatic)}</p></details>` : ''}
    <div class="card-prob" hidden><span>此仙灵：<b data-card-prob>0%</b></span><button type="button" data-exclude="${vm.id}">排除此仙灵</button></div>
    <div class="card-actions"><button type="button" data-set-reference="${vm.id}">设为阶段参考</button></div>
    <details class="mini-details source-details"><summary>数据来源</summary><p>${sourceRows.map(esc).join('<br>')}</p></details>`;
  return node;
}

function updateCardMatchReasons(node: HTMLElement, hit: ReturnType<typeof runQuery>['displayedResults'][number]): void {
  const container = node.querySelector<HTMLElement>('[data-match-reasons]')!;
  const matches = [...hit.matches].sort((a, b) => a.clauseIndex - b.clauseIndex);
  if (!matches.length) {
    container.replaceChildren();
    container.hidden = true;
    return;
  }
  const label = document.createElement('span');
  label.className = 'match-reasons-label';
  label.textContent = '匹配';
  const reasons = matches.map((match) => {
    const view = toSearchMatchReasonView(hit.wisp, match, searchLexicon);
    const chip = document.createElement('span');
    chip.className = 'match-reason';
    chip.dataset.matchReason = '';
    chip.dataset.matchType = view.matchType;
    chip.textContent = view.text;
    return chip;
  });
  container.replaceChildren(label, ...reasons);
  container.hidden = false;
}

function updateExcluded(): void {
  const region = byId<HTMLElement>('excludedRegion');
  if (!state.probabilityMode || !state.excluded.size) { region.hidden = true; region.innerHTML = ''; return; }
  const excluded = [...state.excluded].flatMap((id) => {
    const wisp = activeWisps().find((item) => item.id === id);
    return wisp ? [`<button type="button" data-restore="${id}">${esc(wisp.nameZh)} ×</button>`] : [];
  });
  region.hidden = false;
  region.innerHTML = `<strong>已排除 ${excluded.length} 个</strong><div>${excluded.join('')}<button type="button" data-clear-excluded>清空排除</button></div>`;
}

function updateResults(): void {
  const message = validationMessage(state);
  byId('formError').textContent = message;
  const patchWisps = activeWisps();
  const query = runQuery(patchWisps, criteriaFromUI(state, patchWisps), state.query, searchLexicon);
  const targetIds = new Set(query.displayedResults.map(({ wisp }) => wisp.id));
  const cards = byId<HTMLElement>('cards');
  const visible = new Set<string>();
  for (const hit of query.displayedResults) {
    const { wisp } = hit;
    const cacheKey = `${wisp.patch}:${wisp.id}`;
    let node = cardNodes.get(cacheKey);
    if (!node) { node = createCard(wisp); cardNodes.set(cacheKey, node); }
    updateCardMatchReasons(node, hit);
    visible.add(cacheKey);
    const probability = node.querySelector<HTMLElement>('[data-card-prob]')!;
    const slot = state.slot === 'uncertain' ? 'ordinary' : state.slot;
    probability.textContent = percent(probabilityForWisp(wisp, query.candidatePool, slot));
    node.querySelector<HTMLElement>('.card-prob')!.hidden = !state.probabilityMode;
    cards.append(node);
  }
  for (const child of [...cards.children]) {
    const cardKey = (child as HTMLElement).dataset.cardKey;
    if (cardKey && !visible.has(cardKey)) child.remove();
  }
  byId('empty').hidden = query.displayedResults.length > 0;
  byId('resultCount').textContent = `${query.displayedResults.length} 个结果`;
  byId('poolSummary').textContent = `基础候选池 ${query.candidatePool.length} · 搜索和排序不会改变分母`;
  const probability = byId<HTMLElement>('probability');
  probability.hidden = !state.probabilityMode;
  if (state.probabilityMode) probability.innerHTML = probabilityHtml(query.candidatePool, targetIds);
  updateExcluded();
}

function updateReferenceHint(): void {
  byId('referenceHint').textContent = state.exactStage.trim()
    ? '与参考仙灵当前回合后的剩余阶段重叠'
    : '与参考仙灵阶段重叠';
}

function renderReferenceOptions(query: string): void {
  const options = byId<HTMLElement>('referenceOptions');
  const normalized = normalizeSearchText(query);
  if (!normalized || state.referenceId) { options.hidden = true; options.innerHTML = ''; return; }
  const matches = activeWisps().filter((wisp) => [wisp.nameZh, wisp.nameEn].some((name) => normalizeSearchText(name).includes(normalized))).slice(0, 6);
  options.innerHTML = matches.length
    ? matches.map((wisp) => `<button type="button" role="option" data-reference-option="${wisp.id}"><b>${esc(wisp.nameZh)}</b><span>${esc(wisp.nameEn)}</span></button>`).join('')
    : '<p>没有匹配仙灵</p>';
  options.hidden = false;
}

function setReference(id: string): void {
  const wisp = activeWisps().find((item) => item.id === id);
  if (!wisp) return;
  state.referenceId = wisp.id;
  byId<HTMLDetailsElement>('advancedFilters').open = true;
  byId<HTMLElement>('referenceInputWrap').hidden = true;
  const chip = byId<HTMLElement>('referenceChip');
  chip.hidden = false;
  chip.innerHTML = `<span>${esc(wisp.nameEn || wisp.nameZh)}</span><button type="button" data-clear-reference aria-label="清除阶段参考">×</button>`;
  renderReferenceOptions('');
  updateResults();
}

function clearReference(): void {
  state.referenceId = '';
  const input = byId<HTMLInputElement>('referenceQuery');
  input.value = '';
  byId<HTMLElement>('referenceInputWrap').hidden = false;
  byId<HTMLElement>('referenceChip').hidden = true;
  renderReferenceOptions('');
  updateResults();
}

function bindControls(): void {
  const textBinding: Array<[string, keyof Pick<QueryUIState, 'query' | 'exactStage' | 'rangeStart' | 'rangeEnd' | 'gold' | 'minCost' | 'maxCost'>]> = [
    ['query', 'query'], ['exactStage', 'exactStage'], ['rangeStart', 'rangeStart'], ['rangeEnd', 'rangeEnd'], ['gold', 'gold'], ['minCost', 'minCost'], ['maxCost', 'maxCost'],
  ];
  for (const [id, key] of textBinding) byId<HTMLInputElement>(id).addEventListener('input', (event) => {
    state[key] = (event.currentTarget as HTMLInputElement).value;
    if (!composing) updateResults();
  });
  const search = byId<HTMLInputElement>('query');
  search.addEventListener('compositionstart', () => { composing = true; });
  search.addEventListener('compositionupdate', () => { composing = true; });
  search.addEventListener('compositionend', () => { composing = false; state.query = search.value; updateResults(); });
  byId<HTMLSelectElement>('affordableOnly').addEventListener('change', (event) => { state.affordableOnly = (event.currentTarget as HTMLSelectElement).value === 'true'; updateResults(); });
  byId<HTMLInputElement>('prismaticOnly').addEventListener('change', (event) => { state.prismaticOnly = (event.currentTarget as HTMLInputElement).checked; updateResults(); });
  byId<HTMLInputElement>('probabilityMode').addEventListener('change', (event) => { state.probabilityMode = (event.currentTarget as HTMLInputElement).checked; updateResults(); });
  byId<HTMLInputElement>('referenceQuery').addEventListener('input', (event) => renderReferenceOptions((event.currentTarget as HTMLInputElement).value));
  byId<HTMLSelectElement>('patch').addEventListener('change', (event) => {
    state.patch = (event.currentTarget as HTMLSelectElement).value;
    state.excluded.clear();
    clearReference();
  });
  byId<HTMLSelectElement>('effectMode').addEventListener('change', (event) => { state.effectMode = (event.currentTarget as HTMLSelectElement).value as EffectMode; document.documentElement.dataset.effectMode = state.effectMode; });
  for (const input of document.querySelectorAll<HTMLInputElement>('[data-category]')) input.addEventListener('change', () => {
    const category = input.dataset.category as WispCategory;
    input.checked ? state.categories.add(category) : state.categories.delete(category);
    updateResults();
  });
  byId<HTMLInputElement>('exactStage').addEventListener('input', updateReferenceHint);
}

function rulesHtml(): string {
  const official = [['购买时机', '仅可在备战阶段购买'], ['商店位置', '正常每隔一个商店出现，位于最右侧'], ['每回合购买', `${rules.official.defaultPurchasesPerRound} 个`], ['Stage 5+', '每隔一个仙灵位保证为 Combat；普通位仍可出现 Combat']];
  return `<p class="eyebrow">PATCH 18.1 · RULES</p><h1>刷新规律</h1><p class="lead">只展示项目现有规则数据，并明确区分官方机制、观察结论与未知项。</p><section><h2>官方机制</h2><div class="rule-grid">${official.map(([title, text]) => `<article><span class="confidence">official</span><h3>${title}</h3><p>${text}</p></article>`).join('')}</div></section><section><h2>Blossom 里程碑</h2><div class="timeline">${Object.entries(rules.official.blossom).map(([level, effect]) => `<div><b>${level}</b><span>${effect.replaceAll('_', ' ')}</span></div>`).join('')}</div></section><section><h2>高置信观察（非官方）</h2><div class="rule-grid"><article><span class="confidence observed">community observation</span><h3>再次出现冷却</h3><p>常见约 ${rules.observedNotOfficial.defaultReofferCooldownShops} 个商店；装备类约 ${rules.observedNotOfficial.itemWispReofferCooldownShops} 个商店。</p></article><article><span class="confidence observed">community observation</span><h3>可负担观察</h3><p>可能排除当前无法负担的仙灵，完整公式尚未公开。</p></article></div></section><section><h2>概率边界</h2><p class="notice">V1 只提供“当前合资格仙灵等权”的工具模型。真实抽取机制仍未确认。</p></section>`;
}

function initialize(): void {
  const patches = [...new Set(wisps.map(({ patch }) => patch))];
  state.patch = patches[0] || '18.1';
  app.innerHTML = `<header><a class="brand" href="#" data-tab="finder"><span>✦</span><b>WISP FINDER</b><small>SET 18</small></a><nav><button data-tab="finder" class="active">仙灵查询</button><button data-tab="rules">刷新规律</button></nav><label class="header-patch">版本<select id="patch">${patches.map((patch) => `<option value="${esc(patch)}">${esc(patch)}</option>`).join('')}</select></label></header>
    <main><section id="finderPage">${controlsHtml()}<div class="content"><section class="probability" id="probability" hidden></section><section class="excluded" id="excludedRegion" hidden></section><div class="result-heading"><div><p class="eyebrow">DISPLAYED RESULTS</p><h2 id="resultCount" role="status" aria-live="polite" aria-atomic="true"></h2></div><p id="poolSummary"></p></div><section class="cards" id="cards"></section><div class="empty" id="empty" hidden><b>没有匹配结果</b><span>请调整搜索词或公共筛选。</span></div></div></section><section class="rules-page content" id="rulesPage" hidden>${rulesHtml()}</section></main><footer>当前为部分核验种子数据，并非完整仙灵全集。</footer>`;
  bindControls();
  app.addEventListener('change', (event) => {
    if ((event.target as HTMLElement).id === 'slot') { state.slot = (event.target as HTMLSelectElement).value as StageFiveSlot; updateResults(); }
  });
  app.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const tab = target.closest<HTMLElement>('[data-tab]')?.dataset.tab;
    if (tab) {
      event.preventDefault();
      byId('finderPage').hidden = tab !== 'finder'; byId('rulesPage').hidden = tab !== 'rules';
      document.querySelectorAll('[data-tab]').forEach((item) => item.classList.toggle('active', (item as HTMLElement).dataset.tab === tab));
      return;
    }
    const exclude = target.closest<HTMLElement>('[data-exclude]')?.dataset.exclude;
    const restore = target.closest<HTMLElement>('[data-restore]')?.dataset.restore;
    const referenceOption = target.closest<HTMLElement>('[data-reference-option]')?.dataset.referenceOption;
    const cardReference = target.closest<HTMLElement>('[data-set-reference]')?.dataset.setReference;
    if (exclude) { state.excluded.add(exclude); updateResults(); }
    if (restore) { state.excluded.delete(restore); updateResults(); }
    if (target.closest('[data-clear-excluded]')) { state.excluded.clear(); updateResults(); }
    if (referenceOption) setReference(referenceOption);
    if (cardReference) setReference(cardReference);
    if (target.closest('[data-clear-reference]')) clearReference();
  });
  updateResults();
}

app.innerHTML = '<div class="loading">正在读取开发种子数据…</div>';
Promise.all([loadWispDataset(), loadRuntimeSearchLexicon()]).then(([dataset, lexicon]) => {
  assertRuntimeSearchCompatibility(dataset, lexicon);
  wisps = new JsonWispRepository(dataset).getAll(); searchLexicon = lexicon; initialize();
}).catch((error: unknown) => {
  app.innerHTML = `<div class="loading error">${esc(error instanceof Error ? error.message : '数据加载失败')}</div>`;
});
