# PRIME DIRECTIVE 1AAA — DATA INTEGRITY

**Owner rule (JFC, 2026-10-04): customer data must never be destroyed by an app fix, migration, render, sync repair, cache repair, or AI-authored hotfix.**

This rule outranks cleanup, storage tidiness, deduplication and convenience.

## Non-negotiable rules

1. **Preserve > clean up.** If code is unsure whether data is stale, orphaned, duplicated or disconnected, preserve it.
2. **Migrations are copy-only.** Copy into a new store first. Do not delete the source as part of migration.
3. **Repairs are non-destructive.** Self-heal may recreate indexes, pointers or derived state from exact evidence. It must not erase source evidence.
4. **Sync uses tombstones/versioned state, not physical deletion.** A stale peer must never erase newer client evidence.
5. **Render/UI code is read-only with respect to evidence.** Rendering a view must never delete persisted customer data.
6. **Photos are append-only evidence.** Shelf photo bytes may remain orphaned after a shelf/pointer change. Keep them available for recovery.
7. **No guessing in automatic recovery.** Auto-reconnect only when identity is exact (same record ID, exact content hash, or exact historical pointer). Ambiguous orphaned evidence must be shown for explicit user reassignment.
8. **Explicit delete still preserves recoverability by default.** The visible record may be tombstoned/hidden, while raw evidence remains in the local recovery vault.
9. **Backups include orphan evidence.** Export both record-linked data and content-addressed blobs even when no current pointer references them.
10. **Tests must fail on destructive regressions.** Any new physical delete of customer photo evidence requires an explicit owner decision and a new safety design, not a casual cleanup.

## v448 GOLDEN implementation

- Public release remains **v448 GOLDEN**.
- `idb-fotos.js` is append-only/copy-only for shelf-photo evidence.
- Legacy `f123_foto_percha_*` values are copied, never removed by migration.
- Per-shelf photos are also mirrored by SHA-256 content hash.
- Lost exact pointers can be restored from same-ID evidence or same-ID Yjs history.
- Unmapped hash blobs appear in **Photo Recovery Vault** and require explicit manual reassignment.
- Deleting/archiving a shelf does not physically erase its photo bytes.

If storage pressure ever becomes a real operational problem, solve it with export/archival/owner-visible retention controls. **Do not silently delete.**

## G04 deployment note

G04 was verified with focused recovery tests, WebKit/iPhone smoke, the full regression suite, and shell/manifest gates before promotion. A Pages rebuild after `estable` moves is required because `publicar.yml` intentionally deploys only from `master`; this note also serves as the non-shell rebuild trigger for the G04 stable artifact.

## G05 historical-pointer recovery

- The local Yjs catalog IndexedDB is scanned **read-only** for persisted updates.
- Updates are replayed into an isolated temporary Y.Doc, never the live document.
- A previous photo pointer is eligible for automatic recovery only when the exact same shelf ID historically held that exact hash and the exact hash bytes still survive.
- Yjs compaction is respected: if old evidence is gone, G05 does not infer or guess it.
- The Photo Recovery Vault may label a blob with an exact historical shelf and preselect that shelf for human confirmation; it never overwrites a current valid pointer.
- No storage-clearing, physical deletion, or migration cleanup is part of recovery.
