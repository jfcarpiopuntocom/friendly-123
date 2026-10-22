# P0 · Supabase excessive egress — owner's escalation (SOL6)

**Date:** 2026-10-21. **Severity:** P0 operational, financial, reputation and continuity incident. **Status:** OPEN. **Source:** owner-supplied screenshot (not uploaded to public repository), read-only Supabase project SQL and log aggregates.

## Explicit owner feedback — preserve tone
> This just arrived. Wtf is this! I thought we were moving to Supabase to AVOID filling up quotas with just 1 client and it’s a freaking art gallery!! Write notes about this and how mad I am everywhere!!!!!!

The owner is **extremely angry, alarmed and exasperated**. The migration was meant to AVOID quota exhaustion with a small pilot; instead the service quota is exceeded while real users observe missing inventory stock, photographs, customized PINs and a reverted shop name after a Purge already completed. The owner feels we are damaging trust with clients and endangering his business reputation. Do not minimize this as 'impressive growth'. Do not suggest a paid upgrade as a substitute for finding the cause. No client data reset, checkpoint purge, or production publish.

## User-provided email, distinct from measured usage
- Supabase organization exceeded its current plan's egress quota. Email asks to reduce egress bandwidth below **5.5 GB**, otherwise upgrade. This number comes from the email and is **not** an exact usage reading.
- Grace exception runs until **2026-11-21**; Fair Use Policy enforcement then, possibly earlier if overuse continues. Plan changes require explicit owner approval.
- Official documentation: https://supabase.com/docs/guides/platform/manage-your-usage/egress ; egress can be Database, Auth, Storage, Realtime, Functions, Log Drains. Free uncached egress quota currently documented as 5 GB, separate from cached egress; do not conflate the email's 5.5 GB threshold with a dashboard measurement.

## Ground-truth READ-ONLY measurements from connected Supabase project friendly-relay
- Database: 53 room rows, 11 checkpoints. **11,266 encrypted operations** stored totaling **321,151,434 bytes**. Checkpoint ciphertext total 747,584 bytes. This is stored bytes, NOT downloaded egress.
- Aggregated gateway logs in available last-24-hour window: **38,392 /rest/v1/rpc** requests, including **2 HTTP 5xx**.
- Breakdown by RPC endpoint name: **22,437 f123_relay_command**, **8,980 f123_relay_route**, **6,888 f123_relay_has_topic**. These cover 38,305 requests. Remaining gateway requests are outside these three names.
- UTC-date buckets in same partial 24-hour log window: **37,316 gateway events on 2026-10-21** and **1,161 on 2026-10-20**. Incomplete-day aggregation, not a comparable full calendar-day baseline. No individual visitor, room ID, token, secret, IP or payload inspected.
- Credible hypothesis to investigate, NOT an established cause: repeated full-history reads/replay, overly aggressive polling, reconnection/ACK loops or development test traffic. Since stored ciphertext is ~321 MB yet the email cites an exceeded multi-GB egress limit, repeated transmission **may** explain an amplification; pricing service-specific exact bytes remain unknown.

## Mandatory engineering gates
1. Determine precise billable egress per day, service, project and cached/uncached via organization's official Usage dashboard; no Supabase MCP billing usage endpoint available in this session.
2. Profile RPC call counts per 5m and source category via aggregate server-side logs; correlate request IDs without leaking customer IDs or room identifiers. Distinguish tests from paid customer traffic.
3. Profile average/max bytes returned by relay pull, version/rev and checkpoint; add deduplication, lazy deltas, bounded replay, backoff/jitter and explicit ack; never skip causal updates or overwrite history.
4. Red-team test with ONE synthetic art gallery and two devices: offline join/reload, customized credentials, exact stock, photos, append-only sales + declared per-hour byte/call budget. Use synthetic environment, not load/stress production Supabase during grace period.
5. Freeze certification/promotion and do not purchase Pro / delete data / downgrade architecture to hide the issue without owner's explicit approval.

## Coordination
Project production remains v558. Candidate v559 PR #405 is DRAFT and not approved for release. This financial-quota P0 must be a release blocker **in addition to** PIN, photos, shop name, stock and real cloud durable ACK. Notes cross-posted to Notion War Room, Convergence matrix, Claude+Codex bitácora and OpenChain hold. Anyone working on code must read these notes first. No one should claim that prior QA passing establishes unit-economics or network efficiency.

**Privacy:** Do not commit the screenshot, secret identifiers or raw per-room records. This note contains aggregate metrics only.