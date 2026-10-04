# v448 GOLDEN release policy

v448 is the frozen public release family for friendly-123.

- Public release shell: `f123-shell-v448`. The user-visible release name is always `v448 GOLDEN` unless JFC explicitly starts a new release family.
- Canary/Sonar build identity is separate and numeric so the already-deployed Worker can distinguish hotfixes: `golden1 -> f123-shell-v44801`, `golden2 -> f123-shell-v44802`, etc.
- Service Worker cache invalidation is also separate: increment `CACHE_GENERACION` in `docs/sw.js` (`-golden1`, `-golden2`, ...). `docs/version.json.cacheGeneration` must match it.
- The invariant is: `goldenN <-> f123-shell-v448NN`. `check-sw.sh` and `test/release-golden-policy.test.js` enforce this.
- Do not create v449/v450/etc. merely for v448 hotfixes.
- A hotfix may change code only after the golden QA gates pass; it must not rewrite customer records as a release side effect.
- Channels remain: `estable` = clients, `master` = `/next/` canary, `previo` = emergency rollback.
- Promotion is fail-closed. A manual PUSH and the 33-minute promoter both require a fresh LORD witness from `/next/` for the exact `canaryBuild`.
- A PUSH order created before the current master commit cannot authorize that newer code.
- Branch mutation is compare-and-swap: explicit `--force-with-lease` protects the expected SHAs. Normal promotion changes `previo` and `estable` in one `--atomic` push, with `master` included as a no-op leased ref so a stale workflow cannot win the fetch-to-push race.
- `docs/version.json.shell` and `docs/version-manifest.json.shell` stay aligned at `f123-shell-v448`. Build identity belongs in `canaryBuild`, not in the public shell.

This note is outside `docs/` intentionally: it documents the release policy without changing the app shell.
