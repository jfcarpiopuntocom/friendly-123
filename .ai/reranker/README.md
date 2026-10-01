# JFC Context Re-Ranker

Local, zero-dependency baseline for ordering candidate context before Claude/Codex/ChatGPT reads it.

## What it does
- normalizes Spanish/English text;
- creates deterministic local hashed embeddings (word, character trigram, bigram);
- scores exact overlap, embedding similarity, authority, freshness and project match;
- forces explicit constraints to the top;
- penalizes superseded and cross-project material;
- removes near duplicates;
- emits a compact context pack.

This is the v0.1/v0.2 baseline. It deliberately does **not** claim cross-encoder semantic quality yet. The next stage may plug in a local BGE/MiniLM/ONNX reranker, but the benchmark must prove that it beats this baseline.

## CLI

```bash
node .ai/reranker/index.mjs --query "Por Producto comisiones" --input candidates.json --project friendly-123 --mode deep --top 12
node .ai/reranker/benchmark.mjs .ai/reranker/golden-set.json
node --test test/jfc-context-reranker.test.mjs
```

Candidate schema:
`id, source, title, text, project, updated_at, authority, constraint?, user_pinned?, superseded?, path?, url?`

The connector-facing agent is responsible for broad retrieval. This tool only ranks and packs candidates; it needs no cloud credentials.
