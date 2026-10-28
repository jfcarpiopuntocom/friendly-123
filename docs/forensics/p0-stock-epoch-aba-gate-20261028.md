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
