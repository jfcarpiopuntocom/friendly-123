# Sprint 4 — Official schema and source-identity gates

**Audit-only. Does not certify, deploy, or alter runtime.**

## CycloneDX 1.5 and SPDX

Run scripts/validate-cdx-offline.py with independently obtained copies of these two official schema files, outside the published repository:

- CycloneDX: https://github.com/CycloneDX/specification/blob/master/schema/bom-1.5.schema.json — Git blob d9c4d08031d45ecf0c4b2f6fcac8eeb8c9e78a65
- SPDX: https://github.com/CycloneDX/specification/blob/master/schema/spdx.schema.json — Git blob 566c4a32518c60778e55a56ccf71bf781320b279

Example commands for an isolated environment (no installation is done by our scripts):

    node scripts/openchain-sbom-lock.cjs package-lock.json > PRIVATE-root.cdx.json
    node scripts/openchain-sbom-lock.cjs supabase-relay/package-lock.json > PRIVATE-relay.cdx.json
    python scripts/validate-cdx-offline.py --schema /private/bom-1.5.schema.json --spdx /private/spdx.schema.json --bom PRIVATE-root.cdx.json
    python scripts/validate-cdx-offline.py --schema /private/bom-1.5.schema.json --spdx /private/spdx.schema.json --bom PRIVATE-relay.cdx.json
    python -m unittest discover -s test -p test_validate_cdx_offline.py

The Python tool requires jsonschema and referencing preinstalled outside the PWA and validates against official schemas, not an approximation. It additionally verifies component dependency references. Exit codes: 0=PASS, 1=FAIL, 2=NOT_VALIDATED. It rejects missing/unpinned schema files. Local self-tests of this tool use synthetic schema fixtures and DO NOT prove official-schema validation.

## Exact master source identity for existing sync tests

Nine selected sync source/test files in the historical October 16 snapshot match GitHub master at commit 0d319f741703aa7b938ae98c829d85f2b3ccf006 AFTER CRLF-to-LF normalization ONLY IN A TEMPORARY COPY. See separate reproducibility evidence (Git blob IDs and TAP). Four existing sync suites passed 23/23 over that isolated, matching selection. The test environment is not hosted and no real client was touched. Do not extrapolate to unexamined imports, real devices, or financial business state.

## Autocoaching and OpenChain limitations

Pre-mortem: mistaking substituted schema or historical code for proof could falsely authorize a release/certification. Root causes: missing pinned schema validation, incomplete Yjs/QR notices, absence of hosted synthetic E2E. Critical path: exact checkout -> official validation -> third-party inventory/notices -> adopted security/license program; parallel stable path: hosted test room -> two-device ACK/financial reconciliation -> client acceptance. Adversarial check: keep master, docs, existing sync, licenses and Cloudflare state unchanged; no paid tools, no duplicate workflows, no external publication. No OpenChain conformance asserted.
