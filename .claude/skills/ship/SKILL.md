---
name: ship
description: Runs the fix -> test -> commit -> verify pipeline used on the best sessions (v338, sync-hardening). Use after any bug fix or feature change before calling it done.
---

# ship

1. Confirm there's a regression test that reproduces the bug/behavior (write one if missing — it must fail before the fix, checked red-green against the backup).
2. Apply the fix, surgically, only touching files in scope. Backup first (project backup rules).
3. Run the FULL test suite — not just the new test. In friendly-123 run `node --test test/*.test.js` (plain `node --test` also picks up stale copies under `backups/`).
4. Bump the version marker this project uses. friendly-123 and sibling PWAs: shell integer in `docs/sw.js` CACHE + `docs/version.json` (same number), then `node scripts/gen-manifest.js` and `bash check-sw.sh` must be all OK. Never move the public `version`.
5. Commit with a message describing why, not what. Push.
6. Verify the LIVE deployed result: wait until the public `version.json` shows the new shell, compare served file hashes with the manifest, then browser-check the changed screen (DOM read-back or screenshot).
7. Release path (canaries, since shell v403 — see CLAUDE.md "CANARIOS Y TRES CANALES"). Merging to `master` does NOT reach customers:
   - After the merge, verify the LIVE `/friendly-123/next/` (canary), not the root: `curl -s https://jfcarpiopuntocom.github.io/friendly-123/next/version.json`.
   - Tell JFC the shell is on `/next/` and the time it reaches customers (merge time + 33 min max, via `promover.yml`, unless the Sonar shows red or "Detener").
   - At ~33 min, verify the root `/friendly-123/version.json` shows the new shell. If it does not, check the `promover.yml` run and say why.

Report back: test results (pass/fail counts), the version bumped to, what the live check proved and what it did not, the `/next/` URL, and when it reaches customers.
