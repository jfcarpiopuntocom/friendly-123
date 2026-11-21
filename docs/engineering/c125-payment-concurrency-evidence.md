# C125 payment concurrency QA evidence (2026-11-21)

Baseline: v0.8.44, master `b6a0dfbfbe312feca131cbd78e73ca9f4263e6ed`.

The prior `Promise.allSettled` test incorrectly expected only one successful HTTP POST. When two tabs read the same durable IndexedDB intent, both may safely send the **same** original `opId`. Exactly-once applies to the economic movement, not the HTTP delivery count.

Deterministic tests now hold the first POST pending after durable intent commit and verify: (1) the second tab reuses the same `opId`; (2) the synthetic backend ledger contains one receipt; (3) an explicitly different rival `opId` is rejected before POST; and (4) the original request finishes after release.

RED `a1ed845`: a test expecting rejection of a valid same-opId retry failed. GREEN `de490714`: all 9 GitHub Actions workflows, including durable-credit-intent, passed.

This change is QA-only. No production payment, cash, stock, synchronization, PIN, or service-worker logic changed. Synthetic QA does not replace physical PC/iPhone acceptance.
