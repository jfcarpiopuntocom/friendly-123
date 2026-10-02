# Canary State Protocol v2 — Sonar de Canarios

Date: 2026-10-02
Owner: JFC
Status: DESIGN SPEC — concept approved; implementation not started

## Objective

Turn the private **JFC Lord of Software — Sonar de Canarios** into a compact engineering instrument that distinguishes a local hotfix from a structural shell failure before a bad release reaches customers.

Success means:
- healthy canaries are visually quiet and small;
- a local hotfix becomes conspicuous without looking like a dead system;
- a structural failure looks categorically different and blocks promotion;
- stale/unknown telemetry is never confused with healthy;
- the panel renders explicit semantics instead of guessing from `reportes > 0`;
- canary telemetry remains privacy-preserving and never carries business data;
- customers never have to troubleshoot beyond ordinary refresh/re-engage behavior;
- canary code itself cannot break business operation.

## Current problem

Today `docs/panel.html` largely collapses failure into:

```
reportes > 0 -> rojo -> canario-caido.png
```

Every bird is 56×56 px. This conflates:
- local UI defects;
- missing scripts/resources;
- mixed shells;
- stale telemetry;
- global invariants;
- bootstrap/sync/version failures.

A recoverable UI regression should not look like the application kernel died. A shell fault must be impossible to mistake for a routine hotfix.

## Core design principle

**The renderer must be stupid.**

Detection code classifies. The Worker transports/aggregates. The panel renders.

Closed protocol:

```text
healthy | hotfix | shell | stale
```

Unknown values degrade to `stale`, never to healthy.

## Canary State Protocol v2

Conceptual event:

```js
{
  node: "clientes",
  class: "hotfix",
  severity: 2,
  code: "record-payment-hidden",
  shell: "f123-shell-v442",
  channel: "next",
  count: 1,
  firstSeen: 1790964000000,
  lastSeen: 1790964120000,
  blastRadius: "local",
  promotion: "hold"
}
```

Required:
- `node`: fixed known canary id.
- `class`: healthy | hotfix | shell | stale.
- `code`: fixed vocabulary, lowercase, short, no user/business data.
- `shell`: current shell id.
- `count`: bounded integer.
- `lastSeen`: timestamp.

Optional/derived:
- `blastRadius`: local | multi-node | global.
- `promotion`: allow | hold | block.
- `severity`: 0–3, only for sorting inside a class.
- `firstSeen`: incident age.
- `diff`: release metadata produced by CI/server-side, never customer devices.

## State semantics

### HEALTHY

Definition: fresh telemetry and all required local invariants pass.

Visual:
- **37×37 px** bird, roughly 2/3 of current size;
- upright;
- tiny breathing pulse;
- no ring;
- quiet room border.

Promotion: `allow`.

### HOTFIX

Definition: shell/bootstrap/version integrity is healthy, data remains readable, and the fault is isolated to one functional path with a known local repair surface.

Examples:
- debt exists but Customers hides Record a payment;
- isolated UI panel/label behavior is wrong;
- a single feature path is broken while underlying data is intact.

Visual:
- bird expands **37 → 56 px**;
- stays upright;
- amber/orange ring;
- compact HOTFIX chip;
- one HTML5 Pulsar transition;
- details only on hover/tap/focus.

Promotion: `hold` by default, not structural `block`.

### SHELL / STRUCTURAL

Definition: the failure crosses an architectural boundary or invalidates trust in the running shell.

Examples:
- mixed shell/version;
- required script missing;
- bootstrap failure;
- identity/license namespace mismatch;
- sync core failure;
- service-worker contamination;
- global money checksum/invariant failure;
- many rooms failing from a shared dependency.

Visual:
- compact ~37 px bird;
- **patas arriba** with `canario-caido.png`;
- red ring;
- room perimeter red;
- one short drop transition;
- no inflation.

Header: **PROMOTION BLOCKED — SHELL FAULT**

Promotion: `block`.

### STALE / UNKNOWN

Definition: not enough fresh evidence to claim health.

Visual:
- 37 px, upright;
- opacity ~0.4;
- subtle gray/dotted halo;
- last heartbeat age in detail.

Promotion: `hold` when a required lord canary is stale beyond threshold.

## HOTFIX eligibility guard

A problem may be called `hotfix` only when ALL are true:
1. shell/version checks healthy;
2. required resources present;
3. persistence readable;
4. no global monetary invariant failing;
5. behavior isolated to one known domain;
6. local fallback/repair surface exists;
7. blast radius is not global.

Small diff size alone can never downgrade a structural failure to hotfix.

## Patch-size metadata

Patch size is evidence, not classification.

- `MICRO`: <=25 changed lines and <=1 production file.
- `SMALL`: <=80 lines and <=3 production files.
- `LARGE`: >80 lines or >3 files.

Risk-sensitive surfaces automatically elevate blast-radius evidence:
- `sync-yjs.js`;
- `hechos.js`;
- service worker/cache/version routing;
- identity/license/re-engagement;
- Worker heartbeat/license protocol;
- persistence/bootstrap;
- global reconciliation/money code.

Example panel detail:

```text
CUSTOMERS
HOTFIX · MICRO
record-payment-hidden
1 production file · +10/-4
first 13:04 · last 13:07
next only
```

Structural:

```text
VERSION
SHELL
mixed-shell
global blast radius
PROMOTION BLOCKED
```

## HTML5 Pulsar visual language

The Sonar should feel alive, not noisy.

### Healthy pulse
Use transform/opacity only:
- scale 1.00 → 1.035 → 1.00;
- ~3.2s;
- per-canary phase offset;
- opacity variation <=0.08;
- disabled with `prefers-reduced-motion`.

### HOTFIX Pulsar
On the transition into HOTFIX:
1. sprite expands 37 → 56 px with transform scale;
2. two concentric amber rings pulse out;
3. rings fade in ~1.1s;
4. bird remains upright and large;
5. no repeating siren unless a materially new incident arrives.

Conceptual CSS:

```css
.canary[data-state="healthy"] .sprite {
  transform: scale(.66);
  animation: canary-breathe 3.2s ease-in-out infinite;
}

.canary[data-state="hotfix"] .sprite { transform: scale(1); }

.canary[data-state="hotfix"].is-new .pulsar-ring {
  animation: hotfix-pulsar 1.1s ease-out 2;
}

.canary[data-state="shell"] .sprite { transform: scale(.66); }

@media (prefers-reduced-motion: reduce) {
  .canary .sprite, .pulsar-ring { animation: none !important; }
}
```

### Structural drop
When transitioning into SHELL:
- 180–260ms micro-drop/fade;
- swap to `canario-caido.png`;
- then static except for restrained red heartbeat.

No comedy bounce. Structural means serious.

### Vientito
- new HOTFIX: light airflow can orient healthy birds toward affected room;
- SHELL: no whimsical wind; room snaps red and bird falls;
- STALE: no wind.

## Density / control-room UX

Current 56 px healthy birds become ~37 px, freeing room.

Top summary:

```text
12 OK · 1 HOTFIX · 1 SHELL
```

Structural state:

```text
PROMOTION BLOCKED — 1 SHELL FAULT
```

Incident details are progressive disclosure by hover/tap/focus. The Lord should answer in under two seconds:
1. Is the shell trustworthy?
2. Is there a local hotfix?
3. Is promotion allow/hold/block?
4. Which node is affected?
5. Is it new or stale?
6. Is the repair surface micro/small/large?

The bird is an instrument; text corroborates the state.

## State transitions

```text
stale -> healthy
healthy -> hotfix
healthy -> shell
hotfix -> healthy
hotfix -> shell
shell -> healthy
shell -> hotfix   only after structural checks recover
healthy/hotfix/shell -> stale on timeout
```

Animations fire on transitions, not polls. Opening the panel must not fabricate a “new incident.”

## Promotion policy

Keep the existing 33-minute window.

- fresh `shell` on required lord canary => **BLOCK**;
- unresolved `hotfix` => **HOLD**;
- required nodes healthy => existing promotion logic may continue;
- required lord telemetry stale past threshold => **HOLD**;
- client telemetry stays observational and privacy-safe.

Worker summary:

```js
{
  promotion: "block",
  counts: { healthy: 12, hotfix: 1, shell: 1, stale: 0 },
  blockers: ["version:mixed-shell"]
}
```

After compatibility rollout, `promover.yml` should consume explicit promotion state rather than infer everything from one generic red boolean.

Backward compatibility:
- Worker accepts old heartbeat schema;
- old events map conservatively;
- unknown old red signal => shell/stale, never healthy;
- panel renders old + v2 for one migration window.

## Privacy boundary

Canary telemetry contains operational health only.

Never send:
- customer names;
- product names/SKUs;
- amounts;
- emails/phones;
- license secrets;
- free-form business text;
- raw stack data that could carry business values.

Codes come from a fixed vocabulary. Existing sanitization in `canarios.js` remains defense-in-depth.

## Expected implementation surfaces

Primary:
- `docs/salud-app.js`: classify/emit CSP v2.
- Worker endpoint `/canario/estado`: validate, aggregate, summarize.
- `docs/panel.html`: compact birds, Pulsar HTML5, state renderer.
- `.github/workflows/promover.yml`: consume explicit promotion state after compatibility period.

Tests:
- protocol classifier;
- Worker schema/compatibility;
- panel rendering;
- state transitions;
- promotion allow/hold/block;
- visual regression.

Out of scope:
- inventory sync;
- commissions;
- customer ledger;
- license semantics;
- product seeding;
- unrelated UI cleanup.

## TDD acceptance matrix

Tests before production changes:
1. healthy => compact upright;
2. hotfix => expanded upright amber;
3. shell => compact fallen red;
4. stale => dim upright;
5. entering hotfix adds Pulsar class once;
6. repeated same poll does not retrigger;
7. shell blocks promotion;
8. hotfix holds;
9. stale required lord holds;
10. old schema remains readable;
11. unknown class never becomes healthy;
12. reduced-motion preserves status without animation;
13. opening panel with existing incident does not fake a transition;
14. payload rejects business free text;
15. patch metadata cannot downgrade structural fault;
16. risk-sensitive diff elevates blast-radius evidence;
17. several local hotfixes are not automatically shell;
18. shared dependency failure can explain several rooms from one root cause.

## Browser / visual regression

Use Playwright against `/next/` with synthetic/demo state only.

Required cases:
- all healthy;
- one hotfix;
- one shell;
- mixed hotfix + shell;
- stale;
- mobile width;
- reduced-motion.

No real license, real store, or real re-engagement in automated visual tests.

## Engineering references screened

Patterns to borrow, not blindly install:

Progressive delivery:
- argoproj/argo-rollouts
- fluxcd/flagger
- spinnaker/kayenta
- spinnaker/spinnaker
- keptn/lifecycle-toolkit

Feature/state:
- open-feature/js-sdk
- Unleash/unleash
- Flagsmith/flagsmith
- growthbook/growthbook
- thomaspoignant/go-feature-flag

Observability:
- getsentry/sentry
- open-telemetry/opentelemetry-js
- prometheus/prometheus
- grafana/grafana
- SigNoz/signoz
- glitchtip/glitchtip-backend
- GoogleChrome/web-vitals

Browser/performance:
- microsoft/playwright
- grafana/k6

Fault injection:
- litmuschaos/litmus
- chaos-mesh/chaos-mesh
- Shopify/toxiproxy
- resilience4j/resilience4j
- connor4312/cockatiel

State/UI:
- statelyai/xstate
- matthewp/robot
- motiondivision/motion
- juliangarnier/anime
- airbnb/lottie-web

Review/security/tooling:
- reviewdog/reviewdog
- danger/danger-js
- github/codeql-action
- aquasecurity/trivy
- semgrep/semgrep
- eslint/eslint
- prettier/prettier
- sindresorhus/p-retry
- sindresorhus/p-timeout
- mswjs/msw
- sinonjs/fake-timers

Preferred implementation remains native JS + SVG/CSS unless a dependency demonstrably removes more complexity than it adds.

## Failure philosophy

- Fail closed for promotion, not business operation.
- Canary code never mutates business state.
- Monitoring failure => STALE, not SHELL and not HEALTHY.
- Structural signal must have an explainable fixed code.
- A hotfix must prove isolation.
- Every silently-wrong surface deserves a canary, but all canaries obey one protocol.
- If Pulsar animation fails, status text still works.

## Rollout sequence

1. protocol constants + pure classifier tests;
2. Worker validation/aggregation with old-schema support;
3. panel dual-schema support;
4. compact 37 px states + HTML5 Pulsar;
5. explicit promotion summary;
6. workflow consumes CSP v2;
7. synthetic failures on `/next/`;
8. existing 33-minute window;
9. only then promote to customers.

No big-bang migration.

## Safety bar before customers

Before `estable` moves:
- full test suite green;
- syntax checks green;
- visual regression green on `/next/`;
- old/new Worker compatibility verified;
- block/hold/allow proven with fixtures;
- no real business data used;
- manual JFC panel smoke;
- rewind path verified;
- `previo` remains known-good.

The objective is not prettier canaries. It is a release system that becomes harder to misunderstand as friendly-123 grows from a few devices to hundreds.
