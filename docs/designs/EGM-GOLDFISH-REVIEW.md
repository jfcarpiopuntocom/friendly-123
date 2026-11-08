# Goldfish protocol · friendly-123 stable acceptance

**Review state: NOT RUN.** This is a handoff packet for the real [Elephant–Goldfish Model](https://github.com/google/elephant-goldfish-model), not a report claiming independent agents have already examined the system.

## Input contract for fresh reviewers

You are a NEW reviewer with **no prior discussion context**. Read, in this order:
1. [Stable readiness acceptance spec](FRIENDLY123-STABLE-EGM.md) (complete).
2. [Binding MDD architecture](../architecture/MDD-2026-10-31-localfirst-pin-ledger-sync.md) (complete), including #3 + #1/#5 → #2 → #4 only discussion.
3. Current actual implementation and minimal changed-file boundaries:
   - \`docs/sync-yjs.js\`
   - \`docs/relay-selector.js\`
   - \`docs/firebase-relay.js\`
   - \`docs/mock-backend.js\`
   - \`scripts/canario-union-fria.cjs\`
   - \`test/p0-s3-size-audit.test.cjs\`, \`test/p0-s4-outbox-per-op.test.cjs\`, \`test/yjs-durable-outbox.test.js\`
   - \`.github/workflows/recorrido.yml\`, \`.github/workflows/p0-hotfix-gate.yml\`, \`.github/workflows/release-control.yml\`
4. Current GitHub issues [#584](https://github.com/jfcarpiopuntocom/friendly-123/issues/584), [#621](https://github.com/jfcarpiopuntocom/friendly-123/issues/621) and DRAFT PRs [#629](https://github.com/jfcarpiopuntocom/friendly-123/pull/629), [#618](https://github.com/jfcarpiopuntocom/friendly-123/pull/618), with exact HEAD/date verified during your review.
5. [EGM Feature standard](https://github.com/google/elephant-goldfish-model/blob/main/resources/document_standards/feature-spec-standard.md) and [Implementation readiness standard](https://github.com/google/elephant-goldfish-model/blob/main/resources/document_standards/implementation-readiness-standard.md).

**Limits:** do not use this conversation's prior analysis, an agent's claimed Green, or linked PR prose as proof of correct runtime. Compare source, test, executed logs and device evidence. You may review code READ-ONLY. Never open or expose PIN, room, license, account or ciphertext; never mutate customer data. Do not merge or release.

## Goldfish stages, each in genuinely independent context

| Stage | Assignment | Blocking finding examples | Output |
| --- | --- | --- | --- |
| GF-1 Comprehension | Explain approved architecture, why 15 is latest and 33 obsolete, what each ACK actually proves, and what it means to publish stable. | Misinterprets newer fact as larger value, assumes global snapshot authority, conflates provider with license. | 10-sentence model + ambiguities. |
| GF-2 Antagonistic design | Attempt to falsify invariants INV-01..10, including crash/reconnect, same iPhone storage split, 2 parallel sales, checkpoint provider switch and stale PIN. | Fake ACK, lost fragments, double movement on payment, lockout, business crossover. | P0/P1/P2 findings with reproducer. |
| GF-3 Codebase auditor | Check every assertion against source and **actual exact-SHA CI**, especially #629's \`persistLayer\` vs \`relaySource\`, checkpoint migration v1/v2, provider capacities and cold-join no-PIN-reties. | MDD contradicts source, hidden second writer, test lacks production path, unsealed release. | Path:line + test/CI link per finding. |
| GF-4 Implementation readiness | Is **each proposed implementation PR** zero-decision (files, function contracts, migration, tests, rollback), without accidental new scope? The acceptance document is NOT an implementation plan. | Reviewer forced to pick provider, schema, authority, error rules or version number. | READY / NOT READY for individual PR, never blanket approval. |
| GF-5 Structural and signoff | Reconcile contradictions, ensure every gate has verifiable evidence, all blockers remain red until tested and source SHA matches deployed byte proof. | Test-only PR marked production repaired, physical boxes inferred, rerun hides an initial red. | GO/NO-GO recommendation with full evidence matrix. |

### Hard adversarial cases (must be checked even if unit CI is green)

- A stays offline; B makes an authorized sale; A later reopens with an obsolete count. Does the ledger converge without replacing B's event?
- On same iPhone, Opera writes 15 after PWA had shown 33. Can any re-seed publish the old 33 as a new authoritative epoch? If so, identify exact call chain.
- Two authorized browsers share one license but distinct IndexedDB and PWA stores. Can the renderer falsely display the same catalog while durable eventId sets differ?
- Supabase ACKs checkpoint C, then Firebase becomes active. Does \`hacerCkpt\` reoffer C when needed? Does the ACK identify **which socket** persisted it? What happens with two open layers and two separate ACKs?
- A checkpoint was accepted before the final relevant Yjs parent arrived. Can B read the cut as valid and never request that parent?
- A browser receives a remote sale but its local IDB write aborts. Which replica should ACK? What does the UI say, and can the event be replayed exactly once?
- A partial payment updates cash; it must **not** create a second FULFILL or stock decrement. Concurrent tabs should be idempotent.
- A stale PIN revision arrives after the authorized JFC rotation. Does it overwrite credentials or cause silent Demo/owner session loss?
- A photo exists in the old device but not in B; do catalog metadata and photo blob have different ACK/retention paths?
- New runtime is built with old service worker or manifest. Is the actual served checksum detected, and can deployment roll back without erasing journals?
- B cold-joins while Yjs has missing parents. Does \`recuperando\` remain true, and does B refrain from creating a fraudulent new checkpoint?
- A writer A is fully hydrated and the new provider accepts a checkpoint. Is an actual **durable ACK** available and does B then recover within the physical timing target?

## Finding template (one per material item)

\`\`\`text
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
\`\`\`

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
