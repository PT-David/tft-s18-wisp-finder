# TFT 18.1 Wisp data audit

- Snapshot: 2026-08-28T16:49:16Z.
- Corpus status: DataTFT has 169 committed rows; OP.GG human review observed 200, but this environment received HTTP 403 and therefore has no record-level OP.GG identities. The observed 31-row difference remains individually unclassified (F: insufficient evidence).
- CommunityDragon: 345 variants (163 base-shaped, 163 Upgrade-shaped, 19 Prismatic-shaped; naming shapes may overlap). Exact localized-name intersection: 152.
- Normalized remains 169: it is the only committed complete record-level skeleton, not because completeness is proven. No OP.GG-only row was automatically included or excluded.
- Riot/client ID coverage: 152/169; Chinese-name coverage: 169/169. The 17 fallback Chinese names now cite DataTFT, not CommunityDragon.
- Blossom: 130; Mitosis is null because its client Upgrade text is not distinct. Prismatic: DataTFT 20, CommunityDragon 19, LoLCHESS human observation 11; record-level LoLCHESS identities are still required.
- oncePerGame and reofferCooldownShops are explicit unknown knowledge states for all production rows. minimumAffordableGold is omitted rather than inferred from cost.
- Blocking unresolved conflicts: 6; unmatched entries: 29.
- **Production ready: no.** Human/browser exports are still required for the OP.GG-only identities and LoLCHESS fields (name, category, stages, Blossom presence, Prismatic presence, requirements, once-per-game and cooldown).
