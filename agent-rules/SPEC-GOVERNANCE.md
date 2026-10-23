# SPEC GOVERNANCE — INDEX, NOT A NEW PRODUCT SPEC

Read at the start of every agent session. Canonical cross-project method: https://app.notion.com/p/4021642b67f381179e2ff62b1c2f7cc8

1. Read enabled Notion Skills (notion_get_enabled_skills when connected), canonical skill, latest owner prompts, current product baseline, Buzón/reservations and repository HEAD. If unavailable, report missing context, do not invent specs.
2. friendly-123 baseline: https://app.notion.com/p/4011642b67f38177b1c9cc5b00dcf734 — E1–E6 only, plus JFC-approved S1. Product specs/UI/architecture FROZEN; no redesign or new feature.
3. A bug is a reproduced violation of an existing acceptance criterion. A spec change is new behavior needing explicit JFC authorization. Audits, IDE completions and bot ideas are not approvals: PARK them.
4. Hotfix: link existing requirement → failure evidence → smallest safe diff → focused red/green → independent review → acceptance → STOP. WIP at most 2, respect file reservations. Never change customer data.
5. Distinguish DECIDED / IMPLEMENTED / VERIFIED IN LAB / PUBLISHED / VALIDATED ON DEVICES / STABLE; every claim needs evidence and an exact source. Avoid mass tests as reassurance; one final integrated gate on frozen SHA.
6. For planning: brief pre-mortem, problem tree, PERT/critical path, adversarial review, Definition of Ready, Definition of Done and short AAR. Sources: ISO/IEC/IEEE 29148:2018, NASA configuration management, IIBA BABOK, Scrum Guide, ISO 25010:2023.
7. Official friendly-123 public URL: https://jfcarpiopuntocom.github.io/friendly-123/ . Latest connected-active sync target 2–3 seconds, not historic 150ms; no loss of integrity. Client devices own their data; relay is not client-data cloud. Never use TinyFish.

This document is a startup index only. Canonical Notion specs and owner decisions supersede it; documentation-only changes are not permission for new runtime shells.
