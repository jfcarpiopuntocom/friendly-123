# Friendly-123 — reproducible npm lock inventory (development evidence)

**State:** additive preparation; not a shipped-code SBOM, license clearance, security scan or OpenChain declaration. Friendly-123 itself remains proprietary. No file in `docs/` or any backend is modified.

## Purpose

Run a deterministic, **offline and read-only** conversion of npm lockfile v3 to a CycloneDX 1.5 JSON inventory, without `npm install`, lifecycle scripts, network requests, Docker, account credentials, or app changes. This covers both independent lockfiles; they **must not be conflated with one another**, nor added as if both represented shipped PWA dependencies.

```bash
node scripts/openchain-sbom-lock.cjs package-lock.json > ROOT-LOCK-ONLY.cdx.json
node scripts/openchain-sbom-lock.cjs package-lock.json --report > ROOT-LOCK-ONLY.audit.json
node scripts/openchain-sbom-lock.cjs supabase-relay/package-lock.json > RELAY-LOCK-ONLY.cdx.json
node scripts/openchain-sbom-lock.cjs supabase-relay/package-lock.json --report > RELAY-LOCK-ONLY.audit.json
node --test test/openchain-sbom-lock.test.js
```

Put generated outputs **outside the published repository** in a private evidence directory. The generated BOM contains the exact SHA-256 of each input lockfile, original declared license strings (not legal conclusions), package-manager integrity strings, explicit dev flags, and graph relationships. Its report lists unresolved optional peer dependencies rather than silently inventing them. A mandatory unresolved graph edge makes the CLI exit nonzero. Always inspect stdout/stderr and use the report with the BOM.

## Release and OpenChain gates still required

1. Confirm the checkout corresponds to the **intended actual release** and archive its full commit SHA, exact lockfile SHA-256 and deployed artifact digests. Run against the checkout, not against any historical ZIP snapshot.
2. Obtain an **independent** BOM by Syft and/or official CycloneDX npm tooling, then validate this BOM using the official CycloneDX JSON schema. This small script is not itself a certified scanner.
3. Inventory shipped browser assets separately: Yjs build, jsPDF embedded/transitive code, local QR implementation, SheetJS and other CDN content, fonts and other bundled files. A dev-only package is **not evidence** of shipping; a lockfile omission is **not proof** of its absence from the browser.
4. Preserve licenses/notices and verify exact upstream bytes; review obligations and accepted risk with human ownership.
5. Adopt and evidence the actual organizational OpenChain programs: authority, training, scope, policy distribution, vulnerability intake, triage, retention and evidence review. **No claim of ISO/IEC 5230 or 18974 conformance** while a required item is open.
6. Independently validate stability with synthetic hosted authorization, real-device two-way sync, durable ACK/replay and financial reconciliation, with customer history and photos preserved. This SBOM cannot establish those properties.

**No automatic CI workflows are added** because the existing pull-request workflow triggers a resource-intensive release-control suite. Review-only branch; decide whether to open a PR after verifying workflow quota and regression impact.

Guidance: [CycloneDX JSON schema](https://github.com/CycloneDX/specification/blob/master/schema/bom-1.5.schema.json) and [OpenChain self-certification](https://openchainproject.org/news/2025/08/12/updates-to-openchain-self-certification).
