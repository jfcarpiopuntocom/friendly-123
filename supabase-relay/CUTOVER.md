# Native-only sync: release and verification

The October 16 owner instruction restricts Cloudflare to licensing, excluding
notebook transactions and synchronization. v536 introduced native-only clients;
v537 strengthens interrupted-transfer recovery and release validation.
It does **not** migrate a customer, activate a room, deploy a Worker, or certify
production performance. The separate licensing Worker remains unchanged.

## Prepared client behavior

- App, Yjs and dashboard require `F123Relay`. An absent adapter schedules the
  existing retry; it cannot create a raw Cloudflare WebSocket.
- The gateway opens native Supabase only when `f123_relay_route` returns
  `supabase`. A `legacy` result closes with `native migration pending; local
  data retained`. Unknown routes and lookup errors also close without fallback.
- The existing four-channel activation check remains. **Active flags are not
  evidence of a verified history import**; operators must establish that before
  activating a group. This release does not set those flags.
- Old `workers.dev/sala/` strings are local room locators accepted by the
  gateway, not network destinations. No customer room/key derivation changes.
- Local state, durable outbox IDs/ciphertext and recovery cursors are retained.
  Reopening a connection cannot clear pending writes; a durable ACK is required.
- Native transport marks live broadcasts and pulled history on local events;
  the encrypted wire format is unchanged. Their fragment assemblies are separate.
  An abandoned live fragment cannot block durable recovery. An incomplete pulled
  update cannot advance the applied recovery cut or authorize compaction; a
  reconnect replays from that proven cut using the existing backoff.
- WebRTC uses host ICE candidates without Cloudflare STUN. Direct connections
  across some NATs will not form; the authorized native relay remains available.
  No replacement external STUN/TURN provider or paid service was selected.
- Legacy Worker, proxy and export source code remain for non-destructive history
  recovery. They are not an approved sync fallback or a migration destination.
  Existing installed clients may still use them until rollout is verified.

## Before a production cutover (not executed by this PR)

1. Inventory actual room groups and client versions privately. Preserve export
   cuts, pending operations, checkpoint revisions and photo evidence. Never put
   room capabilities, customer data, credentials or licenses into this repo.
2. Export and reconcile all four channels, including their final live tail.
   Existing cold import rejects populated destinations and copies above 16 MiB;
   do not truncate history to pass. Larger histories need a verified staged
   importer before cutover. Reconcile ciphertext fingerprints, order, counts,
   checkpoints and application-level state in an isolated copy.
3. Establish a single authoritative writer during the final transfer. Prove old
   clients cannot keep writing into a divergent source. Upgrade/coordinated
   cutover must preserve their local pending changes; merely proxying old
   sockets through Cloudflare fails the licensing-only requirement.
4. Activate only reconciled groups. Exercise native replay, concurrent edits,
   disconnect/reconnect, missing ACK and recovery before allowing this candidate
   to reach those clients. Inactive groups stay local/pending under v536 and later;
   do not interpret that as a completed migration or an empty new business.
5. Verify adopted app/dashboard versions and network destinations; block the old
   data relay in an isolated acceptance run. Compare Cloudflare data Worker/DO
   and Supabase counters over a stated observation window. Licensing traffic is
   allowed. Zero billed cost is not proof of zero data traffic.
6. Preserve recoverable source copies. A rollback must retain the complete new
   write tail and one authority; never simply flip clients to the old server.
   Do not delete namespaces/history as part of client release cleanup.

## What the new measurement means

`OCLatencia` measures sender-monotonic elapsed time from local Yjs update
publication to an encrypted acknowledgement of application and an instrumented
active-view render at every known peer. SHA-256 of the exact update is carried
inside encrypted ephemeral signaling, separate from the unchanged data frame.
No business IDs or plaintext are sent as telemetry. Partial, failed and no-op
updates cannot borrow a receipt from an unrelated render. Measurement failures
must not interrupt sync or advance/stop a valid recovery cursor.

The measurement includes the return ACK, so it is a **conservative confirmation
budget**, not an exact one-way latency or a measurement starting at the user's
click. A confirmed maximum <=150 ms bounds that measured forward path; a longer
round trip alone does not prove the one-way path exceeded 150 ms. No finite
sample establishes a universal guarantee across networks.

The maximum is retained since reset, even when old percentile samples leave the
bounded buffer. Control probes never count. Missing, unknown/old peers, pending
receipts, stale evidence and diagnostic capacity exhaustion cannot yield a pass.
At least five complete updates are required for a positive session verdict.
Unknown coverage remains visible until explicit diagnostic reset; resetting
does not affect business data and must not be used to hide slow/failed samples.

Current render coverage is **catalog application plus Hoy/Perchas active-view
completion**, with explicit success, DOM mutation and a subsequent visible paint
opportunity. It is not proof that every changed field is on screen. Other views,
ops/photo completion, dashboard rendering, hidden/editing clients and older
peers remain unverified. Their data still synchronizes through the existing
compatible protocol. No production 50–150 ms or billing certification is made.

There is no measurement polling: each eligible catalog update adds one small
encrypted request plus an ACK per confirming peer. Clock refresh remains driven
by connection/activity. Real provider usage must still be measured.

## Focused reproducible checks

```sh
node --require ./test/helpers/sin-red-produccion.cjs --test \
  test/supabase-relay-gateway.test.js test/native-sync-required.test.js \
  test/sync-delivery.test.js test/sync-latencia.test.js \
  test/sync-render-completion.test.js test/yjs-durable-outbox.test.js \
  test/yjs-direct-browser.test.js test/yjs-large-update.test.js
```

These use synthetic local data/transports. Browser tests require the project's
Playwright Chromium and WebKit. Neither passing tests nor opening this PR authorizes merge,
deployment, room activation or production certification.
