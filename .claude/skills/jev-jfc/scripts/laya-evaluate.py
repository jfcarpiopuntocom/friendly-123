#!/usr/bin/env python3
"""Laya (local, open weights) with the SAME JSON contract as jev-evaluate.mjs.
JFC 2026-10-01: Laya first, Jev as backup. Runs on JFC's laptop; nothing leaves it,
but the same guards apply (no clients, PIN, licenses, keys). Reads {"state":..,"questions":..}
from stdin, prints Laya's answers as JSON. No retry: on any error, exit 1 and Claude decides."""
import json, re, sys

MAX_CHARS, MAX_QUESTIONS = 12_000, 20
FORBIDDEN_KEY = re.compile(r"password|passwd|secret|token|api.?key|pin|license|credential|cookie|authorization", re.I)
FORBIDDEN_VALUE = re.compile(r"\bvck_[\w-]{12,}|\bsk-[\w-]{12,}|\bgh[opusr]_[\w-]{12,}|Bearer\s+[\w.-]{12,}|\b(?:F123|AMG|C123)-[\w-]{4,}", re.I)

def fail(msg):
    sys.stderr.write(msg + "\n"); sys.exit(1)

def inspect(v, path="request"):
    if isinstance(v, str):
        if FORBIDDEN_VALUE.search(v): fail(f"Refusing credential-like value at {path}.")
    elif isinstance(v, list):
        for i, x in enumerate(v): inspect(x, f"{path}[{i}]")
    elif isinstance(v, dict):
        for k, x in v.items():
            if FORBIDDEN_KEY.search(str(k)): fail(f"Refusing sensitive field {path}.{k}.")
            inspect(x, f"{path}.{k}")

def main():
    try: req = json.load(sys.stdin)
    except Exception as e: fail(f"Bad JSON: {e}")
    if not isinstance(req, dict) or "state" not in req: fail("Request.state is required.")
    qs = req.get("questions")
    if not isinstance(qs, dict) or not 1 <= len(qs) <= MAX_QUESTIONS: fail(f"Use 1-{MAX_QUESTIONS} questions.")
    if len(json.dumps(req)) > MAX_CHARS: fail(f"Request exceeds {MAX_CHARS} chars.")
    inspect(req)
    state = req["state"] if isinstance(req["state"], str) else json.dumps(req["state"], ensure_ascii=False)
    try:
        from laya import Router
        out = Router().predict(state, qs, min_confidence=0.6)
    except Exception as e: fail(f"Laya error: {e}")
    print(json.dumps({"engine": "laya", "answers": out.get("answers"), "model": out.get("routing", {}).get("model")}, ensure_ascii=False, default=str))

if __name__ == "__main__": main()
