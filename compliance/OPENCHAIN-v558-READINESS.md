# friendly-123 · OpenChain audit continuity · v558/golden122

**Read-only certification preparation — not a statement of conformity.**

Release under examination: `2dc7ed4404f2f0b1a609da0812a00eb303d2d869` (GitHub branch `estable`, 21 October 2026).
Previous release remains in rollback channel `previo` (v556).

## Verified in this audit
- Six monitored third-party asset hashes from the v547 evidence branch match **exactly** the current v558 release manifest. This proves unchanged asset identity across versions, **not** attribution, upstream release provenance, notices, or browser/PWA adoption.
- npm v3 lock contains **200 third-party package records** (**4 marked `dev: true`**). Each has a `license` text field; expressions are source declarations and have **not** been legal-vetted as SPDX. This lock is **not** an SBOM of shipped PWA assets or its CDN.
- Existing PDF-specific provenance file and `PDF-LICENSES.txt` are present under `docs/vendor/`. Their scope is explicitly limited.
- Official program draft is still **unadopted**; correspondence capability, designated competent legal/technical reviewer and training evidence have not been demonstrated.

## Files in this audit branch only
- `compliance/asset-identity-v558.json`: six v558 asset identity comparisons, inherited risk notes and status.
- `scripts/openchain-sbom-lock.cjs`: imported from former OpenChain audit branch, offline lock-to-CycloneDX-1.5 generator using only Node built-ins; output is explicitly lock-scoped.
- `test/openchain-sbom-lock.test.js`: 11 synthetic regression checks imported from prior audit.
- `test/openchain-asset-identity.test.js`: six-asset integrity contract adapted to v558.
- `compliance/OPENCHAIN-v558-READINESS.md`: this frozen read-only gate summary.

## Run from an actual cloned checkout on this audit branch
```sh
node --require ./test/helpers/sin-red-produccion.cjs --test --test-concurrency=1 test/openchain-sbom-lock.test.js test/openchain-asset-identity.test.js
node scripts/openchain-sbom-lock.cjs package-lock.json --report
node scripts/openchain-sbom-lock.cjs package-lock.json --bom > /tmp/friendly-v558-npm-lock.cdx.json
```
Generated npm-lock SBOM is **not** a complete delivered-software SBOM. Reconcile shipped browser assets, embedded libraries, external CDN and fonts, along with rights and notices before any external claim.

## Release gates kept closed
1. Map every **actually distributed** third-party component to release bytes, provenance, upstream version, license obligations, and accompanying copyright/NOTICE text. Record unresolved items, including SheetJS, intl-tel-input WithUtils, jsPDF embedded dependencies, fonts' reserved names and QR version.
2. Resolve documented security advisories using actual artifact version, reachability, impact and remediation record; retain raw scan results.
3. Record genuine management approval of 5230/18974 policy, organizational scope, role competence, reception and response handling, training and recurring review — **not** silently mark a drafted policy as adopted.
4. Perform evidence-based evaluation against **all** requirements of both standards before offering any self-declaration to owner for explicit visual approval.
5. Independently validate business continuity (cross-device ACK/reload, durable journal, photos, money, PWA update) before claiming product stability. These are **not** proven by OpenChain badges.

No customer records, license keys, real ledger, DNS, Cloudflare, Supabase, `docs/` or production branches are changed by this certification-only branch.
