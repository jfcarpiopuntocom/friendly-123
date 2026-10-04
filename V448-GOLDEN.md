# v448 GOLDEN release policy

v448 is the frozen public release family for friendly-123.

- Public/health/Sonar shell: `f123-shell-v448`.
- Service Worker cache invalidation is independent: increment `CACHE_GENERACION` in `docs/sw.js` (`-golden1`, `-golden2`, ...).
- Do not create v449/v450/etc. merely for v448 hotfixes.
- A hotfix may change code only after the golden QA gates pass; it must not rewrite customer records as a release side effect.
- Channels remain: `estable` = clients, `master` = `/next/` canary, `previo` = emergency rollback.
- The public shell and `docs/version.json` / `docs/version-manifest.json` must remain aligned at v448 unless JFC explicitly starts a new release family.

This note is outside `docs/` intentionally: it documents the release policy without changing the app shell.

## Current tested generation

- `golden2` — shelf-photo recovery hotfix: never destroys a shelf's last local photo merely because the current content-hash blob is still in flight; service-worker generation is now checked independently of the frozen public v448 identity.
- Verified before promotion: 521/521 regression tests, targeted shelf-photo recovery, WebKit/iPhone photo smoke, lifecycle/stock/undo gates, manifest hashes and service-worker integrity.

## Golden3 shelf-photo recovery

- Production hotfix commit: `293a3d1de6c409edc28fc9dfc313decdac24fc53`.
- Public release remains `f123-shell-v448` / `v448 GOLDEN`; internal CacheStorage generation is `golden3`.
- Rendering an active shelf must never delete photo evidence merely because `fotoHash` is null, `fotoRev` exists, IndexedDB is unavailable, or the hash blob is still in flight.
- Exact per-shelf ID bytes may self-heal their own pointer; no matching by name/order and no guessed associations.
- Legacy localStorage shelf photos remain a read fallback when IndexedDB is empty/blocked or an old migration was partial.


## G05 photo-history recovery

- Public release remains v448 GOLDEN.
- Stable hotfix generation: golden5.
- Exact historical shelf ID -> fotoHash mappings may be recovered from local y-indexeddb by read-only replay into an isolated Y.Doc.
- Automatic restore requires the exact historical shelf ID and surviving exact hash bytes.
- Ambiguous orphan blobs remain in Photo Recovery Vault for explicit owner confirmation.
- Prime Directive 1AAA remains absolute: preserve > cleanup; no storage clearing or destructive migration during recovery.


## Prime Directive 1AAA — G06 photo recovery
- Never delete photo bytes as a side effect of render, sync, repair, merge, migration, archive, shelf deletion, or release hotfix.
- Recovery order: exact same-shelf current evidence -> exact local Yjs history -> same-shelf per-ID evidence -> manual visual restore from the complete preserved-photo Vault.
- The Recovery Vault inventories every photo blob still physically preserved on-device, even when stale/archived state still references it.
- Manual Restore is copy-only: copy preserved bytes to the selected shelf and set that shelf pointer; retain the source evidence.
- Public release remains v448 GOLDEN. G06 uses internal CacheStorage generation golden6.

## Current stable photo recovery

- G07 (`7d27b9b`) was fast-tracked to `estable` after confirming its complete Git tree is identical to the QA-passed PR #315 head (`117398a`).
- `previo` is G06 (`3906c015`) for immediate rollback.
- G07 fixes the storage cache-miss fallback, preserves legacy sources copy-only, unions photo evidence across stores, and keeps recovery logic behind a pure hexagonal core.

## G08 shelf-photo hotfix

- The Photo Recovery Vault is diagnostic-only; it must never appear in normal My Shelves.
- Product-photo blobs are never shelf-recovery candidates merely because they are preserved.
- Exact shelf recovery may use current/Yjs mappings, Yjs history, checksummed local checkpoints, and same-shelf per-ID bytes.
- Public release remains v448 GOLDEN; G08 uses internal CacheStorage generation golden8.


## G09 — late Yjs photo-history refresh

- Root cause fixed: an early empty `historialFotosPorPercha()` result could remain cached for the entire session even after Yjs delivered exact shelf-photo evidence.
- `oc-fotos-actualizadas` now invalidates derived photo-history/checkpoint caches before repainting Shelves.
- Regression test reproduces: first render blank → Yjs history hydrates → photo event → exact shelf photo reappears and pointer is reattached.
- Verified: 548/548 full regression plus WebKit/iPhone, photo durability, lifecycle, stock, undo, commissions, Sync/Yjs, manifest/SW and diff hygiene.
- Public identity remains **v448 GOLDEN**; internal CacheStorage generation is **golden9**.
