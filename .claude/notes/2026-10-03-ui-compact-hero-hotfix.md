# 2026-10-03 — Today hero compact aesthetic hotfix (NO shell bump)

## Scope

Pure presentation change requested after restoring the known-good morning build and shipping the isolated Record a payment fix.

Hard boundary:
- no business logic changes;
- no data-model changes;
- no sync changes;
- no backend/mock-backend changes;
- no cartera/ledger changes;
- no Commissions changes;
- no service-worker CACHE rename;
- no version.json shell bump;
- no customer-data migration.

The requested design is the **second** visual concept: compact red alert, **no warning icon and no divider**, smaller headline, smaller clock pill, and the existing `How does it work?` immediately below so the recovered vertical space is real.

## Baseline before this aesthetic patch

Production/master source before branch:
- master: `93531d2f207434698a5c8af0669ab21acf7b8494`
- app tree: `fe1b691e8b76a100789b42bab575ab2f32376766`
- shell: `f123-shell-v443`
- `docs/index.html`: 10,379 logical JS/API lines as returned by GitHub content; POSIX `wc -l` = 10,378
- SHA-256: `5ed3ad267a7172a765ba49f32f4f17fe718ff39eeee5dbdab867da4526430841`

## Patch

Branch:
`hotfix/ui-compact-hero-no-shell-2026-10-03`

Runtime files changed:
1. `docs/index.html`
   - hero padding: 11×20 -> 8×16
   - margin-bottom: 8 -> 3
   - headline 18 -> 15 mobile/base, 20 -> 17 tablet, 22 -> 18 desktop
   - headline line-height 1.12 -> 1.08
   - subtitle gains compact line-height 1.15
   - mobile hero changes from stacked flex to 2-column CSS grid so timestamp occupies the right column instead of a third line
   - <=479px fallback lets timestamp move below only when width truly requires it
   - `How does it work?` details margin becomes 0 0 8 instead of -4 0 12
2. `docs/version-manifest.json`
   - ONLY the expected SHA-256 for `./index.html` changes.
   - shell remains `f123-shell-v443`.

Post-patch `docs/index.html`:
- GitHub split-line count: 10,385
- POSIX `wc -l`: 10,384
- SHA-256: `3ec5aa5a1563add6d68d1f9bbdb9d7db090647d1a780dfde89c18c4b1f4b9436`
- git blob: `7d59ea05d48c5b8ac48ee26f2e1f6d392f0cbd6e`

## Regression gate

A separate CI-only fixture measures the hero at 603px and 1200px. It asserts:
- hero <=100 CSS px at 603px;
- hero <=85 CSS px at 1200px;
- gap hero -> How does it work <=8px;
- mobile title <=15.1px;
- desktop title <=18.1px;
- timestamp <=12.1px on the mobile measurement, respecting the existing 12px readability floor;
- no `f123-shell-v444`.

The focused test is isolated outside the release branch. Full suite, deterministic manifest, check-sw, repository guards and diff whitespace checks remain required before promotion.

## Workshop warning

Do NOT cherry-pick EXP002/EXP003/EXP004 wholesale.

Important forensic fact found during this incident:
- EXP002 was cloned from production commit `dd3a0e1819be3b1bbdc88ed700f4f01606a0164a`.
- That is the post-07:00 state quarantined during today's incident.
- EXP003 inherits the EXP002 full-app baseline.
- `exp/vEXP004-navigation-ux` is currently git-identical to `exp/vEXP003-pro-ux` (compare: zero commits, zero file diff).

Therefore any useful workshop idea must be reimplemented as a fresh minimal diff against the known-good production line, never ported as a file/tree.

## Rollback

Because this is presentation-only, rollback is simply reverting the two-file hotfix commit. No data repair is required.
