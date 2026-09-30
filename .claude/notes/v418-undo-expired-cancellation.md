# v418 — undo of a cancelled sale after product expiry

PR scope: local GitHub Pages shell only. No Cloudflare, relay, loader, or workflow changes.

- `POST /api/ventas/:id/deshacer-cancelacion` restores a recent ex-post cancellation as one compensating sale linked by `restauracionDe`. The original cancellation remains monotonic for sync. Original date, price, cost, tax, split, customer, and info are copied; `/venta` still rejects expired perishables.
- Only the authenticated owner/admin/employee may use it, within 30 seconds of `/cancelar`. A deterministic restoration ID and a duplicate check prevent repeated stock and revenue movements. It rejects insufficient stock, paid partner sales, unrelated voids, and missing products.
- `canceladaExPostEn` and `restauracionDe` travel with the existing sale sync and backup fields. The existing five-second toast calls this endpoint by original sale ID.
- Regression tests cover expired goods, exact accounting fields, duplicate requests, unrelated voids, and replaying sync into a second device.
- Shell `f123-shell-v418` with regenerated manifest; public `v1.0` stays fixed.

Pre-edit local copies and hashes: `/tmp/f123-v418-backup/SHA256-LINES.txt` (scratch developer backup). Prior published ref: merge `37733c2` (v417).

Release caution: `master` publishes `/next/`; the existing promotion workflow moves to `estable` after its canary window. Check the live canary and root, and do not describe absent device telemetry as successful field validation.
