# Designs · friendly-123

This directory starts the [Elephant–Goldfish Model](https://github.com/google/elephant-goldfish-model) **reviewable stable-release dossier**, not a runtime implementation or a new product spec.

1. [FRIENDLY123-STABLE-EGM.md](FRIENDLY123-STABLE-EGM.md) — requirements/invariants, 4D 42-case physical matrix, release gates G0–G7, safety and rollback; **DRAFT / NO-GO**.
2. [EGM-GOLDFISH-REVIEW.md](EGM-GOLDFISH-REVIEW.md) — zero-prior-context review packet, adversarial test cases, evidence ledger; **INDEPENDENT REVIEW NOT RUN**.

Binding upstream architecture: [MDD-2026-10-31](../architecture/MDD-2026-10-31-localfirst-pin-ledger-sync.md) and [approved Notion decision](https://app.notion.com/p/40a1642b67f381a0a02cf0bfa8b5feac).

**Use:** Draft → independent Goldfish review → resolve findings with JFC → narrowly scoped RED/GREEN implementation PRs → exact-SHA full CI → physical PC↔iPhone A→B→A ×2 → measured rollback → signed GO. No pass by checklist alone.

Known unresolved: [#584 cold-join](https://github.com/jfcarpiopuntocom/friendly-123/issues/584), [#621 newest physical 15 vs obsolete PWA 33](https://github.com/jfcarpiopuntocom/friendly-123/issues/621); [#629](https://github.com/jfcarpiopuntocom/friendly-123/pull/629) runtime candidate and [#618](https://github.com/jfcarpiopuntocom/friendly-123/pull/618) commissions remain DRAFT.

Only this docs folder is changed in the present PR. Do not infer production rollout.
