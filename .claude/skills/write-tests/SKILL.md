---
name: write-tests
description: Write a regression test the JFC way - backup first, prove it FAILS on the backup, then PASSES with the fix. Use whenever fixing a bug or changing behavior in friendly-123 (and sibling apps), before calling the fix done. Also labels "pinning" tests honestly.
---

# write-tests

Why this exists (JFC 2026-09-22 constitution, rule 3): a green test proves nothing
unless it was seen failing without the fix. Written as prose it got skipped; here
it is a checklist. Do every step, in order.

1. **Backup first.** Copy every file you will touch into
   `backups/<YYYY-MM-DD_HHMM>_<reason>/` and write `SHA256-LINES.txt` there
   (bytes, lines, SHA-256 of each file).
2. **Write the test** in `test/<area>.test.js` (node:test). Test the saved data /
   real outcome, not only what the UI shows. No licenses, PINs or customer data in
   fixtures (G5 in `check-sw.sh` fails on a full license).
3. **RED against the backup.** With the code still as in the backup (no fix yet),
   run `node --test test/<area>.test.js`. It MUST fail, and fail for the reason of
   the bug. Save the failing line for the report. If it passes, the test does not
   catch the bug: rewrite it before going on.
4. **Apply the fix**, surgical, only files in scope.
5. **GREEN.** Run the new test (passes), then the FULL suite:
   `node --test test/*.test.js` (never plain `node --test`: it picks up stale
   copies under `backups/`).
6. **Optional proof:** restore the backup file temporarily, confirm red again,
   put the fix back and verify by SHA-256 that the fixed file is the one in place.
7. **Label honestly.** A test for behavior that was already correct is a
   *pinning test* ("test de fijacion"): say so in its name/comment and in the
   report. Never sell it as proof of a fix.
8. **Never relax a test** to make code pass. Fix the code or the comment, never
   the guard that protects something real.

Report: test file, red output (1 line), green counts of the full suite, and which
tests are fixes vs pinning. Then continue with the `ship` skill.
