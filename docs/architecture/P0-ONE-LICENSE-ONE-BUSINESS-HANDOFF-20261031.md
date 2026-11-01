# friendly-123 · ONE LICENSE = ONE BUSINESS · P0 handoff (2026-10-31)

> Public, sanitized engineering continuity note. No customer records, device identifiers, PIN values, secrets or private backup hashes. Authoritative owner decisions and incident testimony remain in restricted Notion.

## Owner-approved major design decision

**Acceptance:** A license + currently authorized PIN opens the same business with the same data and derived physical stock across PC, Safari, any browser, and installed PWA. Every browser profile/PWA is an independent replica; none has special precedence as the "real" shop. It may recover over an encrypted durable transport when peers are offline. Prioritize a useful state within seconds; if recovery is partial, show incomplete coverage, not a final count or empty demo notebook.

1. **#3 IMMEDIATE**: master JFC license/PIN/device/role authority. First inventory what existing paying customers use, no resets. Then coordinated stage/activate of an authorized revision with CAS, audit and recovery. PIN can rotate only on explicit authority; login cannot rotate it. Visible pencil actions, mobile responsive controls.
2. **#1 plus #5 PARALLEL**: immutable append-only physical inventory event journal with causal count/reset and local-replica independent forensic evidence. Separate order, money, reservation and physical delivery. Dedupe exact operation ID with payload collision quarantine; no synthetic movements, timestamp winner or forced stock value. Preserve original backups and photos.
3. **#2 AFTER #1/#3/#5**: E2EE durable mailbox only if existing authorized transport cannot supply guarantees. Measure quotas/cost first. NEVER keep two contradictory relays or saturate provider Free tiers.
4. **#4 DISCUSSION ONLY**: centralized business DB authorization/migration not approved.

Any increment to the shell must represent a substantive tested improvement, pass final release-control and be verified on physical devices; never ship repeated candidates to disguise unverified regressions.

## Reproduced root class of inventory divergence

Two screens can display the same number while retaining independent physical count epochs. If B next performs a valid operation, re-merging their Yjs product snapshots can show different stock. Equality of a snapshot is *not* equivalent to equality of causal event histories.

Current source `docs/sync-yjs.js` already has `opsDoc.getMap("eventos")` and a separate Yjs encrypted event channel. Current `docs/mock-backend.js` **neutralizes remote operation deltas by default**, marking each opId as seen. A legacy toggle activates older mutation code that may create a sale with a *new* ID; activating it while the existing Yjs catalog also carries stock and sales risks double counting. A local applied-ID list evicts after 2000 IDs. **Never enable legacy writer or force a common stock count in production.**

Use `lab/stock-journal/engine.cjs` as the isolated immutable reference and `test/p0-journal-aba-physical-convergence.test.cjs` as the A→B→A contract. Shadow mode is not a production repair.

For a verified count, `COUNT` must reference the causal frontier and superseded counts. Two concurrent independently generated counts remain conflicting even when their amounts agree. The authorized physical business projection ultimately must be derived solely from accepted events and preserve evidence of rejected/ambiguous events.

## Existing release work and exact evidence

- [#526](https://github.com/jfcarpiopuntocom/friendly-123/pull/526) preserves both incompatible physical-epoch witness sets and continues Yjs catalog publication rather than aborting. `stockConciliacionPendiente` prevents incorrectly certifying a provisional count/value.
- [#527](https://github.com/jfcarpiopuntocom/friendly-123/pull/527) **DRAFT, NO DEPLOY** integrates #526 and introduces:
  - `/pin/resolve` on official licensing Worker only for a centrally activated Owner revision; rate limits from Cloudflare connecting IP plus per-license Durable Object checks. A valid PIN alone cannot mark a notebook recovered.
  - `docs/auth-ui.js` binds Owner verification to active business license, not a possibly unrelated owned-device sidecar. `needs-recovery` blocks entry until durable local adoption; preserves existing PINs during census.
  - responsive header and dashboard name font with exact yellow `#EFC31A` and `.12em #000` outline. CSS source and shipped bundles both changed.
  - read-only comparison `scripts/p0-compare-replicas.cjs`, `--private-local` option for detailed local differences, SHA-256 of the original independent backup files, no original modifications or network access. CI uses synthetic data only.
  - a shadow immutable ledger test: starting from common causal OPEN snapshot, move in phone, replay to PC, close/reopen both, move again in PC, replay to phone and verify equality, without a hardcoded target quantity.
- [CI #41267068838](https://github.com/jfcarpiopuntocom/friendly-123/actions/runs/41267068838): owner PIN, Yjs epochs, read-only forensics, immutable causal replay and Chromium/WebKit responsive CSS steps passed. **The final metadata/hash step failed `error: Could not access 'HEAD^'` due shallow GitHub checkout**, not a business-test failure. Tool safety checks blocked the requested workflow change; report red as red.
- [Issue #515](https://github.com/jfcarpiopuntocom/friendly-123/issues/515): actual end-user acceptance outstanding. Not yet verified: two genuine independent PC/iPhone backups, exact opId history, PIN active revision for the license, new clean browser, all finances/photos, A→B→A physical restart, checksum of live deployed assets. No production database, customer PINs, worker configuration or device data were modified by #527.

## Operational release gate

1. Read current Notion MDD, v633 incident, daily diary, `AGENTS.md`, source tree and exact SHA.
2. Secure **independent, full, unreplaced local backups** from PC, Safari, independent PWA; SHA-256. Keep them private, NEVER upload to public GitHub/CI.
3. In read-only mode, compare products, sales, physical movements, counts, epochs, identities, causal event IDs and colliding payloads. Reconcile by witnessed original events, once each. Never declare physical stock 7 merely because a screen once showed 7.
4. Verify central license registry and Owner PIN census *before* activating a new revision; verify access of the oldest and newest legitimate devices and first-join browser without auto-created demo data.
5. Test physical A→B→A with one peer closed, sale/adjustment/return, restart, encrypted backfill and last movements, including two independent browsers on a single phone. Require congruent operation set and derived stock, plus photos/money/fiados/part-payments.
6. Exercise three replicas, outages, reordering, duplicates, stale service workers and old release clients without creating second stock writer. Measure p95 startup, final receipt, recovery bytes/quotas.
7. Run full CI and strict release gate on frozen commit SHA. Generate app bundles/SW/version/manifest through the approved build pipeline, never edit published metadata ad hoc. Publish a single increasing shell only after passing the real acceptance gate.

## External services, confidentiality, continuity

Historical Cloudflare data relay had an 8000-operation protective limit and was archived. The approved current transport is native Supabase; a legacy Cloudflare-looking client URL may be a LOCAL room locator resolved by `supabase-relay/gateway.mjs`. Do not infer cause of ongoing divergence from that historical limit alone. Do not compact or purge real event history without a verified checkpoint-replay cut and recovery-tail proof. A health endpoint alone does not prove durability or delivery.

Keep MDD, incident, and daily diary updated with factual steps, CI SHA, red tests, rollbacks and unknowns; link source evidence. This document is the public, secret-free GitHub mirror. A copy to Hugging Face must not be claimed until an authorized write path exists.

**Status:** draft candidate only; no real-store certification or production publication. The outstanding goal is an operating, durable multi-device business app—not an accumulation of candidate PRs.
