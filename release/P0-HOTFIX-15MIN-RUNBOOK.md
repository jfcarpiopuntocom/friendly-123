# P0 hotfix release pathway — JFC approved 2026-11-06

## Target (measured, not promised)
- `P0 Hotfix Gate`: target **3–5 min** from ready candidate SHA.
- Merge and publish: **3–5 min**, do not run the same tests twice after exact proof.
- Exact public `release-proof.json` + local synthetic sale/browser smoke: **1–3 min**.
- **Total objective: 7–13 min; escalation at 15 min**, with no fabricated success.
- The stopwatch starts **after the patch is finished and has an immutable commit SHA**.

## Gate (blocking)
Workflow: `.github/workflows/p0-hotfix-gate.yml`, required job name **P0 Hotfix Gate**. It runs on every PR and master without path filters:
- Real IndexedDB sale commit / CAS, rollback and stock validity.
- Financial and commission invariant checks; payout must never reuse another sale ID.
- Central Owner PIN / same-license identity, causal Sync3 and peer deduplication.
- Real Chromium/WebKit synthetic CAS; exact app asset generation, shell metadata and SHA-256 manifest.
- Every changed-area test from `scripts/pruebas-del-area.cjs`, plus an unconditional P0 safety core. No silent limit or exclusion.
- Production outbound traffic is forbidden by the test guard. No customer PIN/data in CI.

The `Release continuity gate` (all 2,400+ checks) **still runs in parallel** as an advisory signal during approved emergency PRs. Its failures are still investigated and block normal release policy; they do not silently authorize dangerous behavior.

## Installation requires ONE administrative change (not available to current GitHub connector)
**Only after the P0 workflow is merged and its check has succeeded on a representative PR**, open the repository's GitHub **Settings → Rules → Rulesets** (or **Settings → Branches**, depending on the existing protection) and edit the rule protecting `master`:
1. Add required status **`P0 Hotfix Gate`**, **source GitHub Actions**.
2. Replace the required **`Release continuity gate`** with that P0 check for the approved hotfix track. Keep other mandatory security/branch safeguards unless separately authorized. Check all overlapping rulesets — any remaining required full-suite check continues to impose its original delay.
3. Save. Verify on a *fresh* tiny test PR that a successful exact-SHA P0 check permits merging **while the full suite is still in progress**.
4. If the test PR cannot merge, revert the rule switch; do not override branch protection or force-push.

Changing a workflow file **does not** change branch-protection settings. Do not claim the 15-minute release pathway is active before this one-time administrative update succeeds.

## Postmerge release protocol
On a master docs push `.github/workflows/hotfix.yml` checks source/tree identity and release manifest.
- A normal two-parent merge from a PR whose **exact head SHA** has a successful `p0-hotfix-gate.yml` run and **exactly the same file tree** can reuse that proof. The gate/proof inputs must be unchanged in the PR.
- Squash/rebase, changed merge tree, unverified API result, missing token, workflow mutation, stale/incomplete test: **fail closed to the existing full targeted postmerge test path**.
- After safety checks, `previo ← estable`, `estable ← exact master SHA` atomically, and deploy GitHub Pages once. No follow-on changes to customer data, PIN, books or relays.
- The public `recorrido.yml` runs Chromium/WebKit using the pinned Playwright container (no `apt` or new browser install). A public shell check cannot prove a real customer's private sale succeeded; the sale gate executes a **separate synthetic notebook**.
- Compare the exact public `release-proof.json.commit` with the tested promoted SHA. If mismatch or public smoke red, do not report LIVE.

## Triage / fallback
- If P0 red: do not merge or publish. No retry that hides a genuine RED.
- If 15 min exceeded: report the exact pending step, run id and blocker; **do not bypass P0**.
- If full suite finds material P0 break after release, use the existing `deshacer` / REWIND procedure and investigate; preserve original data and forensic receipts.
- If real user data differs despite green synthetic tests: gather consented observed facts; no direct writes to customer database or PIN.
