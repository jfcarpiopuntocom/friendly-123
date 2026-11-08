# friendly-123 · Stable readiness contract (Elephant–Goldfish)

**Status:** DRAFT / NOT CERTIFIED / NO-GO. **Kind:** acceptance specification, not a runtime implementation authorization. **Baseline verified:** master \`8be4b783971b6b1d49ac67d2884cf031948efe89\`, shell \`v692\` / \`golden236\`, 2026-11-07. **Scope:** existing product and approved architecture only; zero new features or transport providers.

> This is the Elephant's independent-review input. It has **not** passed a fresh-context Goldfish review. A green unit test is not a green real device, a receipt is not a transaction commit, and this document is not permission to modify customer credentials or data.

## 0. Decision authority and immutable references

The controlling architectural decision is [MDD-2026-10-31](../architecture/MDD-2026-10-31-localfirst-pin-ledger-sync.md), [approved in Notion](https://app.notion.com/p/40a1642b67f381a0a02cf0bfa8b5feac). Its **binding implementation priority** is **#3 JFC identity/PIN authority URGENT + #1 event-ledger and #5 forensic comparison in parallel → #2 encrypted durable mailbox afterward → #4 authoritative business backend only for later discussion**. That decision is *approved architecture, not completed implementation*. Do not infer stable readiness from it.

Other controlling evidence (must revalidate each HEAD before release):
- [#584](https://github.com/jfcarpiopuntocom/friendly-123/issues/584): cold-join fails before Owner data is usable; Yjs continues replaying encrypted pages; earlier synthetic Firebase checkpoint cut classified \`1d-o-mas\`; no blind PIN retries.
- [#621](https://github.com/jfcarpiopuntocom/friendly-123/issues/621): owner's **newer valid physical count is 15 in Opera**, PWA 33 is an older observation. No invented -18 movement; use lineage / event identity, not timestamps or UI count.
- [#629](https://github.com/jfcarpiopuntocom/friendly-123/pull/629): draft candidate for per-provider checkpoint ACK provenance. Synthetic RED→GREEN does **not** certify recovery; its [candidate-preview real cold-join](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/42428465218) still failed after ~30s (2,188 Yjs structures applied, five parents missing, Owner metadata absent). Not merged; release/manifest gate red.
- [#618](https://github.com/jfcarpiopuntocom/friendly-123/pull/618): separate DRAFT v693 Commissions candidate, not permission to reuse identity v693 for an unrelated runtime fix.
- [EGM feature specification standard](https://github.com/google/elephant-goldfish-model/blob/main/resources/document_standards/feature-spec-standard.md) and [implementation-readiness standard](https://github.com/google/elephant-goldfish-model/blob/main/resources/document_standards/implementation-readiness-standard.md). EGM is an independent design-review method, **not** a runtime test tool or release authority.

## 1. Problem, objective and non-goals

**Product acceptance question:** Can an authorized person sell or adjust stock on PC/Safari/another iPhone browser/PWA, close that instance, and later open another authorized instance with the **same business, event history, inventory, money, photos and current authorized Owner access**, automatically and without losing, inventing, duplicating or silently replacing operations?

**Goal:** stable behavior of the existing local-first product; finish the physical A→B→A ×2 verification and release one correctly sealed increasing shell only when every gate has evidence. Desired physical convergence: **<10 seconds** per observed A→B→A transition, measured from strict local ACK to correct remote rendered/applied state. App-load ~3s and sale confirmation <=2s are performance targets to measure, not claims achieved; do not waive functional correctness to meet them.

**Non-goals (prohibited):** redesign Sync3, switch cloud provider, mandate Docker or user installations, replace Yjs with a second stock authority, auto-repair old counts to a fixed number, disable Sync3, purge customer storage, rotate customer PINs without the approved census/CAS process, merge unrelated PRs together, or automatically accept synthetic tests as iPhone proof. No generic "rebuild", new database, extra caps, or invented migration.

## 2. Invariants (violating any one is a blocking P0)

| ID | Required guarantee | Negative evidence that must fail the gate |
| --- | --- | --- |
| INV-01 Identity | One license maps to exactly one active business/notebook; browser and PWA have distinct replica identities, never silent Demo or alternate notebook. | Different notebook/business, cross-license contamination. |
| INV-02 Local-first | A sale, count, customer or event **really commits to local durable storage before Saved/Confirmed UI**; local use still works when transport is unavailable. | False saved banner, page resets, hanging action, hidden abort. |
| INV-03 Causal stock | Stable event IDs, hashes, epochs and causal ancestry; no reseeding of obsolete 33 above valid newer 15. A non-comparable COUNT remains an explicit conflict, not an invented delta. | Old count resurrects, negative invented correction, physical decrement on partial payment. |
| INV-04 Replay | Cold-join applies every necessary encrypted causal parent or remains visibly recovering/NO-GO; resume/restart is idempotent. | Missing Yjs parents silently marked complete; new device sees fake Owner or wrong money. |
| INV-05 ACK boundaries | Distinguish local IndexedDB commit; network send; durable relay ACK; target replica applied/visible. None substitutes for another. | Peer receipt treated as server durability; UI celebrates while outbox pending. |
| INV-06 Checkpoint | Only fully hydrated, dependency-free, cursor-proven state may compact. A proven ACK is **provider scoped**; Supabase proof alone cannot certify Firebase, unknown ACK cannot certify either, same-provider confirmed state may dedup. | Checkpoint omits causal fragments, provider switch loses history, stale cut presented as complete. |
| INV-07 Finance | ORDER/reservation, physical FULFILL and money (cash, transfer, credit, installment, commission) are distinct; retries/idempotence cannot double-sell or double-charge. | Credit payment triggers second physical departure; duplicate event or incorrect totals. |
| INV-08 Photos | Photo identities and references survive sync, reopen, backup and cold-join without swapping licenses. | Orphan/corrupt photo or unintended duplicate. |
| INV-09 PIN | JFC's authenticated, **authorized** revision wins; last passive login or stale snapshot does not rotate PIN. Census first; no PIN cleartext in evidence; no repeated auto-attempts. | Lockout/reversion, unauthorized change, PIN leaked. |
| INV-10 Release identity | Exact source SHA, generated manifests, SW/caches, version and published bytes agree; new runtime gets increasing shell identity, staged/rollback path. | Dirty manifest, mixed shell assets, CI from different SHA, rollback erases local state. |

## 3. The four evidence dimensions (4D) and matrix

D1 **single-device correctness**: sale, adjust, event, customer, photos and money must work on one browser independently, including save/reopen, while Sync3 remains enabled. D2 **causal/durable**: provenance of opId/epoch, ACK, cursor, checkpoint and Yjs completeness, cold-join. D3 **physical convergence**: PC ↔ Safari/Opera/PWA, same license/business, two full A→B→A rounds. D4 **release/rollback**: all integration CI exact SHA, signed artifact identity, live published byte check and fail-closed rollback.

Use **42 case observations = 6 stages × 7 domains**, not 42 checkmarks inferred from CI:
- Stages: (S1) A baseline/local action; (S2) B joins/reconnects; (S3) B makes own sale/count; (S4) A receives B; (S5) second complete A→B→A round; (S6) close/reopen/cold-join and offline-to-online recovery.
- Domains: (1) physical inventory+events, (2) sales/events/customers, (3) money/commissions/credit, (4) photos, (5) access/PIN/roles, (6) persistence/restart/backup, (7) time and replica convergence.
- Per case: PASS/FAIL/NOT-RUN, exact URL/SHA/shell, device/browser/PWA, local timestamp and elapsed ms, redacted evidence link, opId/epoch **hash or synthetic ID only**, ACK phase, observed before/after, reviewer and defect link. **NOT-RUN, unavailable logs and FAIL are NO-GO**. Do not put license, PIN, room, customer, photo, ciphertext or personal data in CI logs or public evidence.

The standalone 4D dashboard can manage the evidence, but it is an **operator ledger, never the authority that proves a test happened**. The dashboard does not turn a status green without a fresh, grounded artifact; all exported observations must be checked against their source.

## 4. Acceptance gates and reproducible protocols

| Gate | Protocol (all must be demonstrated) | Evidence to attach | Initial state |
| --- | --- | --- | --- |
| G0 Baseline/scope | Inventory production SHA and currently served version; record all open PRs; compare to approved MDD and no-change-scope. | GitHub SHA and \`docs/version.json\`, served \`version.json\`, changed files | OPEN |
| G1 Local device | With sync enabled, sell and adjust both directions; event/credit and photo; fail an IDB write and verify truthful UI; close/reopen; no surprise refresh. | Browser/video redacted, local transaction IDs + commit traces, persistence comparison | NOT CERTIFIED |
| G2 Causal recovery | Cold-join from genuinely empty local store to same business; catalog, photos, Owner revision and money complete; pending parents=0; no auto PIN retries; outage/rejoin and old checkpoint. | \`recorrido\` canary exact SHA, bounded progress, checkpoint cut, causal hashes | **FAIL #584** |
| G3 Stock newest valid fact | Reproduce 33 older / 15 newer as **ordered causal facts**, preserve arbitrary-count variation, close/reopen and both orderings; no synthetic correction. | #621 op/epoch proofs and two physical devices, never fixed-amount substitution | **FAIL / physical unverified #621** |
| G4 Cross-browser | Same license + authorized PIN PC→Safari/PWA→PC twice; reverse operation from B; verify full 7 domains after both rounds; each transition target <10s; offline replay and cold-join. | 42 signed case records, exact latency, before/after hashes and actual photos/transactions | NOT-RUN |
| G5 Durability + permissions | Verified old→new provider checkpoint ACK, same-provider dedup, v1/v2 migration and fail-closed negative ACK; no data loss, no PIN reversion, role check. | S3/S4 exact-SHA tests, provider-side checkpoint cut before/after, separate G2 actual recovery | Partial synthetic ONLY |
| G6 Full CI / binary identity | Run \`p0-hotfix-gate\`, \`release-control\`, \`qa-v448-g07-hex-photo\`, \`p0-s3-compressed-checkpoint\`, \`p0-s4-outbox-per-op\`, \`recorrido\`, money, stock, photos and PIN workflows on **one final candidate SHA**; no unexplained failing, skipped or cancelled blocking job. Seal a **new increasing version**, regenerate/check manifest and SW, verify served bytes. | CI permalinks, commit/manifest digest, release proof, exact deployed asset hashes | NOT-RUN for final candidate |
| G7 Safe rollout & rollback | Explicit canary/small scope, backup integrity, recovery of prior local journal, no schema downgrade or PIN loss; monitor and abort on causal divergence, unsaved state, quota exhaustion or lockout. | Rollout/rollback rehearsal (synthetic then authorized pilot), GO signer, live health | NOT-RUN |

**G2/G3/G4 failure cannot be waived** by more unit tests or PR merges. An unmeasured threshold is not a pass. Before accepting a provider checkpoint fix, test a **fully hydrated synthetic writer A** creating a new checkpoint with actual durable ACK on the target layer, then **new B** cold-joining from that layer; a cold B cannot legally create a checkpoint from incomplete history. Re-run physical cases after the final release SHA—not a different preview SHA.

## 5. Alternatives reviewed and why they are not a release shortcut

1. **Keep the approved local-first identity/ledger/forensics sequence.** This is the controlling design ([MDD](../architecture/MDD-2026-10-31-localfirst-pin-ledger-sync.md)). Strength: preserves offline operation and customer data, allows causal diagnosis. Cost: hard recovery and identity edge cases; acceptance must be physical.
2. **Force a stock snapshot or choose newest arrival by wall clock. REJECT.** Destroys event ancestry and risks reintroducing 33 or manufacturing -18. Violates INV-03 and #621.
3. **Disable Sync3/P2P or overwrite the store to clear the backlog. REJECT.** Breaks cross-device guarantee and risks losing acknowledged local business data.
4. **Increase checkpoint quota / replay caps without proving the failing boundary. REJECT.** Can trade a missing parent for runaway memory/egress; does not certify durable ACK.
5. **Replace sync with new authoritative business backend. OUT OF SCOPE.** MDD option #4 is for discussion only; requires new architecture, custody, migration and costs approval.
6. **Merge #629 or #618 because targeted CI is green. REJECT AS GO CRITERION.** #629 preview cold-join failed; v693 is already reserved by #618; changed runtime must be sealed and revalidated. Future separate change may be considered after root cause and tests.

## 6. Exact responsibility boundaries / implementation safety

This document and [Goldfish review packet](EGM-GOLDFISH-REVIEW.md) are **documentation-only**. They must never mutate \`docs/sync-yjs.js\`, \`docs/relay-selector.js\`, \`docs/firebase-relay.js\`, \`docs/mock-backend.js\`, PIN/authority backend, real outboxes, checkpoints, licensed accounts, data or production. PRs #618/#629 retain ownership of their own changes; do not seal or merge them in an acceptance-docs PR.

Any future implementation ticket must specify *exact* allowed files, changed function contracts, test files, RED baseline, GREEN full suite, migration/backout and customer risk under EGM's **zero-decision implementation-readiness standard**; an engineer may not improvise a provider/schema/authority choice. No implementation authorization is conveyed here.

## 7. GO/NO-GO and ongoing drift

- **GO =** G0..G7 all supported by direct evidence for *the exact final runtime SHA* **AND** Goldfish design review resolved **AND** explicit authorized release signoff. Record reviewer, timestamp, SHA, customer-safe rollout and rollback proof.
- **NO-GO =** any failed, skipped without explicit evidence-based disposition, unexecuted or incompatible case; checkpoint still aged with pending parents; 15→33 resurrection; incomplete Owner; unstable sales; broken full-shell manifest; any ambiguous client-data mutation.
- Current decision: **NO-GO**. Keeping v692 while evaluating fixes does not imply v692 is certified stable.
- After every runtime PR/release, run an EGM **drift report** comparing MDD, this acceptance contract, current production code and executed tests. Record divergences, never silently edit approved product scope.

## 8. Review and provenance

The EGM Goldfish process must use **fresh, separate reviewer contexts** with only this document and its cited sources. This drafting session cannot self-certify independence; until actual independent reviewers return findings, the review status is **NOT-RUN**. Review protocol and structured findings: [EGM-GOLDFISH-REVIEW.md](EGM-GOLDFISH-REVIEW.md). No amount of written specification proves live device behavior.

Owner decision fields (to fill after review, not beforehand): \`design-review=<NOT-RUN>\`, \`release-signer=<UNASSIGNED>\`, \`stable-candidate-sha=<NONE>\`, \`physical-evidence=<NONE>\`, \`go=no\`.
