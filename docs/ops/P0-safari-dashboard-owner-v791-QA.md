# v0.7.91 · Safari Dashboard Owner/Admin parity · release evidence

## Customer-observed facts (18 November 2026)
- Safari dashboard opens and shows the real business under an alternative team credential; the active Owner PIN used to enter the app in another Safari tab is not accepted by v0.7.90 dashboard.
- The business data does load once the dashboard is authenticated. No evidence of business-data loss.
- Multiple real devices may share one license. Their independent local Owner hash and current business team roles must not be conflated.

## Cause (verified source, v790)
- The app's login consults `friendly123-licencias.jfcarpio.workers.dev/pin/verify` for Owner.
- The dashboard's local PIN check used only `OCSecure` browser hash and a stored Admin-PIN shortcut; it did not use the canonical Owner verifier.
- A different Safari tab may be suspended; the prior encrypted cross-tab query is a fallback but not a dependable substitute for central Owner verification.

## v791 minimal corrective contract
- On a matching, locally present licensed notebook: current active named Admin in this notebook may enter as Admin; its PIN is not tested against the Owner endpoint. Revoked/deleted accounts are excluded.
- Otherwise, ask the hard-coded HTTPS licensing authority for Owner PIN proof; valid `ok:true, revision>0` grants Owner and adopts it locally through the app's existing method. `pinTs:0` makes the verify operation read-only at the central authority.
- Explicit 401/429/instance mismatch deny stale local Owner PINs; when authority cannot answer, retain the existing offline local-first behavior, never treating offline as a positive central proof.
- Existing local lockout precedes any authorization. Exact license + instance binding enforced; no client-chosen host, no cross-tenant local notebook.
- Cloudflare host audit permits only `/pin/verify` from the new dashboard bundle; no business-data relay or commercial API is added.

## Verification and deployment
- RED -> GREEN: actual login handler tests plus canonical Worker status and tenant checks, synthetic-only.
- Official esbuild -> generated manifest -> `check-sw.sh` / visible dashboard version parity.
- Exact-head P0 hotfix gate + release-control and dashboard-browser regressions before merge.
- Publish only after green; Pages+WebKit public smoke; physical Safari Owner/Admin on real license remains final acceptance.

## Guardrails
No actual license code or PIN in repository, tests or logs. No PIN reset, central PIN rotation, stock/cash/photo writes, migrations or clearing Safari storage.

Tracking plan:
https://github.com/jfcarpiopuntocom/friendly123workshop/blob/main/projects/assembled-v783/plans/2026-11-18-p0-safari-dashboard-central-owner-parity-v791.md
