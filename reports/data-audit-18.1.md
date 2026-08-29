# TFT 18.1 Wisp data audit

- Snapshot: 2026-08-28T16:49:16Z; OP.GG retrieved 2026-08-29T04:15:26Z.
- Corpus definition: all live-patch Wisps that can actually be offered in a normal or rules-authorized Wisp slot. Upgrade/Prismatic variants, inactive/internal records, and aliases are not separate entries.
- OP.GG: HTTP 200, SHA-256 dca16121554a06b6f864da3d85e357375e2a4c8fd3e7def55fb7cb1b92e6e5da, 200 parsed rows. Category counts: {"Combat":94,"Misc":30,"Champion":16,"Shop":19,"Risky":21,"GoldXP":14,"Item":6}. This replaces the obsolete blocked observation.
- Reconciliation: 169 OP.GG/DataTFT intersection, 31 OP.GG-only, 0 DataTFT-only. The OP.GG-only rows are individually classified: {"A":11,"B":0,"C":20,"D":0,"E":0,"F":0}. A means a catalogued live-shaped row missing from DataTFT; C means a conditional corpus-policy difference.
- Normalized remains 169, after evidence review rather than a 200-count assumption: the 31 rows are not promoted until their timing and production-required provenance can be established.
- CommunityDragon: 345 variants (163 base, 163 Upgrade, 19 Prismatic); exact localized-name intersection 152.
- Riot/client ID coverage: 152/169; Chinese-name coverage: 169/169.
- Blossom: 130; Mitosis remains null because its client Upgrade text is not distinct. Prismatic: DataTFT 20, CommunityDragon 19, LoLCHESS human observation 11.
- LoLCHESS ordinary GET was attempted once and received HTTP 202 AWS WAF protection; no bypass was attempted. The browser snapshot importer remains the fallback.
- oncePerGame and reofferCooldownShops remain explicit unknown knowledge states; minimumAffordableGold remains omitted.
- **Production ready: no.** The build remains deterministic and offline from committed snapshots.
