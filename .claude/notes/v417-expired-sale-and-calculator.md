# v417 — expired sale and calculator change (2026-09-28)

Developer handoff for Claude and Codex. No customer data or credentials are recorded here.

## Scope
- PR #232, branch `fix/expired-sales-and-calculator`, based on master `d185e6c2c646f0eee2f0bb27a6be035d9052a831`.
- `docs/mock-backend.js`: reject a sale when a perishable product has already expired; return HTTP 400 before any stock or ledger mutation.
- `docs/index.html`: show an inline bilingual expired-product warning, disable Confirm Sale, and exclude expired or zero-stock starred products from Today's suggestions.
- `docs/novedades.js`: apply the same suggestion exclusion in the shift panel; `docs/i18n.js` adds EN/ES warning strings.
- `docs/save.html`: correct the $3,900 at $25/hour and $468 at $3/hour examples, permit the $25/hour scenario on the slider, and identify the 50% time reduction as an illustrative assumption rather than a measured outcome.
- `docs/sw.js` and `docs/version.json`: shell v417; `docs/version-manifest.json` regenerated. Public version remains v1.0.
- `test/venta-cantidad.test.js`: verify an expired item cannot record a sale or decrement stock.

## Verification
- `npm test`: 406 pass, 0 fail on the prepared branch, including Playwright browser tests.
- `bash check-sw.sh`: all shell, hash, navigation, and credential checks pass.
- `git diff --check`: clean.
- No Cloudflare worker, relay, private loader, or deployment workflow was changed.

## Backups and release
- `backup/pre-v417-master-20260928` points to `d185e6c2c646f0eee2f0bb27a6be035d9052a831`.
- `backup/pre-v417-estable-20260928` points to `3973b19f3c5bc340626cbd58bde8d1a99b6022fc`.
- Merging the PR publishes master at `/friendly-123/next/`. The existing `promover.yml` watches the Sonar for 33 minutes, then moves `previo <- estable <- master` unless red/stopped. Confirm the live canary shell and behavior before allowing promotion; confirm the root after the window. Do not force-move refs or bypass the Sonar.
- If the canary fails, use the existing Stop/Rewind control and investigate before promotion. The backup refs above preserve the prechange source; they do not contain business data.
