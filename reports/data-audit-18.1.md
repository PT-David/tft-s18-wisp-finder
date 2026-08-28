# TFT 18.1 Wisp data audit

- Snapshot: 2026-08-28T16:49:16Z.
- Corpus definition: all live-patch Wisps that can actually be offered in a normal or rules-authorized Wisp slot. Upgrade/Prismatic variants, inactive/internal records, and aliases are not separate entries.
- Corpus status: DataTFT has 169 committed rows; OP.GG human review observed 200, but normal GETs to the zh-cn/zh-tw/en Set 18 pages received HTTP 403 at this environment tunnel and therefore have no record-level identities. The observed 31-row difference remains individually unclassified (F: insufficient evidence).
- CommunityDragon: 345 variants (163 base-shaped, 163 Upgrade-shaped, 19 Prismatic-shaped). Exact localized-name intersection: 152. The 163/169/200 counts reflect client base-shaped records, DataTFT displayed rows, and an OP.GG aggregate observation respectively; only record-level activation evidence can resolve their policy differences.
- Normalized remains 169: it is the only committed complete record-level skeleton, not because completeness is proven. No production records were added or removed in this pass.
- Riot/client ID coverage: 152/169; Chinese-name coverage: 169/169. The 17 fallback Chinese names cite DataTFT, not CommunityDragon.
- Blossom: 130; Mitosis is null because its client Upgrade text is not distinct. Prismatic: DataTFT 20, CommunityDragon 19, LoLCHESS human observation 11; record-level LoLCHESS identities are still required.
- LoLCHESS pageUpdatedAt remains null. 2026-08-26 is retained only as a public-index observation; it is not substituted for a date from page body.
- oncePerGame and reofferCooldownShops remain explicit unknown knowledge states; minimumAffordableGold remains omitted. Requirements remain DataTFT-sourced until LoLCHESS rows can be compared.
- Blocking unresolved conflicts: 6; unmatched entries: 29.
- **Production ready: no.** Use the source-specific browser import commands documented in reports/browser-snapshot-needed-18.1.md, then rebuild offline.
