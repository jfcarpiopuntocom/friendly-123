# Join notebook — implementation plan

## Baseline

- Approved design: `docs/superpowers/specs/2026-08-28-join-notebook-design.md`
- Backup branch: `backup/20260828-115552-antes-join-notebook-pro`
- External backup: `C:\00 Projects\sandbox\_backups\friendly-123-20260828-115552-antes-join-notebook-pro.tar.gz`
- Checksums: `C:\00 Projects\sandbox\_backups\friendly-123-20260828-115552-antes-join-notebook-pro.sha256`
- Baseline commit: `6e3c98f`

## Stage 1 — lock the failing behavior into tests

1. Extend `.claude/harness-join-identity.cjs` to verify source namespace preservation, destination namespace selection, same-notebook idempotence, and coherent license/sync/room state after reload.
2. Extend `.claude/test-join-button.cjs` to require exactly the approved Join notebook path.
3. Add a focused keypad browser check for digit-only buttons and 300 ms last-digit masking.
4. Run the focused tests against the baseline and preserve any expected red result before code changes.

## Stage 2 — make Join notebook the only ordinary identity mutation

1. In `docs/sync-realtime.js`, centralize license validation without writing state.
2. Make `unirse()` validate first, capture the source notebook, preserve pre-join identity, then switch through `OCTienda.cambiar()`.
3. Ensure failures before a completed switch restore or retain previous identity and room.
4. Keep `activar()`, `reconciliar()`, merge, rotate, and deactivate only for internal/backward-compatible support paths; they are not ordinary UI actions.
5. In `docs/mock-backend.js`, verify storage writes and return explicit errors instead of reporting success after failed marker/room writes.

## Stage 3 — implement approved Option A UI

1. In `docs/avanzado-extra.js`, expose only **Join notebook** and **Check connection** as normal sync actions.
2. Use one license input and route it only to `OCSyncControl.unirse()`.
3. Replace the five-button re-engagement row with a plain-language connection summary.
4. Reveal at most one contextual recovery action only when diagnostics prove it is required.
5. Keep raw diagnostics collapsed under **Technical details**; keep Copy inside details.
6. Remove normal visibility of activate, resync, merge, claim, rotate, deactivate, and split-identity buttons.
7. Preserve support functions internally until tests prove they can be safely removed later.

## Stage 4 — unify language everywhere

1. Update English and Spanish keys in `docs/i18n.js` to notebook terminology.
2. Search `docs/` for visible team/sync/activate/rejoin/claim/merge wording and update only user-facing references.
3. Preserve internal identifiers and stored role strings for compatibility.
4. Update help/manual/first-steps/share text to: paste one license, join once, syncing is automatic.

## Stage 5 — PIN feedback

1. In `docs/auth-ui.js`, remove `EMOJI_POOL`, shuffle code, and emoji markup.
2. Render digit-only keys without changing the 3-digit PIN model.
3. Show only the newest entered digit for 300 ms; mask it afterward.
4. Keep the existing 900 ms completion window unless tests show it conflicts with masking or causes duplicate submission.
5. Preserve the one-listener guard and reset behavior.

## Stage 6 — release integrity

1. Bump `docs/sw.js` from shell v148 to v149.
2. Bump `docs/version.json` and write a focused changelog.
3. Regenerate `docs/version-manifest.json` with `node scripts/gen-manifest.js`.
4. Run `node --check`, focused harnesses, `npm test`, `check-sw.sh`, and `.claude/test-todo.sh`.
5. Perform browser verification in isolated profiles: source notebook unchanged, destination notebook isolated, two-profile convergence, diagnostics, keypad feedback, mobile layout.
6. Commit and push only after all local gates pass.

## Stage 7 — production deployment and verification

1. Push the green shell to `origin/master` for GitHub Pages deployment.
2. Confirm the public URL serves the intended `version.json`, service-worker shell, Option A UI, and new assets.
3. Test relay WebSocket reachability and two-profile sync against the public PWA.
4. Inspect the live control panel without changing real-user data.
5. Deploy Worker/relay code only if source changes are necessary and configured credentials allow it; otherwise report the exact credential-gated step without claiming it was deployed.
6. If public verification fails, revert to the backup baseline, bump the shell, regenerate the manifest, push the rollback, and verify it publicly.

## Stage 8 — notes and handoff

1. Record the user prompts, root causes, exact changes, commits, tests, deployment evidence, and rollback path in `DIARIO-2026-08-28.md` and `PROMPTS-Y-BITACORA.md`.
2. Add one focused implementation note under `docs/` or `.claude/notas/` for future sessions.
3. Leave the repository clean and synchronized with `origin/master`.
