# Encrypted relay migration

This directory contains the PostgreSQL storage and a transport adapter for the
existing Friendly relay protocol. It does not change the app UI, room or key
derivation, business merge rules, or local outbox.

The hosted Free project has the migrations listed here. Its transport has been
exercised with registered synthetic rooms only. v529 loads the native adapter
in the app and dashboard. Customer rooms retain their existing relay until an
operator activates their complete channel group after a verified migration.
The existing Cloudflare relay still serves production traffic.

The separate Worker `friendly123-relay-supabase` has no Durable Object binding.
Its legacy WebSocket endpoint was exercised against the hosted native adapter:
both exchanged opaque binary frames and received durable confirmations. No
production client URL has been switched to this Worker.

## Transport

Inject one `@supabase/supabase-js` client per device into
`createRelayTransport({ client })`. The hosted checks used SDK 2.118.0. Each room
joins a private Realtime channel on the shared connection. Use a publishable key;
never put a service-role key in a browser. Configure bounded fetch timeouts on
the injected client. The adapter preserves binary frames, durable ACKs,
checkpoint conflicts, paginated recovery, presence and server-clock replies.

`gateway.mjs` selects the backend once per connection. Its route lookup groups
the simultaneous channel starts without background polling. New rooms default
to inactive; the entire base/catalog/operations/photos group must be activated
before native routing is allowed. A routing failure closes the pending socket
rather than silently sending data to a different server. Existing local outbox
and reconnect handlers retain their role.

The browser asset is built from the pinned dependencies in this directory with
`scripts/build-supabase-relay.cjs` and local public configuration. The build
accepts only a Supabase project URL and modern publishable key, and keeps vendor
license comments. No service-role credential or customer capability is bundled.

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

`f123_relay_import` is an operator-only cold importer. It checks the source
SHA-256, rejects a populated destination, preserves checkpoint and operation
order, and advances the revision so cursors from the old server replay safely.
Repeating the same import does not duplicate history. A synthetic copy exported
from the live Cloudflare Worker was imported into the hosted Free project and
replayed through a fresh connection with identical ciphertext and order.
The whole-copy RPC is bounded to 16 MiB per request; larger history needs staged
import before it can be migrated. It must never be truncated to fit this bound.

## Compatibility with older clients

`legacy/index.ts` is the `relay-legacy` Supabase Edge Function. It uses the same
room-capability check and publishable anonymous access, with no service-role
credential. The gateway JWT check is disabled because browsers cannot attach
that header; the function checks the registered capability before upgrading.
The room travels in an offered WebSocket protocol rather than the upstream URL.
The proxy removes this protocol selection from the downstream response because
the original browser client did not offer it.

This is a temporary compatibility path. Free Edge Functions have a 150-second
wall-clock limit; the bridge closes cleanly at 110 seconds so the original
outbox/reconnect logic can resume. Each compatibility socket consumes an Edge
invocation and its own Realtime connection. It is not the native path for new
clients: they share one persistent Realtime connection per device and bypass
Edge Functions. Free invocation and connection budgets must be checked before
moving production traffic. No paid overage is authorized.

The bridge retains frames emitted during channel setup until the browser
socket opens, so initial presence and binary traffic cannot disappear between
authorization and upgrade. Disconnection removes its private channel. Hosted
checks covered old/native exchange, durable ACK and replay after reconnect.

## Checks

Run focused protocol checks with:

```sh
node --test test/supabase-relay-transport.test.js test/supabase-legacy-bridge.test.js test/relay-export.test.js test/relay-durable-quota.test.js test/sync-zero-trust.test.js
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
