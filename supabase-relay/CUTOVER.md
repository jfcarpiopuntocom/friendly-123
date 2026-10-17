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


## Prepared staged copy and source fence (local acceptance only)

`staged-import.sql` is an operator-only SQL artifact, not an applied production
migration. Its private `stage_import_page` accepts exact signed-export response
text plus SHA-256, a per-room session token, and the previous source cursor.
The target must initially be empty and remain inactive. Each page commits its
entire contents and cursor together. Repeating the exact page is idempotent;
another session cannot append. After the initial fixed cut is complete, the
same session accepts a larger final cut only if checkpoint fingerprint and
first surviving source sequence are unchanged. Source compaction requires a new
coherent archive; it cannot be ignored. Pages retain the existing 16 MiB bound;
the complete archive has no aggregate 16 MiB bound.

The legacy source now contains a separately signed `fence` operation. It is
disabled without the existing migration verification key and requires a fresh
Ed25519 request binding action, room/object and a random operator token. It
stores a durable fence, closes existing sockets, rejects subsequent source
writes/broadcasts and new sockets, and returns the final export cut. Hibernation
retains that fence. Export remains available without deleting history. No
unfence operation exists: rolling clients back to the old data relay would
violate the native-only direction and create a second authority.

Neither mechanism was invoked on a real room. Local PostgreSQL 18.6 through
PGlite 0.5.10 accepted an archive above 16 MiB, retained the exact synthetic
ciphertext and appended the final tail. SQLite exercised source-fence restart,
old writes, sockets and non-destructive export. These fixtures do not establish
hosted grants, multi-session locking, Realtime revocation or customer state.

Before a real cut, inventory and preserve all four channel archives, client
pending queues and application/photo reconciliation evidence. Copy while
inactive, then explicitly authorize/source-fence each channel, export and append
its final cut, reconcile again, and only then consider coordinated activation.
An isolated end-to-end rehearsal across the actual signed exporter and hosted
staging database is still required. `copyComplete` explicitly does not mean
source-fenced, reconciled, activated or ready for clients.

A rollback after new native writes must preserve native authority and its new
tail, client pending queues and recoverable copies. This preparation has not
verified a previous-client/native rollback or revoked already-authorized
Realtime subscriptions. Flipping transport flags or returning to Cloudflare is
not a tested rollback. No namespaces, photos or operations were purged.

```sh
node --test test/staged-import.test.js
node --require ./test/helpers/sin-red-produccion.cjs --test test/relay-export.test.js
node scripts/profile-license-fixture.cjs
```

The SQL check requires separately installed local PGlite and pgcrypto. The
licensing profile calls the current Worker handlers with an in-memory KV; it
measures registration logic only, with no provider requests or sync connections.


## Conservative execution order for production migration

Use the direct approved app entry: https://jfcarpiopuntocom.github.io/friendly-123/.
An old note about `/next/` or a canary does not select the migration candidate.
The owner's explicit migration authorization is separate from historical notes
that described these artifacts before authorization.

1. Identify the current master, source Worker bytes, database migration list and
   all four members of each room group privately. Snapshot destination metadata;
   preserve a recoverable source archive and each signed response with its exact
   SHA-256 before any production fence. Do not log room capabilities or plaintext.
2. Apply and exercise the staged importer on an isolated hosted PostgreSQL path.
   Verify grants and rollback, then deploy its reviewed migration without
   activating rooms. An absent PGlite dependency must fail the local SQL check;
   PostgreSQL 18 local acceptance is not evidence for hosted PostgreSQL 17.
3. For a fresh inactive destination, the smallest safe transfer avoids a live
   prestage: preserve the initial source copy, then fence every source channel
   with its own durable operator token BEFORE starting the final staged import.
   Record each returned immutable cut. Keep a group inactive if any fence fails;
   retry with the same token and preserve all local client queues.
4. Export the frozen source from cursor zero, preserving its checkpoint on the
   first page and binding every subsequent signed request to the returned cut.
   Persist exact response text privately, checksum it, and stage each page using
   a stable per-room import token and previous source cursor. Read back the
   committed cursor after uncertain acknowledgements. Never skip a failed page.
5. Reconcile checkpoint bytes/version/revision, every operation ID, lamport value,
   ciphertext and arrival order against the frozen archive. Reconcile the
   application-level business state and referenced photo bytes in an isolated
   copy. A checksum or copied ciphertext alone does not prove those business
   invariants. Keep original archives and source storage recoverable.
6. Activate the complete four-channel group in one transaction only after its
   frozen source and target reconcile. Confirm native recovery and durable ACKs,
   pending local write replay, permissions and business/photo preservation through
   the actual app. Observe network destinations and provider usage in a stated
   window. A route response or copied history is not proof of device adoption.

If an optional live prestage was used and its checkpoint fingerprint or first
surviving source sequence changed, STOP that import session. The staged importer
correctly refuses the incompatible final tail. Do not delete or overwrite the
partially populated destination to make it pass. Use a separately reviewed,
recoverable staging-generation mechanism before adopting that optimization.
The fence-before-final-copy path avoids this requirement and has no aggregate
16 MiB archive limit; each individual page remains bounded.

There is no unfence endpoint. A fence is a production authority transition,
not an automatically reversible deployment toggle. Preserve source and native
copies before it. After native writes, rollback must keep native authority,
its new write tail and pending queues; it must not point clients back to DO.
Deactivating a room does not evict an already authorized Realtime subscription.
No claim of safe rollback or full migration follows from this document.
