# friendly-123 — Stable release readiness contract (EGM draft)

**Status:** DRAFT FOR INDEPENDENT REVIEW. **Evidence cut:** 2026-11-07, master `8be4b783971b6b1d49ac67d2884cf031948efe89`, published `shell v692 / golden236`. **No release authorization.**  
**Purpose:** Define how to PROVE the existing approved product works before calling it STABLE. This document changes no requirements, architecture, runtime, PIN, stock, data, or provider. It does not assign the next version number. EGM Goldfish review has **not** been performed.  
**Rule:** Every unproved condition is UNKNOWN or FAIL, never PASS. Green synthetic tests alone never mean customers' devices converge.

## 0. Authoritative inputs and precedence

1. [Approved 31 Oct MDD](../architecture/MDD-2026-10-31-localfirst-pin-ledger-sync.md) and its [Notion decision](https://app.notion.com/p/40a1642b67f381a0a02cf0bfa8b5feac). Binding order: #3 central PIN/identity authority urgently, #1 causal inventory ledger and #5 forensic tests in parallel; #2 encrypted durable mailbox afterward; #4 server-authoritative business model DISCUSSION ONLY. No silent migration or new engine.
2. Current production [version.json](../version.json) / [served live JSON](https://jfcarpiopuntocom.github.io/friendly-123/version.json). CI and production must be checked again at the same release SHA; this evidence cut is not a promise about future state.
3. [Open issue #584](https://github.com/jfcarpiopuntocom/friendly-123/issues/584) (cold-join/Owner), [open issue #621](https://github.com/jfcarpiopuntocom/friendly-123/issues/621) (most recent valid stock count 15 in Opera vs stale 33 in PWA), [draft PR #629](https://github.com/jfcarpiopuntocom/friendly-123/pull/629) (provider-specific checkpoint ACK proof), and [draft #618](https://github.com/jfcarpiopuntocom/friendly-123/pull/618) (Commissions v693, separate change).
4. [EGM README](https://github.com/google/elephant-goldfish-model/blob/main/README.md), [review skill](https://github.com/google/elephant-goldfish-model/blob/main/skills/egm-review/SKILL.md), [drift report skill](https://github.com/google/elephant-goldfish-model/blob/main/skills/egm-drift-report/SKILL.md). EGM adds independent critique of this contract; it never supplies actual physical evidence.
5. Where a proposed gate conflicts with an approved decision, mark **CONFLICT / HUMAN DECISION REQUIRED**; do not silently overwrite the MDD. A later pull request or green job is not by itself a changed product specification.

## 1. Release claim: what STABLE must mean

A license and its currently authorized PIN identify **one business / one notebook** across PC, Safari, Opera and installed iPhone PWA. Each browser/PWA has independent local storage, but receives the same durable causal events. Each device works on its own before any network is required for its local business operation. No user-visible success claims remote durability before a real durable ACK, and no receiver claims convergence before application.

Acceptance must be about events and their causal order, **not** matching one pre-programmed quantity. The valid more recent count of product 009 (15 reported from Opera) must win over stale 33 in the PWA without fabricating deltas or resurrecting the old epoch. Payments, orders, reservations and physical stock movements have distinct identities; partial payments never create a second stock removal. A genuine conflicting physical count without shared genealogy is preserved and reported, not resolved by timestamp.

The product already exists. This is an **acceptance specification**, not permission to redesign screens, rewrite Sync3, change databases, rotate clients' PINs, re-enable an archived relay or import old stock with a fixed quantity.

## 2. Measurable acceptance dimensions (all required)

| Dimension | What is exercised | PASS evidence | Automatic NO-GO |
| --- | --- | --- | --- |
| D1. One-device local truth | On iPhone PWA and Safari separately, sale, manual stock count (+1 / -1), event, refund, expense, photo and partial payment; close/reopen while offline | Local commit receipt, immutable event IDs, final stock and money projections before and after restart, measured UI response; existing goal: confirm a sale in <=2 s without hanging | UI falsely says saved, reload reverts, duplicate sale/stock effect, blank/restarted app, unbounded wait |
| D2. Causal durability and recovery | A fully hydrated synthetic writer creates an encrypted checkpoint; real provider-specific persist-result ACK is observed, then new B cold-joins and applies backlog; reject P2P-only evidence | Same license/business, checkpoint cut and ACK at real provider, Yjs pending parents=0, no partial chunk, no missing data, Owner metadata becomes available before PIN; goal <=10 s for convergence/cold join | Stale 1-day checkpoint, incomplete parents, more:true pages still streaming at deadline, one-layer ACK treated as other-layer proof, unverified old-data purge |
| D3. License, role and PIN | Existing licenses + current authorized PIN/revision, offline return, Safari ↔ PWA, recovery permissions and owner vs other roles | JFC-approved censo, CAS/revision evidence, no plain PIN in logs, no credential reversion, no retry before Owner metadata exists | Silent demo/new business, PIN lockout loop, last passive login overriding authorized rotation, incomplete device census used to mutate clients |
| D4. Physical multi-device convergence and launch | PC → Safari and Opera / installed PWA → PC, two complete A→B→A rounds, with distinct storages; online, airplane/offline, reconnect and restart | Exact same set of event IDs and business ID plus corresponding inventory, money, photos and roles in all replicas; stock count 15 proven after reentry without 33 resurrection; elapsed times from real device measurements and release asset SHA | Synthetic-only GO, unresolved physical #621, background loss, diverging photos or commissions, deployed bytes differ from reviewed SHA |
| D5. Release integrity and rollback | Entire relevant CI, cold-join in **real candidate preview**, canary, manifests, SW/cache/version, install/upgrade from previously published shell and rollback | Every required check SUCCESS at **identical immutable candidate SHA**, verified Pages/preview bytes, new monotonically increasing shell with valid manifests, tested backward compatibility and reversible rollback preserving local queues | Skipped/cancelled/red required job, rewritten same shell without manifest, 'tests pass' on a different SHA, rollback erases queue or credentials |

The existing 42-case / six-gate 4D panel may collect evidence; **its cards are not themselves independent witnesses**. Record an explicit UNKNOWN for unvisited physical cells. Do not use a green badge to bypass required gates.

## 3. Mandatory scenarios and measurement protocol

- **One-device first (P0):** On each installed PWA / Safari / Opera session, capture the operation ID and durable local save before moving to another device. Sale, inventory adjustment, commissions and event changes must remain visible after closing and reopening that same instance, with Sync3 still enabled. This is independent from replication.
- **3-device causal path:** A=PC, B=Safari or Opera, C=installed PWA. From the same authorized license, do two rounds A→B→A. Close A, record one real business operation on B, reopen A. Repeat in reverse, include disconnected B and reconnect. Capture event IDs, epoch IDs, applied cursors, ACK state, prices, stock and money projections, not secrets. All replicas converge as an event set, not merely a matching final number.
- **Stock case #621:** latest legitimate count 15 for product 009 is preserved against older PWA view 33, with a follow-up movement and restart. Do not mutate a customer's actual historical events merely to make this test green. If proof of causal precedence is absent, report CONFLICT not silently choose either.
- **Cold join #584:** new authorized instance starts from no IndexedDB history. On preview using an **existing synthetic license only**, a hydrated writer A establishes a provider-specific checkpoint and a real durable ACK. B then joins and must finish all pages/parents, owner metadata and photos. Track 0/false/null distinctly; never retry Owner PIN while metadata is incomplete. Restore/reload B; repeat with fallback layer change and same-checkpoint dedup within one layer.
- **Physical data categories:** inventory, movement ledger, sales, payments/partial payments, reservations/events, commissions, expenses and photos. Each must have an evidence-backed expected projection. Do not claim a test category passed just because the catalog socket opened.
- **Performance stopwatch:** Start convergence clock at the successful local durable commit on sender; stop only when receiving replica has durably applied that event and renders correct projections. Target <=10s for two A→B→A rounds, separately note cold-join duration. Log percentile and outliers; no retries concealed, no cherry-picked passing lap. UI sale response target <=2s is separate and cannot be inferred from replication latency.
- **Fault conditions:** rejected persist-result, disconnected layer, duplicate and out-of-order frames, checkpoint bigger than advertised capability, partial encrypted chunks, two tabs, local IndexedDB quota/CAS failure, iPhone PWA restart, invalid/missing PIN metadata and actual rollback. **Do not weaken caps** to turn a red into green.

## 4. Known blockers at this document's evidence cut

| ID | Evidence | What remains unproved |
| --- | --- | --- |
| B1 / #584 | [Synthetic cold join on #629 preview](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/42428465218): runtime candidate present; after about 29s 111 encrypted pull pages, 1,221 frames, 2,188 applied Yjs structures, 5 missing parents, Owner metadata absent, checkpoint age >=1 day. FAIL. | Hydrated writer A actually creates new checkpoint in destination provider and obtains durable ACK; new B then hydrates in <=10s. |
| B2 / #621 | Opera latest count 15, PWA saw old 33; synthetic #622 merged tests only. | Two physical rounds prove causal precedence survives restart; **15 is a case-specific fact, not a hard-coded stock rule**. |
| B3 / #629 | Draft candidate scope: provider-specific proof in v1/v2 outbox and ACK metadata. Focused S3/S4 plus synthetic tests pass, preview cold join fails. | End-to-end fix in a hydrated A and B, overall CI and a distinct valid release identity; no merge until demonstrated. |
| B4 / #618 | Commissions v693 draft; independently gated and not a proof of Sync3. | Concurrency and fail-closed commissions acceptance on exact planned release SHA; no version conflict. |
| B5 / shell | Production v692/golden236; repo master `8be4b783971b6b1d49ac67d2884cf031948efe89`. | Complete exact-SHA release gates and production asset verification for a *future* version, not reuse of v692. |

Evidence ages: verify these links and statuses again before any decision. The approved MDD is older than the current shell; its decisions still bind until explicitly superseded.

## 5. Required evidence record (no passwords or customer dumps)

Every claim must link to a stable record with: test ID, scenario and objective, SHA (branch HEAD and intended release), build shell/cache, device+OS+browser/PWA and storage identity **as redacted pseudonyms**, business/license association **as nonreversible pseudonym**, eventId/epochId **as protected hashes where needed**, start and end monotonic duration, local save, server durable ACK, receiver application ACK, expected vs observed projections, screenshot/video or redacted log, operator, independent reviewer and verdict (PASS/FAIL/BLOCKED/UNKNOWN). On real devices, collect only with operator consent and do not upload customer records to GitHub.

A green CI run proves only that its stated test ran against that SHA. An HTTP 200 for version.json proves only which version file was served. Neither proves a physical iOS PWA round. Old screenshots and hard-coded product quantities are incident evidence, never the release authority.

## 6. EGM Elephant–Goldfish review package

**Elephant task:** read this contract, approved MDD, changed-file diff of #629, actual canary logs for #584 and #621, tests, security rules and release-control. Report every clause with its source, what test proves it and whether the evidence already exists; mark undocumented claims UNKNOWN. Do not expand scope, propose new vendors, disable Sync3 or edit customers.

**Goldfish task:** fresh independent agents MUST receive this file and the explicit source links above, not prior conversational conclusions. For EACH stage, record a finding with ID, severity (P0/P1/P2), exact source/file+line, reproduction or counterexample, acceptance consequence and minimally invasive action. Absence of independent agents = **NOT REVIEWED**, never 'passed by EGM'.

Stages from Google's EGM review protocol:
1. **Initial Zoom-Out:** Is the product goal or an authorized alternative missing? Could 'stable' be falsely declared after local-only success?
2. **Comprehension:** Can an unfamiliar tester execute the gates without tribal knowledge, hidden PINs, fixed stock values or guessing?
3. **Design Critique:** Stress-test checkpoint ACK origin, Yjs causality, two layers concurrently open, event ordering, stock epochs, local-first durability and PIN revision races.
4. **Intermediate Zoom-Out:** Detect architectural drift from approved MDD and inadvertent expansion (server authority, duplicate engine, vendor changes, silent data rewrites).
5. **Implementation Readiness:** Map every required gate to executable test + exact candidate SHA + physical witness; resolve every P0 finding or issue NO-GO.

**Review decision record:** OPEN finding / resolved by approved change / explicitly accepted risk (never P0) / rejected with test-based reason. Require independent reviewers to challenge prior diagnoses, including whether checkpoint age is cause or symptom. This draft is not the Goldfish review output.

## 7. Release decision algorithm

`GO` only if ALL conditions hold: (1) MDD unchanged or explicitly reapproved; (2) all active P0s closed with causal and physical evidence, including #584 and #621; (3) EGM independent review completed and P0 findings resolved; (4) local-only correctness and physical A→B→A ×2 passed; (5) preview cold-join real synthetic join passed with real provider ACK, role and photos; (6) all required CI and release-control checks green at **the same immutable SHA**; (7) increasing shell, correct manifests, cache/SW upgrade, rollback rehearsed without data loss; (8) JFC signs off the evidence.

Else `NO-GO`, with named failed or missing gate, its link, owner and next safe experiment. No automatic merge from a review or synthetic suite. A physical tester's inability to run a scenario is UNKNOWN/BLOCKED, not a discretionary PASS. Rollback means restore prior binary while retaining compatible local data and encrypted outbox; never solve by purging clients.

**Current decision: NO-GO.** #629 and #618 remain DRAFT, production v692 remains unchanged.

## 8. Implementation sequence after independent review (not authorization)

1. For #629, prove hydrated synthetic writer A → provider-specific ACK → actual checkpoint cut advancement. Check that a missing parent never authorizes compaction, that a rejected/unknown receipt never certifies the provider, and that outbox v1/v2 migration and rollback preserve provenance.
2. On the same candidate preview, new B runs real cold-join, recovery of Owner and photos, and repeat after restart; diagnose any remaining backlog/age without increasing caps blindly.
3. Complete physical iPhone/PC two-round acceptance, including local sale/adjustment reliability and physical stock #621 without fabricated repair events.
4. Only then schedule a distinct release shell (do not claim v693 is free while #618 reserves it), full exact-SHA gates, canary, rollback and owner approval.
5. EGM drift report and refreshed independent Goldfish review after material code/spec changes; reopen the corresponding acceptance gate rather than preserving a stale approval.

**Non-goals:** install EGM into customer runtime; modify PIN/stock/rooms; change transport providers; implement server-authoritative model #4; reset catalogs; lower safety gates; use reviewers as substitutes for physical tests.
