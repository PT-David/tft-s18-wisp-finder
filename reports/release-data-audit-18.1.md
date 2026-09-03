# Patch 18.1 Release Data Audit

## Executive verdict

**NOT READY — CORPUS COMPLETENESS UNRESOLVED; TARGETED HUMAN REVIEW REQUIRED** Current productionReady: **false**; recommendedProductionReady: **false**. This audit does not edit production data.

## Corpus completeness

Committed catalogs: DataTFT 169, CommunityDragon canonical base 163, LoLCHESS 174, OP.GG 200. Confirmed OP.GG/production intersection: 172; conservative confirmed minimum: 176; exact size: **unresolved**. Catalog count is not corpus membership.

## Source freshness

Every source is identified in `data/source_manifest_18.1.json` by sourceId, exact URL, locale, retrieval/upstream time, SHA-256, tier, and useFor. The audit uses committed snapshots only; it does not promote a live page. See `sourceInventory` in the machine report.

## Identity blockers

- 28 OP.GG candidate groups (21 ambiguous), with a complete evidence/action queue in `identity.reviewQueue`.
- 2 DataTFT unmatched row; 1 client-confirmed but unlinked identities. These sets may overlap and are not added together as missing records.
- 17 production rows lack riotId; none was guessed. Client corpus membership without a proven production target recommends `insufficient_evidence`, never `same_identity`.

## Critical field conflicts

- Category 0; cost 1; stage range 0.
- Blossom presence 13; Prismatic identity/field 2. Mitosis Upgrade remains representation evidence, not automatic Blossom evidence.
- Requirements presence 28, structured 0, semantic review 64; merged unique manual-review identities 64. appearanceCondition is requirement evidence only, never membership evidence.

## Provenance

Dangling source references: 0; manifest-confidence mismatches: 0; incompatible locale references: 19; incompatible useFor references: 20; stale PBE overrides found: 0. Schema validity reuses `scripts/validation.ts#validateDataset`; CI still requires the full `validate:data` gate. Confidence distribution is recorded field-by-field in the machine report.

## Unknown knowledge

Once-per-game: {"confirmedTrue":2,"confirmedFalse":0,"unknown":174,"legacyTrue":0,"legacyFalse":0}. Reoffer cooldown: {"confirmedNumber":0,"confirmedNull":0,"unknown":176,"legacyNumber":0,"legacyNull":0}. minimumAffordableGold: {"nonNull":0,"null":0,"absent":176,"independentlySourced":0}. Unknown is preserved rather than converted to false/null.

## Accepted uncertainties

The 174 once-per-game and 176 cooldown unknown states are accepted unknowns, not blockers by themselves.

## Release blockers

Release state: **NOT READY — CORPUS COMPLETENESS UNRESOLVED; TARGETED HUMAN REVIEW REQUIRED**. Accounting uses separate units: corpus-completeness groups 1; identity blocker groups 3; identity review items 31; Requirement unique review identities 64; other field conflict items 16; deduplicated critical-field review identities 70; provenance items 39. No mixed-unit total is reported.

Readiness is the conjunction of the explicit `releaseCriteria`: proven corpus boundary; empty OP.GG identity, DataTFT unmatched, client-confirmed-unlinked, deduplicated critical-field, provenance, and stale-PBE queues; and successful required-schema validation.

## Human review queue

Use `identity.reviewQueue` and `criticalFieldReviewQueue` in `release-readiness-18.1.json`. C4.1 does not execute review actions. Existing detailed field queues remain in `data-lolchess-field-audit-18.1.json`, `data-prismatic-audit-18.1.json`, and `data-manual-review-18.1.json`.

## Release / dependency follow-up

`npm audit --json` was attempted on 2026-09-01, but the registry audit endpoint returned HTTP 403. No `npm audit fix --force` or dependency upgrade was performed; advisory/package/path details could not be freshly verified in this environment.

## Recommended next step

C4.2 priority 1: resolve identity queue and prove corpus boundary; priority 2: adjudicate Blossom/Prismatic/Requirements and numeric conflicts; priority 3: apply reviewed corrections; priority 4: rebuild derived C2 artifacts only after approved production changes.
