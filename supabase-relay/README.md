# Encrypted relay migration

This directory contains the PostgreSQL storage and a transport adapter for the
existing Friendly relay protocol. It does not change the app UI, room or key
derivation, business merge rules, or local outbox.

The hosted Free project has the migrations listed here. Its transport has been
exercised with registered synthetic rooms only. The adapter is not yet wired
into the published app. The Cloudflare relay still serves production traffic.

## Transport

Inject one `@supabase/supabase-js` client per device into
`createRelayTransport({ client })`. The hosted checks used SDK 2.118.0. Each room
joins a private Realtime channel on the shared connection. Use a publishable key;
never put a service-role key in a browser. Configure bounded fetch timeouts on
the injected client. The adapter preserves binary frames, durable ACKs,
checkpoint conflicts, paginated recovery, presence and server-clock replies.

Realtime's WebSocket serializer requires an `ArrayBuffer` for binary payloads.
A typed array would become a JSON object. The adapter copies outbound buffers
at `send()` time and converts them to `ArrayBuffer` before transmission.

Stable operation IDs remain authoritative when an existing client re-encrypts a
retry with a fresh IV. The first committed envelope is retained. The backend
does not inspect plaintext and cannot identify semantic conflicts in ciphertext.

## Approved access boundary

JFC explicitly approved access through a secret, backend-registered room
capability without a user login. Possession permits receiving and injecting
encrypted frames in that room. The AES key is still needed to open them.
Clients cannot directly access tables, enumerate rooms or register new rooms.
The private tables have RLS and no client policies. The two public capability
functions intentionally use `SECURITY DEFINER`, a fixed search path and room
checks; Supabase's corresponding advisory remains visible.

## History export

The existing Cloudflare Worker adds `POST /migration/export`. It requires an
Ed25519 signature over the exact request body, a timestamp within one minute,
and a signed `objectId` or `room`. The private signing key is not deployed.
Unsigned, expired, altered or oversized requests are denied before room lookup.

The request is `{v:1,action:"export",objectId,issuedAt,limit,after,cut}`.
For the first page omit `cut` and `after`. Later pages must repeat the returned
cut and use its `after` cursor. Checkpoint fingerprint and first surviving
sequence detect source compaction and return 409 rather than silently dropping
a page. New operations above the first page's watermark are outside that cut.
Responses are not cached. The endpoint never deletes or rewrites stored data.

An export is a recoverable copy of a defined cut. It is not a completed live
migration: a final tail, compatibility with older clients, destination import,
room registration, rollout and rollback must still be verified before cutover.
No Durable Object namespace has been deleted.

## Checks

Run focused protocol checks with:

```sh
node --test test/supabase-relay-transport.test.js test/relay-export.test.js test/relay-durable-quota.test.js test/sync-zero-trust.test.js
```

`acceptance.sql` and `reencryption-acceptance.sql` exercise synthetic data inside
a rolled-back transaction. Hosted checks also delivered ciphertext for catalog,
operations and photos, then closed the connections and recovered/decrypted the
stored frames using fresh connections. They do not prove physical-device
adoption or end-to-end business convergence within two seconds.

Only free resources are authorized. Supabase Free's message, connection,
storage and inactivity limits still apply. Historical Cloudflare outbound
counters must not be treated as Supabase billing counts. Measure actual load
and preserve a recoverable external export; Free has no included automatic
database backup. No paid plan or trial has been activated.
