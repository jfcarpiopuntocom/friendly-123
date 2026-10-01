# JFC Context Re-Ranker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local, reproducible context-ranking baseline for JFC projects.

**Architecture:** Connector-facing agents retrieve broad candidates; `.ai/reranker/` ranks and deduplicates them locally, then emits a compact context pack. Mandatory constraints receive explicit priority. A later cross-encoder can replace/augment the lexical embedding score without changing the CLI.

**Tech Stack:** Node.js >=18, zero runtime dependencies, node:test.

**Spec:** `docs/superpowers/specs/2026-10-01-jfc-context-reranker-design.md`

## Global Constraints
- No paid API required.
- CPU-first.
- No customer/business data sent externally.
- Current user instructions / CLAUDE.md / AGENTS.md are mandatory constraints.
- Do not touch production shell files.

## Tasks
- [x] TDD tests for constraint priority, project penalty, dedupe, deterministic embeddings and context pack.
- [x] Local RED verified before production code.
- [x] Ranking core implemented and GREEN.
- [x] CLI + benchmark regression tests; RED then GREEN.
- [x] Golden set baseline.
- [x] Agent skill + docs.
- [ ] Expand golden set to 30–50 real JFC queries before claiming large quality improvement.
