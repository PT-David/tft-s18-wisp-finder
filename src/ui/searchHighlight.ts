import type { Wisp } from '../domain/types';
import type { SearchFieldPath, SearchHit, SearchMatch } from '../search/searchEngine';
import { readSearchField } from './searchMatchReason';

export const SEARCH_HIGHLIGHT_NAME = 'wisp-search-match';

interface HighlightRegistry {
  delete(name: string): boolean;
  set(name: string, highlight: Highlight): void;
}

export interface SearchHighlightController {
  readonly supported: boolean;
  clear(): void;
  update(hits: readonly SearchHit[], cardNodes: ReadonlyMap<string, HTMLElement>): void;
}

export interface SearchHighlightDependencies {
  supported?: boolean;
  registry?: HighlightRegistry;
  HighlightCtor?: new (...ranges: AbstractRange[]) => Highlight;
}

export function supportsCustomHighlights(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';
}

/** Resolve only explicitly annotated, single-text-node card fields. */
export function resolveSearchFieldTextNode(card: HTMLElement, fieldPath: SearchFieldPath): Text | undefined {
  if (fieldPath.startsWith('synonyms.')) return undefined;
  const target = [...card.querySelectorAll<HTMLElement>('[data-search-field]')]
    .find((element) => element.dataset.searchField === fieldPath);
  return target?.childNodes.length === 1 && target.firstChild?.nodeType === Node.TEXT_NODE
    ? target.firstChild as Text
    : undefined;
}

export function buildDomRangesForMatch(card: HTMLElement, wisp: Wisp, match: SearchMatch): Range[] {
  if (match.matchType === 'concept' || !match.fieldPath || !match.ranges.length) return [];
  const raw = readSearchField(wisp, match.fieldPath);
  const textNode = resolveSearchFieldTextNode(card, match.fieldPath);
  if (raw === undefined || !textNode || textNode.data !== raw) return [];
  return match.ranges.flatMap(({ start, end }) => {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > textNode.data.length) return [];
    if (textNode.data.slice(start, end) !== raw.slice(start, end)) return [];
    const range = document.createRange();
    range.setStart(textNode, start); range.setEnd(textNode, end);
    return [range];
  });
}

export function createSearchHighlightController(dependencies: SearchHighlightDependencies = {}): SearchHighlightController {
  const supported = dependencies.supported ?? supportsCustomHighlights();
  const registry = dependencies.registry ?? (supported ? CSS.highlights : undefined);
  const HighlightCtor = dependencies.HighlightCtor ?? (supported ? Highlight : undefined);
  const operational = Boolean(supported && registry && HighlightCtor);
  return {
    supported: operational,
    clear(): void { if (operational) registry!.delete(SEARCH_HIGHLIGHT_NAME); },
    update(hits, cardNodes): void {
      if (!operational) return;
      registry!.delete(SEARCH_HIGHLIGHT_NAME);
      const ranges = hits.flatMap((hit) => {
        const card = cardNodes.get(`${hit.wisp.patch}:${hit.wisp.id}`);
        return card ? hit.matches.flatMap((match) => buildDomRangesForMatch(card, hit.wisp, match)) : [];
      });
      if (ranges.length) registry!.set(SEARCH_HIGHLIGHT_NAME, new HighlightCtor!(...ranges));
    },
  };
}
