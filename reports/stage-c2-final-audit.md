# Stage C2 Final Audit / Closeout

## Audited baseline

- Baseline: `main` at `57cde3dc0ae2c886d6beaee779341bc5515e8e58` (PR #16 merge).
- Scope: C2.1, C2.2A, C2.2B1, C2.2B2, C2.3A and C2.3B data, scripts, runtime,
  UI, unit/E2E tests, CI and documentation.
- Inventory included normalized/draft/decision/materialized/public artifacts; generation,
  decision validation, materialization, publication and runtime validation scripts; domain,
  repository, query, search, Match Reason, highlight and main integration modules; all search
  and browser regressions; and the repository's product/data/search documentation.

## Invariants checked

- Recomputed production totals: 169 records, 289 reviewed assignments, 40 taxonomy definitions,
  10 query groups, 27 approved global aliases, 0 record aliases, 0 unreviewed assignments and
  0 stale decisions.
- All normalized `searchConcepts[]` and `synonyms[]` remain empty. Reviewed fields exist only in
  materialized Wisp data and its byte-identical public publication.
- The legal production chain is normalized → generated draft → manual decisions → materialized
  reviewed artifacts → deterministic public publication → fail-closed runtime loader → search/UI.
  No hard-coded runtime synonym fallback or second production taxonomy/alias source was found.
- Regenerating C2.1 left the manual decision file SHA-256 unchanged at
  `9f67e0754df1b31085d8f9f76555fb3d26761a510401f3f62c190a0a50d8d120`.
- Risky rejected values `D`, `roll`, `妮蔻`, `AP`, `AD`, `AS` and `CC` are absent from global
  expansion aliases. This does not prohibit literal matching of the same characters in source text.
- `health_terms` and `death_terms` have empty `conceptKeys`; runtime does not infer subject-specific
  health or death concepts.
- Search remains longest-phrase aware and AND-based. Per-clause priority remains name exact 1000,
  name prefix 700, name 500, effect 300, requirement 220, synonym 140 and concept 100; one winner is
  selected per clause and concept membership is an exact canonical-key match.
- Every non-empty successful hit has one structured match per clause. `matchedFields` is derived from
  those winners. Direct/expansion matches identify raw fields and validated UTF-16 ranges; concept-only
  matches have no fabricated field or range. NFKC, punctuation, whitespace, combining-mark, surrogate
  pair and raw-slice regressions remain covered.
- Candidate Pool N is built before search; Displayed Results K and target probability are derived after
  search. Match Reason and highlight only consume hits and do not change N, K, scores or probability.
- Match Reason uses safe text nodes, reports actual surfaces or reviewed taxonomy labels, updates cached
  cards and clears with an empty query. Highlighting uses only the fixed `wisp-search-match` CSS Custom
  Highlight registry and structured ranges, with no `<mark>` fallback.
- Browser coverage exercises default/toggle states, query changes and clear, cached reuse, card/patch
  changes, filter-driven results, Finder/Rules navigation, collapsed Prismatic, repeated occurrences,
  multi-clause matches, desktop/mobile wrapping, K/N stability, IME/caret/focus and heading semantics.
  Unsupported controllers are no-ops and the capability-gated label is hidden by main integration.
- CI runs build/audit/generation, manual validation, materialization validation, publication, runtime and
  seed/data validation, unit tests, build, Chromium E2E, then the final clean-diff gate in production order.

## Production behavior smoke

The audited runtime returned: `血量` 29, `重随` 20, `Champion Duplicator` 4, `法强` 4,
`攻击力` 4, `攻速` 9, `真伤` 3, `刷新` 20, `复制器` 4, `弈子转化` 4,
`弈子星级` 19 and `临时装备` 11 results. AND queries returned `重随 金币` 8,
`法强 金币` 1 and `重随 弈子星级` 5. Structured winner types and score buckets
matched the documented hierarchy; the browser smoke additionally verified reasons, highlights and K/N.

## Artifact SHA-256 (before = after regeneration)

| Ownership | Artifact | SHA-256 |
| --- | --- | --- |
| normalized | `data/normalized/wisps_18.1.json` | `a7fdf375bc36f0f164a36912af4ca22c1671ede0ba94ae3e8ce3c8bbdee9abe7` |
| materialized | `search-concepts.json` | `55fc034253c9aac08e2dc012ab647256e84aeab35c669bcb6688184381c1bfc9` |
| materialized | `synonyms.json` | `bd744050151130f9aad6d2fa145bf4010ef0f96c17fcc25d6f6c7b746d3268d4` |
| materialized | `wisps.json` | `477c394b1c8c3a00ee2ef9e203b6cb228704dfedd2542367e4185b8f5dafe4ec` |
| public | `search-concepts.json` | `55fc034253c9aac08e2dc012ab647256e84aeab35c669bcb6688184381c1bfc9` |
| public | `search-synonyms.json` | `bd744050151130f9aad6d2fa145bf4010ef0f96c17fcc25d6f6c7b746d3268d4` |
| public | `wisps.json` | `477c394b1c8c3a00ee2ef9e203b6cb228704dfedd2542367e4185b8f5dafe4ec` |

## Stale references found and cleanup performed

- README still described the reviewed lexicon as future work; it now describes completed ownership and
  links to the closeout evidence.
- SPEC and SEARCH_PIPELINE still said final audit was pending; both now mark Stage C2 complete.
- No callable legacy `BASE_SYNONYMS`, old runtime SearchHit path, manual `matchedFields` truth, `<mark>`
  fallback, production `/tmp` assumption, duplicated production lexicon, or unsafe query-derived range
  implementation was found. No speculative dead-code cleanup or semantic refactor was performed.
- Existing unit and E2E suites already cover the requested invariant and lifecycle branches; no product
  test fixture or product behavior was changed.

## Remaining known limitations

- Record aliases are currently empty and global expansion is intentionally precision-first.
- Concept-only matches have no textual highlight. Invisible `textEn` requirements and record aliases may
  explain a match but have no visible card target to highlight.
- Browsers without CSS Custom Highlight support retain search and Match Reason but hide the toggle.
- Highlight preference is default-off and not persisted.
- Search uses phrase-aware AND clauses; OR and fuzzy matching are not implemented.
- These are documented design choices, not closeout blockers. The project has later roadmap work and is
  not globally complete.

## Blockers

None. No semantic/data inconsistency, competing production source, review gap, result regression or CI
coverage gap was found.

## Final verdict

**PASS WITH MINOR FIXES.** Documentation drift and closeout evidence were corrected without changing
reviewed semantics, taxonomy, decisions, production data, runtime behavior or UI behavior. Stage C2 can
be closed; the next action is to return to the project roadmap and select the next main feature stage.
