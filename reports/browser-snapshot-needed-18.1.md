# Stage 18.1 browser snapshots needed

The build environment received source-protection responses, so **do not copy 200 rows by hand** and do not commit saved HTML.

## OP.GG

1. Open `https://op.gg/zh-cn/tft/set/18` (or `https://op.gg/zh-tw/tft/set/18`) in a normal browser.
2. Confirm the page shows **Set 18**, the Wisp category controls, and the full list (the current human observation says 200; this is a sanity check, not a hard-coded acceptance rule).
3. Use **Save Page As → HTML only**, or in DevTools Console run `copy(document.documentElement.outerHTML)` and save the clipboard as UTF-8 HTML.
4. Put it at `artifacts/import/opgg-set18.html` (the directory is ignored).
5. Run `npm run data:import:opgg -- artifacts/import/opgg-set18.html`.
6. The command must report a non-zero record count and create `data/raw/18.1/opgg-wisps-zh.json`; inspect `recordCount`, `url`, and several names/categories before committing.
7. Run `npm run data:build:18.1 && npm run validate:data`.

## LoLCHESS

1. Open `https://lolchess.gg/rewards/set18/wisps?hl=en` in a normal browser.
2. Confirm the heading is the **Set 18 Wisps** table. Do not use another Set 18 table's Updated date.
3. Save **HTML only**, or save `document.documentElement.outerHTML` as UTF-8 to `artifacts/import/lolchess-set18-wisps.html`.
4. Run `npm run data:import:lolchess -- artifacts/import/lolchess-set18-wisps.html`.
5. The command must create `data/raw/18.1/lolchess-wisps.json` with non-zero `recordCount`; verify Mitosis is present and its Blossom field is absent/null.
6. `pageUpdatedAt` is populated only when the saved Wisps page body itself contains an Updated label. An external index observation is not substituted.
7. Run `npm run data:build:18.1 && npm run validate:data`.

The importer validates each canonical source URL, hashes the saved HTML, writes only a minimal JSON extraction, and fails without overwriting when no structured Wisp records are found. If either website changes its serialization, provide the ignored HTML so the source-specific parser can be adjusted without fabricating data.
