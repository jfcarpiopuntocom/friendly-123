# 2026-10-31 · Repair branch lineage without changing app

Purpose: unblock release gates that require master to descend from estable.

Evidence:
- master c5f2b569df5fbe921176b9e1bef8c7921e53d7cf; estable ebea5ff534ddc3630d6b964154de23f16e7e7cc1; common ancestor 91538b70a9c51fc6dafabbf73928c3e59c66dd83.
- Full recursive Git tree comparison of 1173/1168 entries: every operational docs/ blob matched between branch heads, including sw.js, version.json, manifest, peer-sync.js, sync-realtime.js and no-op automatic inventory repair.
- Six differing tracked blobs: master adds .github/workflows/p0-no-auto-stock.yml, .github/workflows/p0-peer-rendezvous.yml, docs/architecture/MDD-2026-10-31-localfirst-pin-ledger-sync.md and test/p0-peer-rendezvous-no-quota-loop.test.cjs; master versions of .github/workflows/publicar.yml and test/p0-owner-approved-six-stock-repair.test.cjs supersede older stable variants (never restore automatic stock target 7).
- Merge commit 24683a04dea98b8160db45313f04b1f77a574aa3 records master plus stable as parents, preserving the entire master tree unchanged.
- Previous hotfix run 41183037276 passed 57/57 focal tests but safely refused promoting when stable was not ancestor.
- No customer license, PIN, physical inventory, payment or business data modified by this history-only repair.

Acceptance: merge via reviewed PR, confirm stable is ancestor of master and no operational docs/ hash changed. No forced ref update or version bump for this metadata-only step.
