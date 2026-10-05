# Production Gates — friendly-123 v448 GOLDEN

Two deterministic gates. They do not use LLMs and do not mutate production or customer data.

## 1. Production Guardian

- pins public identity to `f123-shell-v448` / `v448 GOLDEN`;
- verifies the Data Integrity Prime Directive is present;
- scans newly added production lines for destructive storage/data operations;
- warns when risk-sensitive code changes without regression tests;
- runs focused v448 regressions, the full suite, manifest regeneration and `check-sw.sh`;
- uploads `.artifacts/production-guardian.json`.

## 2. Customer Data Canary

- uses synthetic Canary-A / Canary-B identities only;
- proves a payload encrypted for A cannot be opened by B;
- requires the existing owner/dashboard local-data ownership guards;
- blocks new foreign/demo fixture markers in production code (`cappuccino`, `espresso`, etc.);
- blocks possible real license literals added to production code;
- executes existing zero-trust, peer-sync, browser-canary, photo-integrity and payment/undo regressions;
- uploads `.artifacts/customer-data-canary.json`.

## Rollout

1. Run on `engineering/production-gates-2026-10-05` only.
2. Fix false positives until both jobs are green.
3. Keep n8n observers in alert-only mode.
4. After a clean observation period, make both checks required for hotfix PRs.
5. Do **not** modify `promover.yml` until the gates are proven stable.

## n8n role

n8n is the orchestrator/observer. GitHub Actions and Node are the reproducible test engine. Qwen/Laya/Second Brain may summarize evidence, but never decide PASS/BLOCK.
