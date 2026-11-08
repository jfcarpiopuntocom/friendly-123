# Goldfish protocol · friendly-123 stable acceptance

**Review state: NOT RUN.** This is a handoff packet for the real [Elephant–Goldfish Model](https://github.com/google/elephant-goldfish-model), not a report claiming independent agents have already examined the system.

## Input contract for fresh reviewers

You are a NEW reviewer with **no prior discussion context**. Read, in this order:
1. [Stable readiness acceptance spec](FRIENDLY123-STABLE-EGM.md) (complete).
2. [Binding MDD architecture](../architecture/MDD-2026-10-31-localfirst-pin-ledger-sync.md) (complete), including #3 + #1/#5 → #2 → #4 only discussion.
3. Current actual implementation and minimal changed-file boundaries:
   - `docs/sync-yjs.js`
   - `docs/relay-selector.js`
   - `docs/firebase-relay.js`
   - `docs/mock-backend.js`
   - `scripts/canario-union-fria.cjs`
   - `test/p0-s3-size-audit.test.cjs`, `test/p0-s4-outbox-per-op.test.cjs`, `test/yjs-durable-outbox.test.js`
   - `.github/workflows/recorrido.yml`, `.github/workflows/p0-hotfix-gate.yml`, `.github/workflows/release-control.yml`
4. Current GitHub issues [#584](https://github.com/jfcarpiopuntocom/friendly-123/issues/584), [#621](https://github.com/jfcarpiopuntocom/friendly-123/issues/621) and DRAFT PRs [#629](https://github.com/jfcarpiopuntocom/friendly-123/pull/629), [#618](https://github.com/jfcarpiopuntocom/friendly-123/pull/618), with exact HEAD/date verified during your review.
5. [EGM Feature standard](https://github.com/google/elephant-goldfish-model/blob/main/resources/document_standards/feature-spec-standard.md) and [Implementation readiness standard](https://github.com/google/elephant-goldfish-model/blob/main/resources/document_standards/implementation-readiness-standard.md).

**Limits:** do not use this conversation's prior analysis, an agent's claimed Green, or linked PR prose as proof of correct runtime. Compare source, test, executed logs and device evidence. You may review code READ-ONLY. Never open or expose PIN, room, license, account or ciphertext; never mutate customer data. Do not merge or release.

## Goldfish stages, each in genuinely independent context

These are the **five original EGM review stages**, not release permissions. Each must be run in a fresh, isolated reviewer context with this packet and its cited materials only. **Current execution state: NOT RUN.** No engineer or reviewer may substitute the current drafting session for Goldfish.

| Stage | Assignment | Blocking finding examples | Output |
| --- | --- | --- | --- |
| GF-1 Initial Zoom Out | Assess whether the acceptance contract matches the approved MDD, product problem, scope and genuine alternatives; identify architecture assumptions without prior-chat context. | Treats a new cloud/backend as authorized, equates a snapshot with a causal ledger, or misses the single-device requirement. | External framing, decision trade-offs and open assumptions. |
| GF-2 Comprehension | Restate the approved architecture, meaning of the newer 15 versus older 33, separate ACK boundaries, and exact definition of STABLE in reviewer-owned words. | Confuses newest causal fact with highest quantity, PIN authority with browser arrival order, or a sent message with durable persistence. | Independent system model and list of ambiguities. |
| GF-3 Design Critique | Challenge invariants INV-01..10 using adversarial replication, offline retries, IDB aborts, provider switching, cold-join, partial payment and identity scenarios. | Missing Yjs parents certified as complete, obsolete count re-seed, duplicate stock departure, false durable ACK or PIN lockout. | P0/P1/P2 reproducible findings with paths/tests. |
| GF-4 Intermediate Zoom Out | Reassess the overall plan after concrete critique: are the acceptance gates sufficient, contradictory, overfitted to synthetic tests or silently introducing new scope? | An unknown physical test classified as PASS, same license mapped to two notebooks, release constraints changed to work around a failure. | Revised risk map, unresolved trade-offs and gaps. |
| GF-5 Implementation Readiness | Apply the upstream **zero-decision** standard separately to every proposed implementation PR: exact files, contracts, migrations, regressions and rollback, without selecting a provider or changing MDD. | Reviewer must invent an API/schema, ambiguous ACK ownership, unspecified backout, version identity collision with #618. | READY / NOT READY per bounded implementation PR, never blanket launch approval. |

### SUPPLEMENTAL friendly-123 code audit (outside the five EGM stages)

A distinct code/CI auditor compares **actual exact-SHA** runtime source and executed logs: `docs/sync-yjs.js`, `docs/relay-selector.js`, `docs/firebase-relay.js`, the outbox v1/v2 tests, `persistLayer` versus `relaySource`, checkpoints and Owner/PIN. Every finding must cite `path:line` and a run URL; a green regression without a real browser/physical proof remains partial evidence. **This is local Ponytail QA, not an extra EGM phase.**

### SUPPLEMENTAL friendly-123 release signoff (outside the five EGM stages)

Only the authorized human release owner can resolve remaining architecture trade-offs and issue a GO after **G0–G7**, all 42 physical observations, two actual PC→Safari/PWA→PC rounds, complete real cold-join, exact published SHA/manifest/SW and rollback proof. A reviewer may recommend; a Goldfish may not certify physical execution or merge/publish automatically.

### Hard adversarial cases (must be checked even if unit CI is green)

- A stays offline; B makes an authorized sale; A later reopens with an obsolete count. Does the ledger converge without replacing B's event?
- On same iPhone, Opera writes 15 after PWA had shown 33. Can any re-seed publish the old 33 as a new authoritative epoch? If so, identify exact call chain.
- Two authorized browsers share one license but distinct IndexedDB and PWA stores. Can the renderer falsely display the same catalog while durable eventId sets differ?
- Supabase ACKs checkpoint C, then Firebase becomes active. Does `hacerCkpt` reoffer C when needed? Does the ACK identify **which socket** persisted it? What happens with two open layers and two separate ACKs?
- A checkpoint was accepted before the final relevant Yjs parent arrived. Can B read the cut as valid and never request that parent?
- A browser receives a remote sale but its local IDB write aborts. Which replica should ACK? What does the UI say, and can the event be replayed exactly once?
- A partial payment updates cash; it must **not** create a second FULFILL or stock decrement. Concurrent tabs should be idempotent.
- A stale PIN revision arrives after the authorized JFC rotation. Does it overwrite credentials or cause silent Demo/owner session loss?
- A photo exists in the old device but not in B; do catalog metadata and photo blob have different ACK/retention paths?
- New runtime is built with old service worker or manifest. Is the actual served checksum detected, and can deployment roll back without erasing journals?
- B cold-joins while Yjs has missing parents. Does `recuperando` remain true, and does B refrain from creating a fraudulent new checkpoint?
- A writer A is fully hydrated and the new provider accepts a checkpoint. Is an actual **durable ACK** available and does B then recover within the physical timing target?

## Finding template (one per material item)

```text
Reviewer (fresh session identifier):
Stage:
Source snapshot: source SHA / PR HEAD / timestamp / executed workflow run:
Finding ID:
Severity: P0 blocker | P1 | P2 | informational
Claim being challenged: INV-xx / Gx / design paragraph
Observed evidence: path:line and/or run URL + exact test result
Counterexample: input/causal sequence/expected-vs-actual
Does existing test cover the full physical scenario? YES/NO/UNKNOWN
Missing information (never assume):
Smallest allowed fix or clarification:
Regression and rollback evidence required:
Disposition: OPEN | ACCEPTED+ASSIGNED | REJECTED-WITH-SOURCE
```

**Stop rule:** Missing references, independently unverified SHA, red/cancelled release CI, source drift, or incomplete real-world checks force **NO-GO**. Do not silently "accept risk" for loss of events/stock/money or PIN, and do not declare a Goldfish review completed unless isolated fresh reviewer contexts really ran.

## Human resolution and authority

Only JFC or explicitly delegated release authority chooses architecture changes, dismisses a finding with source evidence, or authorizes production release. A Goldfish can recommend, not approve. Proposed fixes require a **new narrowly scoped PR** with red-green execution, exact SHA and preservation of this MDD; no automatic code change from a design review.

## Evidence ledger — initial status (not a test report)

| Gate | Review evidence | Decision |
| --- | --- | --- |
| G0 | MDD and v692 SHA recorded, revalidate current master | partial |
| G1 | Single-device physical transaction/reopen proof | NOT RUN / incomplete |
| G2 | [#584](https://github.com/jfcarpiopuntocom/friendly-123/issues/584), [preview #629 cold-join FAIL](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/42428465218) | **FAIL** |
| G3 | [#621](https://github.com/jfcarpiopuntocom/friendly-123/issues/621): latest valid 15 vs old 33; no real device repair proof | **FAIL / UNVERIFIED** |
| G4 | PC↔Safari/PWA A→B→A ×2, 42 cases and elapsed times | NOT RUN |
| G5 | #629 S3/S4 synthetic proof, no warm-writer→cold-reader end-to-end proof | PARTIAL |
| G6 | #629 changed runtime not sealed; #618 reserves v693; live release candidate absent | **FAIL / NOT RUN** |
| G7 | Rollback plus pilot canary evidence | NOT RUN |
| Independent GF stages | No fresh reviewer sessions executed by this document's author | **NOT RUN** |

**Required final output:** findings, a proposed revision to the acceptance spec (no new scope), exact open blockers, candidate SHA if one exists, implementation-ready PR boundaries where applicable, and a justified **GO/NO-GO**. A clever narrative is not evidence.
