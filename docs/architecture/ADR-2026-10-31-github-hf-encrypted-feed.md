# ADR (candidate, discussion of transport #2): license-gated encrypted event feed / API
Date: 2026-10-31 · JFC · Status: **design/test only, NOT deployed**.
Authoritative master decision: [MDD-2026-10-31](https://app.notion.com/p/40a1642b67f381a0a02cf0bfa8b5feac).
Order **#3 urgent, #1 and #5 in parallel, then #2; #4 discussion only**. This paper does not promote #2 ahead of the approved order.

## Exact customer acceptance
A person with an enrolled business license and an authorized CURRENT PIN can open the **same** business from /app, a PWA, Opera/PC, Safari, and any other browser. Each origin/PWA owns a distinct local store and device identity, but all authenticated replicas must catch up to the same causal, immutable business events, with exact duplicate suppression. Startup should show **verified useful data within a few seconds** for returning devices; new/long-offline devices may need larger replay, and **must show a truthful catch-up state, never stale stock as final**. Test p50/p95 measured on target phones and PCs, including first and repeat enrollment. No hard-coded stock value, no silent replacement of previous notebook, no loss of payment or sales history.

## GitHub vs Hugging Face (official technical constraints checked 31 October 2026)
- GitHub Pages hosts static HTML/JS/JSON and release metadata, *not* a request-processing private PIN API. Never publish private business movements or PINs via public Pages, repo contents or GitHub raw. NEVER ship GitHub PAT or Hugging Face write token in browser app.
- Hugging Face Spaces can host a HTTPS Python/Docker API, but default Space filesystem is **ephemeral** and free hardware **sleeps when unused**. Do not promise <3s cold startup or durable messages from a free, ephemeral Space. For real service it needs persistent, backed-up Storage Bucket/transactional DB, a warm/paid runtime and measured quotas.
- Both providers may distribute **identical immutable frontend code**, docs or integrity manifests. A second live API may act as **failover gateway** ONLY when both share the **same** durable encrypted event log and PIN/session authority. Two independent writable databases / uncoordinated feeds recreate the current 6/7 split. Fail-closed on divergence; never choose the last server by wall-clock.
- **Recommendation for evaluation**, when the approved #2 phase arrives: GitHub Pages for release artefacts, a single authenticated and persistent envelope API (Hugging Face or another already approved host) for durable transport, plus an independently monitored standby with exactly the same store and cryptographic trust domain. Do not activate dual writes until invariant tests and measured costs pass.

## Endpoint contract, v1, future-only
All requests over HTTPS, CORS allowlist for precisely approved frontend origins. No user-controlled arbitrary URL with PIN. A valid login must verify license + current PIN against the **same server-side** JFC #3 authority and registered instance; issue short-lived scoped session token (bound to license, role, instance and active PIN revision) in memory. Expired or superseded revision denied. Hard limit failed attempts, abuse and enumeration. Only panel JFC authenticated can propose and activate new PIN revision after successful full census of existing clients.

- POST /v1/sessions: license + PIN + enrolled instance / enrollment proof; server validates PIN only at identity authority; response {session,expiresAt,licenseId,notebookId,pinRevision}. Neither PIN nor bearer token in logs, URL or static file. Never use 3-digit PIN as encryption key.
- POST /v1/envelopes: requires session; body {opId,notebookId,ciphertext,nonce,hash,causalParents,kind,bytes}; enforce per-license max bytes and idempotency (opId+hash), reject same opId with conflicting hash, transactional seq assignment, 201 or 200 on identical retry; do not expose contents to server. ACK means **server durable**, not other devices applied.
- GET /v1/envelopes?after=cursor&limit=N: session; bounded page and ordered cursor; return only immutable encrypted envelopes belonging to canonical notebook, monotonic seq, hasMore, serverCursor. Supports replay after days disconnected and across browser/PWA origins.
- POST /v1/receipts: signed device application ACK with lastApplied cursor and hash; must reflect IDB durable acceptance of validated op(s); a server receipt alone cannot mark multi-device convergence. Each receiver replays exactly once by eventId and immutable payload hash.
- GET /v1/health: no customer data, capability/version only, independently tested. Probe cannot authorize PIN or select a new business notebook.

## Source of truth and cryptography
Business ID/license canonicalization must NOT be per browser. Replicas have unique instance IDs. Event log is append-only, per-op ID and digest, causality; physically meaningful OPEN/RECEIVE/FULFILL/RETURN/LOSS/ADJUST/COUNT projections separate orders, prepaid money, debts, fulfillment, photos. Preserve concurrent/ambiguous COUNT epochs for forensic resolution; never combine incompatible stock epochs silently. Local durable write before success; encrypted outbox survives reload, retry bounded jitter and cursor resets. E2EE account/book key is a **high-entropy secret** exchanged by trusted enrollment or separate recovery method, not derived from short numeric PIN; otherwise joining an offline new device cannot decrypt historic data securely. No PIN cleartext stored in inbox, GitHub, HF logs, Notion or client telemetry.

## Dual-provider and recovery invariants
1. **Exactly one durable journal** across gateway A and gateway B; if replicated, must provide committed causal ordering and anti-rollback proofs before failover is permitted. Stateless gateways + shared transactional log are simpler.
2. Failover only on proven transport outage and verified notebook ID/session PIN revision, never on arbitrary "last active browser" or unknown HTTP 404.
3. Financial events cannot be acknowledged by UI until their local IDB strict ACK; sync is eventual to peers and reports pending honestly.
4. Stop/rollback path leaves local books and outboxes untouched; never purge or restore one device over another.
5. Enforce storage/egress budgets with synthetic limits and network monitoring; do not reactivate archived Cloudflare relay or saturate Supabase.

## Required gates before production or even pilot
- #3: server-side census of **all existing registered clients**, local credentials unchanged; then authorized PIN CAS transition and JFC dashboard edit pencils/mobile layouts.
- #1/#5: prove deterministic 2-3 replica ledger convergence with real old notebook preflight: duplicates, concurrent FULFILL, expired PIN, offline days, restart, media, contacts, 507 errors, split epochs, no unsafe 7 auto-adjustment.
- #2: private canary authenticated with synthetic business only, failed/retried/delayed writes, large events, retention quota and bad-auth tests; run connection via /app, Safari, Opera and standalone PWA; measure actual time to same notebook and all inventory events.
- Reconcile real customer's PC/phone event histories **before modifying them**: independent backups + checksums and causal diff; unknown or different epoch -> review conflict, no arbitrary overwrite.
- Only then release-control green on *the same git SHA*, manifest hashes against actually served release, remote health, JFC approval and reversible rollout.

Sources: https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site ;
https://huggingface.co/docs/hub/spaces-overview ;
https://huggingface.co/docs/hub/spaces-storage .
