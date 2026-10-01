---
name: jev-jfc
description: Use Jev (TypeSafe System One model) through JFC's budget-capped Vercel AI Gateway key for repeated or high-volume bounded judgments - routing, relevance/ranking, triage, yes/no checks over many items - when it saves more Claude context than it costs. Not for text generation, exact rules, math, dates, money, one-off trivial choices, irreversible actions, or customer/private data. Applies to friendly-123, AMIGABLE and consultorio-123.
---

# Jev for JFC (Claude side)

Ported from Codex's `jev-jfc` skill (C:\Users\JFC\.codex\skills\jev-jfc, 2026-09-24).
The executor is byte-identical to Codex's; only this how-to differs.

## Division of labor (JFC hard rule)
- **Claude** keeps: reasoning, debugging, reading code, writing code and copy, architecture, explanations.
- **Jev** takes: many small typed judgments over the SAME public state, where doing them in Claude
  would burn context. Examples: rank 40 grep hits by relevance to a bug; classify 30 commit subjects
  into areas; triage a list of UI strings as "needs ES translation / fine / unsure"; score which of
  N candidate files likely hold a feature before reading any of them.
- **Code** keeps: counts, dates, sums, money, exact matches, anything deterministic.
- Not worth a call for a single obvious yes/no. The call must save more than it consumes.

## Laya FIRST, Jev as backup (JFC 2026-10-01)
Laya (pip `laya`, Apache-2.0, open weights) does the same typed judgments (`choice`/`score`/`noul`)
LOCALLY: free, no credits, nothing leaves the machine. Same JSON as Jev, same hard limits below.
- Laptop: `python scripts/laya-evaluate.py < request.json` (first run downloads the model from Hugging Face).
- Cloud: works only if the environment allows `huggingface.co` and `cdn-lfs.huggingface.co`, and
  after `pip install laya` (pulls torch, large). If Laya is unavailable or answers `low_confidence`,
  use Jev; if Jev fails too, Claude decides. Say in one line which engine answered.
- Zero-shot accuracy is modest (author's benchmark: 0.36 base vs 0.77 fine-tuned). Treat it as
  triage advice, never as truth on its own.

```bash
python3 "$(git rev-parse --show-toplevel)/.claude/skills/jev-jfc/scripts/laya-evaluate.py" <<'JSON'
{"state":{"public_context":"..."},"questions":{"route":{"type":"choice","instructions":"Which area?","criteria":{"sync":"...","ui":"...","other":"Nothing else fits"}}}}
JSON
```

## How to call
One request = one state + up to 20 questions, max 12,000 chars. No retry, 8 s timeout.
The key is never printed and never written to a file. In the CLOUD (Linux) it comes from the
environment variable `AI_GATEWAY_API_KEY` set by JFC in the cloud environment settings. On the
LAPTOP (Windows) it lives only in the Windows USER variable, which Claude's shell does not
inherit. The line below covers both (copy of this skill versioned in the friendly-123 repo,
2026-09-26, for the cloud move):

```bash
AI_GATEWAY_API_KEY="${AI_GATEWAY_API_KEY:-$(powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('AI_GATEWAY_API_KEY','User')" 2>/dev/null)}"   node "$(git rev-parse --show-toplevel)/.claude/skills/jev-jfc/scripts/jev-evaluate.mjs" <<'JSON'
{"state":{"public_context":"..."},
 "questions":{"route":{"type":"choice","instructions":"Which area?","criteria":{"sync":"...","ui":"...","other":"Nothing else fits"}}}}
JSON
```

Question types: `noul` (probability 0-1), `choice` (one of named options; always add an `other`), `score` (scale you define).
Live docs are the source of truth: https://docs.typesafe.ai/llms.txt (append `.md` to page paths).

## Hard limits
- NEVER send: customer records, PINs, licenses (F123-/AMG-/C123-), keys, panel data, full transcripts,
  repo dumps, private messages, unpublished business data. The executor rejects credential-like fields/values,
  but that is a backstop, not permission.
- A Jev answer is advice to code, never authorization. Money, publishing, deletion, messages, access changes
  keep their normal safeguards and JFC's approval.
- On timeout/HTTP error/budget rejection/low or ambiguous confidence: keep the existing flow or decide in Claude.
  Do not loop.
- Report in one line what was sent (shape, not content), the decision, confidence and reported cost.
- Budget: key "jfc-jev-codex", USD 1 cumulative, no refresh, 1-year expiry, alerts 50/75/100. Do not replace it
  with an unlimited key or change those controls without JFC's explicit say-so.
