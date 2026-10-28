# P0 stock epoch ABA — forensic gate (2026-10-28)

Status: OPEN / LAB ONLY. Applies to PR #452; do not merge, publish, reset or reconcile a customer's notebook from this document.

## Cornell — question, evidence, conclusion

**Question:** can two *different physical stock baselines* both numerically equal to 5 be safely merged?

**Evidence:** `docs/sync-yjs.js` writes witness keys as `[productId, numericStockBase, actor, add, sub]`, and `incorporarTestigosStock` groups facts by `String(stockBase)`. This does not carry an identity for a physical epoch. A historic stockBase=5 and a newly counted stockBase=5 cannot be distinguished merely by their number. The existing different-base regression (2 vs 11) cannot catch this ABA case.

**Conclusion:** neither a timestamp nor the winning whole-product Y.Map value proves epoch identity. Automatic reconciliation across ambiguous physical resets is NOT authorized. Treat these as conflicting evidence; do not overwrite either local notebook.

## ADR — decision and alternatives

Decision: FAIL CLOSED at the ambiguous-epoch boundary; do not invent summed stock or silently discard prior facts. No production migrations, format changes or pruning as part of this research step.

Candidates to evaluate *in a separate, fully tested change*: (A) explicit immutable per-recount epoch ID generated at the local atomic physical reset, transmitted with movement witnesses; (B) append-only inventory movement log with explicit recount barriers and stable movement IDs; (C) manual reconciliation of legacy ambiguous resets. An epoch identity must be persisted before publication and preserved by import/export, reload, relay, offline transactions and legacy readers. Using timestamp or stockBase alone is rejected.

## RED reproduction contract — synthetic ONLY

1. Peer A and B initialize the same product and physical epoch E1 with `stockBase=5`.
2. A records +3 in E1; exchange to B and verify both read 8.
3. A performs a *legitimate new physical recount* starting epoch E2 also with `stockBase=5`, while B holds E1 history offline; A records -1 in E2.
4. Reconnect both orders and replay twice. Verify E1 +3 does **not** silently contaminate E2; verify E2 -1 does not erase E1 evidence. If E2 cannot be identified unambiguously by the format, test must assert explicit ambiguity and no automatic resolution.
5. Repeat with same actor/device identity, opposite order, reload, and a third peer. Export both independently and check each epoch's movement IDs and receipt IDs are preserved.
6. Add a mixed-shell test using *full* pinned v606/v607 snapshots (not just bridge script), without real customer data.
7. Check a single new stock movement does not iterate historic witnesses after warmup; track witness-map full visits and receiver-store work separately. Check memory/relay growth over repeated synthetic movements, not just 1k products with a short history.

### Acceptance / release gate

- Demonstrate RED before implementation, GREEN on identical fixture after implementation, with smallest targeted tests; keep the failure visible.
- Verify atomic local persistence, no duplicate sale or monetary event, no lost receipt/photo/PIN/name.
- Compare both independently exported device ledgers before *any* live reconciliation. Never transplant one over the other.
- Final release-control must have a new unique shell identity, exact manifest hashes, and a final targeted review; a later production deployment requires separate explicit approval.
- Until physical bidirectional PC-phone verification, PR #452 remains DRAFT and NOT STABLE.

Evidence: RED https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/40769149337 ; hot-path GREEN https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/40769279062 ; PR https://github.com/jfcarpiopuntocom/friendly-123/pull/452 .


## 2026-10-28 continuation — physical acceptance runbook (read-only evidence first)

The initial analysis and alternatives above are the **pre-implementation historical baseline**, not a description of the now-current candidate: PR #452 now carries explicit epoch-scoped Yjs witnesses, backend physical epoch barriers, focused RED→GREEN demonstrations and a **read-only** inventory checksum. The candidate is NOT deployed, merged, or verified against real PC and phone.

### Cornell: observed vs inferred

**Observed on an already-open user PC tab, read-only:** installed shell v607; UI reported `Sync: NOT connected`, `Sync pending`, no verified visible-delivery receipts, plus an offline label. An automatic local checkpoint warning was present while a separate browser-wide quota estimate was very low (~3%). These indicate *missing evidence of actual peer delivery* and *a failed localStorage snapshot*, not proof of a full browser quota or physical stock loss. No customer license, names, PIN, email, business totals or inventory rows should be copied into this PR or external logs.

**Code-grounded explanation:** `docs/avanzado-extra.js` stores full local checkpoints in `localStorage` (small independent per-origin limit), unlike the global `navigator.storage.estimate()` output, so both observations can coexist. `docs/peer-sync.js` uses direct peer WebRTC signaling; a public HTTP 200 from the Cloudflare `/health` endpoint does not prove that the app's WebSocket, peer, historical replay, ACK or render confirmation succeeded.

**Conclusion:** keep network delivery, physical stock, and persistent backups as independent gates. Passing encrypted Yjs synthetic tests cannot establish that the real phone has received any new stock.

### ADR: safe test sequence, no live mutations yet

1. No cache purges, service-worker resets, import/overwrite, shell switches, auto-recount, legacy PN relabel, new room activation or origin changes while live data is unbacked.
2. Obtain **independent full manual backups** from PC and phone, preferably stored in separate safe locations. Confirm readable file structure and cryptographic checksums *offline*, never upload private business data to a public PR/CI.
3. Record separately each device's displayed shell/build identity and direct transport state (connected, pending, recovery cut, durable ACK and peer-view receipt), without putting room IDs, licenses, PINs or ciphertext in public logs.
4. In an approved **private isolated canary** with intact copies, compare each complete local product ledger: product ID, physical stock, deficit, stockBase, stockEpochId and per-actor PN counters, and separately compare sale receipt IDs; preserve counts 11 and 2 as independent evidence rather than choosing either as authoritative.
5. Only for a **fully witnessed common epoch** should a targeted movement be made and tested both directions, with peer acknowledgement, reload persistence, no duplicated money/receipt and a third-peer stale replay. If epochs are missing or conflict, stop at explicit ambiguity and human physical reconciliation; do not invent a stock reset.
6. The new `OCSync.huellaInventario()` emits `existencias` and `movimientos` SHA-256 digests for local-side comparison with `certificado:false` **by design**. Matching metadata `OCSync.huella()` does not compare stock; matching two local hashes alone is also **not** a durable network ACK or a physical recount.
7. Any release requires the normal **new increasing shell identity** and exact SHA release gate on the finalized candidate, plus explicit authorization. Do not bypass the failing release-control job to push to `master` or production.

### Directed verification already completed (synthetic, no customer data)

- Three independent peers with one physical epoch converge to base 5 +3 −2 = 6 after late join and replay. Two incompatible physical epochs preserve 5 and 9 independently, never fabricate 14: https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/40780476911.
- A metadata fingerprint matching across devices was demonstrated to be compatible with physical inventories **11 vs 2**. Read-only SHA-256 physical checksums distinguish them and refuse invalid PN arithmetic. Latest focused run: https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/40781141264.
- A previously always-false watchdog equality compared a short string from micelio with the object returned by `OCSync.huella()`; fixed to compare matching types and ignore missing/stale heartbeats. Unicode UTF-8 split across 200 KiB peer-snapshot chunks was reproduced and corrected without increasing packet size. Candidate checks: https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/40781989806.
- The team UI copy is corrected to distinguish catalog metadata and heartbeat freshness from actual inventory equality; the checkpoint notice now explains the localStorage-versus-global-quota distinction, without modifying data or backup rotation.
- Current lab HEAD when this runbook was amended: `78248f5e7a901a0db14c7beaacf10dfd31de4033`. Forensic https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/40782899940, v602 https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/40782907592, and E1-E6 https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/40782907601 are GREEN. Release-control https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/40782907630 is RED because new runtime must not reuse an old shell identity.

**Remaining non-negotiable blocker:** no independently verified real PC–phone durable delivery and stock/receipt parity. PR #452 remains DRAFT / LAB ONLY / NOT STABLE.
