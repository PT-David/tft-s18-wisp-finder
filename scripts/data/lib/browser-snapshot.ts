import { createHash } from 'node:crypto';

export type BrowserSource = 'opgg' | 'lolchess';
export interface ImportedWisp {
  sourceKey?: string; name: string; nameEn?: string; nameLocalized?: string; category?: string;
  cost?: number; effect?: string; appearanceCondition?: string; stageRanges?: unknown;
  blossom?: string | null; prismatic?: string | null; requirements?: unknown;
  oncePerGame?: boolean; reofferCooldownShops?: number | null;
}

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : undefined;
const first = (object: Record<string, unknown>, keys: string[]) => keys.map((key) => object[key]).find((value) => value !== undefined && value !== null);
const effectText = (value: unknown) => text(value) ?? (value && typeof value === 'object' ? text(first(value as Record<string, unknown>, ['effect', 'description', 'desc', 'text'])) : undefined);
const entities = (value: string) => value.replaceAll('&quot;', '"').replaceAll('&#34;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>');

function normalize(object: Record<string, unknown>): ImportedWisp | undefined {
  const name = text(first(object, ['nameEn', 'name', 'title', 'displayName', 'localizedName']));
  const effect = text(first(object, ['normalEffect', 'effect', 'description', 'desc']));
  const category = text(first(object, ['category', 'type', 'wispCategory']));
  const cost = number(first(object, ['cost', 'price', 'gold']));
  if (!name || (!effect && !category && cost === undefined)) return undefined;
  return {
    sourceKey: text(first(object, ['apiName', 'id', 'key', 'slug'])), name,
    nameEn: text(first(object, ['nameEn', 'englishName'])), nameLocalized: text(first(object, ['nameZh', 'localizedName'])),
    category, cost, effect, appearanceCondition: text(first(object, ['appearanceCondition', 'condition', 'rounds'])),
    stageRanges: first(object, ['stageRanges', 'stages', 'roundRanges']), blossom: effectText(first(object, ['blossom', 'upgradeEffect', 'upgrade'])) ?? null,
    prismatic: effectText(first(object, ['prismatic', 'prismaticEffect'])) ?? null, requirements: first(object, ['requirements', 'requires']),
    oncePerGame: typeof object.oncePerGame === 'boolean' ? object.oncePerGame : undefined,
    reofferCooldownShops: object.reofferCooldownShops === null ? null : number(object.reofferCooldownShops),
  };
}

function jsonPayloads(html: string): unknown[] {
  const payloads: unknown[] = [];
  for (const match of html.matchAll(/<script\b[^>]*(?:type=["']application\/(?:json|ld\+json)["']|id=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { payloads.push(JSON.parse(entities(match[1]!.trim()))); } catch { /* fail closed; another payload may be valid */ }
  }
  for (const match of html.matchAll(/data-wisp-record=["']([^"']+)["']/gi)) {
    try { payloads.push(JSON.parse(entities(match[1]!))); } catch { /* invalid explicit record */ }
  }
  // Next.js App Router serializes server data into Flight chunks rather than
  // __NEXT_DATA__.  The argument is a JSON array, so decoding it does not
  // require evaluating page JavaScript.
  for (const match of html.matchAll(/self\.__next_f\.push\((\[.*?\])\)<\/script>/gis)) {
    try {
      const chunk = JSON.parse(match[1]!) as unknown[];
      if (typeof chunk[1] !== 'string') continue;
      const marker = '"wisps":';
      const start = chunk[1].indexOf(marker);
      if (start < 0) continue;
      const tail = chunk[1].slice(start + marker.length);
      // The Wisp array is followed by other Flight data. Locate its balanced
      // closing bracket while respecting JSON strings, then parse only it.
      let depth = 0; let quoted = false; let escaped = false; let end = -1;
      for (let index = 0; index < tail.length; index += 1) {
        const char = tail[index]!;
        if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
        if (char === '"') quoted = true;
        else if (char === '[') depth += 1;
        else if (char === ']' && --depth === 0) { end = index + 1; break; }
      }
      if (end > 0) payloads.push(JSON.parse(tail.slice(0, end)));
    } catch { /* malformed Flight chunk */ }
  }
  return payloads;
}

const classPattern = (name: string) => new RegExp(`(?:^|\\s)${name.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}(?:\\s|$)`);

function elementsByClass(html: string, className: string) {
  const results: string[] = [];
  const opening = /<([a-z][\w:-]*)\b([^>]*)>/gi;
  for (let match = opening.exec(html); match; match = opening.exec(html)) {
    const classes = match[2]!.match(/\bclass=["']([^"']*)["']/i)?.[1] ?? '';
    if (!classPattern(className).test(classes)) continue;
    const tag = match[1]!; const start = match.index; const contentStart = opening.lastIndex;
    const tags = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'); tags.lastIndex = contentStart;
    let depth = 1; let closing: RegExpExecArray | null;
    while ((closing = tags.exec(html))) {
      if (!closing[0].startsWith('</')) depth += 1; else depth -= 1;
      if (depth === 0) { results.push(html.slice(start, tags.lastIndex)); opening.lastIndex = tags.lastIndex; break; }
    }
  }
  return results;
}

const decodeHtml = (value: string) => value
  .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
  .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replaceAll('&nbsp;', ' ').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
const visibleText = (html: string) => decodeHtml(html.replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/gi, '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();

function renderedLolchessRecords(html: string): ImportedWisp[] {
  const cards = [...html.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/gi)].map((match) => match[0]).filter((card) => elementsByClass(card, 'name-cell').length && elementsByClass(card, 'description-cell').length);
  return cards.map((card) => {
    const nameCell = elementsByClass(card, 'name-cell')[0]!;
    const name = visibleText(nameCell.match(/<strong\b[^>]*>[\s\S]*?<\/strong>/i)?.[0] ?? nameCell);
    const costCell = elementsByClass(card, 'cost-cell')[0] ?? '';
    const cost = number(visibleText(costCell.match(/<strong\b[^>]*>[\s\S]*?<\/strong>/i)?.[0] ?? costCell));
    const descriptionCell = elementsByClass(card, 'description-cell')[0]!;
    const effect = visibleText(elementsByClass(descriptionCell, 'description')[0] ?? '');
    const upgradeLines = elementsByClass(descriptionCell, 'upgrade-line');
    const labeledEffect = (labelClass: string, label: RegExp) => {
      const line = upgradeLines.find((candidate) => elementsByClass(candidate, labelClass).length || label.test(visibleText(candidate)));
      if (line) return text(visibleText(line).replace(label, '').trim()) ?? null;
      const labelElement = elementsByClass(descriptionCell, labelClass)[0];
      if (!labelElement) return null;
      const afterLabel = descriptionCell.slice(descriptionCell.indexOf(labelElement) + labelElement.length);
      const paragraph = afterLabel.match(/<p\b[^>]*>[\s\S]*?<\/p>/i)?.[0];
      return paragraph ? text(visibleText(paragraph)) ?? null : null;
    };
    const requirements = elementsByClass(descriptionCell, 'hint').map(visibleText).filter((hint) => /^Requirements\s*:/i.test(hint)).map((hint) => hint.replace(/^Requirements\s*:\s*/i, '').trim()).filter(Boolean);
    const stageHtml = elementsByClass(card, 'stage-info').join(' ') || elementsByClass(card, 'stage-cell').join(' ');
    const stageRanges = [...visibleText(stageHtml).matchAll(/(\d+)-(\d+)\s*(?:to|~|–|—)\s*(\d+)-(\d+)/gi)].map((match) => ({ start: { stage: Number(match[1]), round: Number(match[2]) }, end: { stage: Number(match[3]), round: Number(match[4]) } }));
    const cardText = visibleText(card);
    const cooldown = cardText.match(/(?:re-?offer(?:ed)?|offered again)[^\d]{0,40}(\d+)\s*shops?/i);
    const category = card.match(/\bdata-category=["']([^"']+)["']/i)?.[1] ?? card.match(/\b(?:alt|title)=["'](Champion|Combat|Misc|Shop|Gold\/?XP|Risky|Item)\s+Wisp["']/i)?.[1];
    return { name, nameEn: name, category, cost, effect, stageRanges, blossom: labeledEffect('upgrade-label', /^Blossom Upgrade\s*:\s*/i), prismatic: labeledEffect('prismatic-label', /^Prismatic Blossom\s*:\s*/i), requirements, oncePerGame: /\bonce per game\b/i.test(cardText) ? true : undefined, reofferCooldownShops: cooldown ? Number(cooldown[1]) : undefined };
  }).filter(({ name, effect }) => Boolean(name && effect));
}

export function parseBrowserSnapshot(source: BrowserSource, html: string): { sourceUrl: string; pageUpdatedAt: string | null; declaredRecordCount: number | null; records: ImportedWisp[]; sha256: string } {
  const expected = source === 'opgg' ? /https:\/\/op\.gg\/(?:zh-cn|zh-tw|en)\/tft\/set\/18/i : /https:\/\/lolchess\.gg\/rewards\/set18\/wisps/i;
  const canonical = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)/i)?.[1]
    ?? html.match(/<meta\b[^>]*property=["']og:url["'][^>]*content=["']([^"']+)/i)?.[1];
  if (!canonical || !expected.test(canonical)) throw new Error(`快照身份校验失败：未找到 ${source} Set 18 Wisp canonical URL`);
  const found: ImportedWisp[] = [];
  const seen = new Set<object>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object' || seen.has(value as object)) return;
    seen.add(value as object);
    if (Array.isArray(value)) { value.forEach(walk); return; }
    const object = value as Record<string, unknown>; const record = normalize(object);
    if (record) found.push(record); Object.values(object).forEach(walk);
  };
  jsonPayloads(html).forEach(walk);
  if (source === 'lolchess' && !found.length) found.push(...renderedLolchessRecords(html));
  const deduped = new Map<string, ImportedWisp>();
  for (const record of found) {
    const key = record.sourceKey ?? `${record.name}\0${record.category ?? ''}`;
    const prior = deduped.get(key);
    // Locale pages can carry both the English seed and localized server result
    // in separate Flight chunks. Prefer the localized row deterministically.
    if (!prior || (/zh-(?:cn|tw)/i.test(canonical) && /[\u3400-\u9fff]/u.test(record.name) && !/[\u3400-\u9fff]/u.test(prior.name))) deduped.set(key, record);
  }
  const records = [...deduped.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  if (!records.length) throw new Error('快照身份正确，但未找到结构化 Wisp records；不会覆盖现有 raw JSON');
  if (source === 'lolchess' && new Set(records.map(({ name }) => name.toLocaleLowerCase('en'))).size !== records.length) throw new Error('LoLCHESS rendered Wisp list 包含重复名称；不会覆盖现有 raw JSON');
  const declaredRecordCount = source === 'opgg' ? Number(html.match(/(?:all|全部)\s*(\d+)\s*(?:个\s*)?Wisps/i)?.[1] ?? NaN) : null;
  if (source === 'opgg' && !Number.isFinite(declaredRecordCount)) throw new Error('OP.GG 快照未暴露页面声明的 Wisp 总数；不会用硬编码数量替代');
  if (declaredRecordCount !== null && records.length !== declaredRecordCount) throw new Error(`OP.GG 页面声明 ${declaredRecordCount} 条，但解析得到 ${records.length} 条；不会覆盖现有 raw JSON`);
  const updatedText = html.match(/(?:Updated|更新(?:日期|時間)?)[：:\s]*([A-Za-z]+\s+\d{1,2},\s+\d{4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/i)?.[1] ?? null;
  return { sourceUrl: canonical, pageUpdatedAt: updatedText, declaredRecordCount, records, sha256: createHash('sha256').update(html).digest('hex') };
}
