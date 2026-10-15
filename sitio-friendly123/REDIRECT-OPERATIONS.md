# Fast track: official domain entry → functioning original notebook

Status: **prepared in GitHub; not deployed to friendly123.com**. Scope approved by JFC: solutions 1, 2 and 3 only. Option 4 (cross-origin state migration) deferred to Tuesday 2026-10-20 in Notion.

## 1 — reversible edge redirect (code)

- The existing Cloudflare Worker `friendly123-com` routes GET **document navigation** `/app`, `/app/`, `/app/index.html`, and other HTML pages to `https://jfcarpiopuntocom.github.io/friendly-123/` via **HTTP 307** with `Cache-Control: no-store`. No iframe, no new local notebook, no PIN activation.
- **Cached 301 caveat:** the previously installed Worker replied with a permanent 301 from `/app` to `/app/`. Some browsers may remember it and keep reaching the old cached `/app/` even after a new 307 is deployed. For those browsers the temporary escape URL **`https://friendly123.com/app?entry=1`** (still outside `/app/` SW scope) uses a different HTTP cache key. It drops this query before arriving at the old site. Never advise deleting user storage to fix a cached redirect.
- **Preferred advertised entry: `https://friendly123.com/app` (without trailing slash).** The old service worker's scope is `/app/`, so this URL falls outside that scope and can reach the Worker even when `/app/` has a cached shell.
- The user sees the working old hostname after navigation. This is intentional until the optional migration is approved.
- The official root landing, payment/legal pages and non-HTML assets are untouched. `/app/version.json`, `/app/_release.json`, `/app/sw.js`, JS and CSS remain read-through from the **same stable commit**; no duplicate Cloudflare app build.
- Query values are dropped except the previously supported `estable=1` override. Browser fragment links naturally survive redirects without entering the server.
- Fallback/rollback: set `TEMPORARY_LEGACY_ENTRY=false` in `sitio-friendly123/official-app.mjs`, redeploy the same Worker once. Never use a permanent 301, `Clear-Site-Data`, localStorage.clear or domain rewrites.

## 2 — one authoritative release

- The already-live `official-app.mjs` reads `jfcarpiopuntocom.github.io/friendly-123/`, which is the published branch `estable`.
- Audit `https://friendly123.com/app/_release.json` versus `https://jfcarpiopuntocom.github.io/friendly-123/release-proof.json` for identical SHA/shell. `version.json` remains uncached.
- **No extra Cloudflare Worker deploy per code version.** Only the initial redirect code requires one deploy of `friendly123-com`, and only if the properly authorized Cloudflare account is available.

## 3 — preserve the already-engineered fast PWA

- The original app already precaches its release shell (service worker), has `updateViaCache: 'none'`, tests `version.json`, broadcasts new versions within the origin, and reloads at safe moments; keep it rather than adding Workbox and extra dependencies.
- Serving the original URL directly removes the new Worker from every subsequent app script/fetch path. The original service worker can open immediately from its cache. Never claim a real 0-ms internet deployment.
- An **already installed `friendly123.com/app/` service worker can intercept that trailing-slash URL before the Worker**. Advertise `friendly123.com/app` without trailing slash for dependable entry. Deleting the old SW or local data on a customer device is forbidden.
- Test functional parity across desktop, Android, Safari, offline/reconnection and correct license/real inventory. Do not treat public release proof as evidence about an individual device's local notebook.

## Release pre-mortem, problem tree, and PERT

**Pre-mortem:** Failure modes: trailing-slash cached SW keeps showing demo; wrong Cloudflare account is modified; 301 caches a permanent redirect; old origin stops being accessible; redirection applied to SW/JS/JSON rather than navigations; different license credentials accidentally exposed in URL. Prevent with no-slash canonical link, isolated Worker edit, 307/no-store, read-only old-origin verification, tests, query whitelist, and rollback flag.

**Problem tree:** Core problem: official hostname is a distinct browser origin from a functioning legacy business notebook. Causes: storage origin isolation, service worker caching, two distribution paths. Consequence: perceived empty/demo business despite historical data intact. First cure: navigate to the actual trusted legacy origin. Longer-term migration postponed.

**PERT critical path:** fetch stable proof → prepare isolated branch → Node redirect/integrity/PWA tests → inspect correct Cloudflare Worker/account credentials → deploy only `friendly123-com` once → verify HTTP 307 for `/app` + no redirect of JSON/JS + landing unchanged → real owner confirms same business without reactivation. If correct Cloudflare account is unavailable, STOP before deployment and give merge link.

## Deployment gate (not executed)

The connected Cloudflare account visible to this ChatGPT conversation contains BuscaClientes Workers and **does not contain** the `friendly123-com` Worker or a `friendly123.com` zone. Never try to change that account.

Only from the correctly authenticated environment where the website source repository and Wrangler credentials already exist, `cd sitio-friendly123 && node build.mjs && npx wrangler deploy`, following existing site build prerequisites. The build is for the landing assets that already exist; use the same account and inspect the dry-run/output before any deploy. This tool session cannot certify that build/deploy or simulate the live owner's browser profile.

No changes to real client data, financial ledgers, license tables or local storage are part of this proposal.
