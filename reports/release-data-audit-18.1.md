# Patch 18.1 Release Data Audit

## Executive verdict

**NOT READY — CORPUS COMPLETENESS UNRESOLVED; TARGETED HUMAN REVIEW REQUIRED** Current productionReady: **false**; recommendedProductionReady: **false**. This audit does not edit production data.

## Corpus completeness

Committed catalogs: DataTFT 169, CommunityDragon canonical base 163, LoLCHESS 174, OP.GG 200. Confirmed OP.GG/production intersection: 166; conservative confirmed minimum: 174; exact size: **unresolved**. Catalog count is not corpus membership.

## Source freshness

Every source is identified in `data/source_manifest_18.1.json` by sourceId, exact URL, locale, retrieval/upstream time, SHA-256, tier, and useFor. The audit uses committed snapshots only; it does not promote a live page. See `sourceInventory` in the machine report.

## Identity blockers

- 34 OP.GG candidate groups (21 ambiguous), with a complete evidence/action queue in `identity.reviewQueue`.
- 1 DataTFT unmatched row; 6 client-confirmed but unlinked identities. These sets may overlap and are not added together as missing records.
- 17 production rows lack riotId; none was guessed.

## Critical field conflicts

- Category 0; cost 0; stage range 0.
- Blossom presence 13; Prismatic identity/field 2. Mitosis Upgrade remains representation evidence, not automatic Blossom evidence.
- Requirements presence 28, structured 0, semantic review 63. appearanceCondition is requirement evidence only, never membership evidence.

## Provenance

Dangling source references: 0; manifest-confidence mismatches: 0; incompatible locale references: 5; incompatible useFor references: 0; stale PBE overrides found: 0. Confidence distribution is recorded field-by-field in the machine report.

## Unknown knowledge

Once-per-game: {"confirmedTrue":2,"confirmedFalse":0,"unknown":167,"legacyTrue":0,"legacyFalse":0}. Reoffer cooldown: {"confirmedNumber":0,"confirmedNull":0,"unknown":169,"legacyNumber":0,"legacyNull":0}. minimumAffordableGold: {"nonNull":0,"null":0,"absent":169,"independentlySourced":0}. Unknown is preserved rather than converted to false/null.

## Accepted uncertainties

The 167 once-per-game and 169 cooldown unknown states are accepted unknowns, not blockers by themselves.

## Release blockers

Exact corpus boundary, 34 OP.GG identity decisions, the DataTFT/client overlap decision, and record-level critical conflicts listed above remain unresolved. Machine-readable blocker count: 52.

## Human review queue

Use `identity.reviewQueue` in `release-readiness-18.1.json`; allowed recommendations are same_identity, distinct_identity, insufficient_evidence, source_variant, and obsolete_or_non_live_candidate. C4.1 does not execute them. Existing detailed field queues remain in `data-lolchess-field-audit-18.1.json`, `data-prismatic-audit-18.1.json`, and `data-manual-review-18.1.json`.

## Release / dependency follow-up

`npm audit --json` was attempted on 2026-09-01, but the registry audit endpoint returned HTTP 403. No `npm audit fix --force` or dependency upgrade was performed; advisory/package/path details could not be freshly verified in this environment.

## Recommended next step

C4.2 priority 1: resolve identity queue and prove corpus boundary; priority 2: adjudicate Blossom/Prismatic/Requirements and numeric conflicts; priority 3: apply reviewed corrections; priority 4: rebuild derived C2 artifacts only after approved production changes.
