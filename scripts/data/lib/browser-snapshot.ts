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
  return payloads;
}

export function parseBrowserSnapshot(source: BrowserSource, html: string): { sourceUrl: string; pageUpdatedAt: string | null; records: ImportedWisp[]; sha256: string } {
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
  const records = [...new Map(found.map((record) => [record.sourceKey ?? `${record.name}\0${record.category ?? ''}`, record])).values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  if (!records.length) throw new Error('快照身份正确，但未找到结构化 Wisp records；不会覆盖现有 raw JSON');
  const updatedText = html.match(/(?:Updated|更新(?:日期|時間)?)[：:\s]*([A-Za-z]+\s+\d{1,2},\s+\d{4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/i)?.[1] ?? null;
  return { sourceUrl: canonical, pageUpdatedAt: updatedText, records, sha256: createHash('sha256').update(html).digest('hex') };
}
