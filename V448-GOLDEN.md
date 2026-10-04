# v448 GOLDEN release policy

v448 is the frozen public release family for friendly-123.

- Public/health/Sonar shell: `f123-shell-v448`.
- Service Worker cache invalidation is independent: increment `CACHE_GENERACION` in `docs/sw.js` (`-golden1`, `-golden2`, ...).
- Do not create v449/v450/etc. merely for v448 hotfixes.
- A hotfix may change code only after the golden QA gates pass; it must not rewrite customer records as a release side effect.
- Channels remain: `estable` = clients, `master` = `/next/` canary, `previo` = emergency rollback.
- The public shell and `docs/version.json` / `docs/version-manifest.json` must remain aligned at v448 unless JFC explicitly starts a new release family.

This note is outside `docs/` intentionally: it documents the release policy without changing the app shell.

## Current tested generation

- `golden2` — shelf-photo recovery hotfix: never destroys a shelf's last local photo merely because the current content-hash blob is still in flight; service-worker generation is now checked independently of the frozen public v448 identity.
- Verified before promotion: 521/521 regression tests, targeted shelf-photo recovery, WebKit/iPhone photo smoke, lifecycle/stock/undo gates, manifest hashes and service-worker integrity.
