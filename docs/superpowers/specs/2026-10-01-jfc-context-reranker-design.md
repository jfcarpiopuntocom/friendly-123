# JFC Context Re-Ranker — Design

**Goal:** Improve cross-session work quality by ranking candidate context before Claude/Codex/ChatGPT reads full sources.

## Design
- Broad retrieval remains connector/tool-specific.
- This subsystem receives candidate metadata/text and ranks locally.
- Current explicit user instructions and repo rules are mandatory constraints, not optional semantic matches.
- Zero-dependency baseline uses deterministic feature-hash embeddings plus exact overlap, authority, freshness, project match, superseded penalties, and dedupe.
- Output is a compact context pack, not a dump.
- Cross-encoder support is deferred until benchmark data proves it improves the baseline.
- No customer/business data is sent to external services.

## Success criteria
- canonical constraint sources rank above similar stale notes;
- cross-project distractors are penalized;
- near-duplicate chunks collapse;
- Spanish/English text is normalized consistently;
- CLI and benchmark work without paid APIs;
- golden-set metrics are reproducible;
- integration is additive and does not touch the production app shell.
