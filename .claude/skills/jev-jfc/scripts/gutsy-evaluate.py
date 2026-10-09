#!/usr/bin/env python3
"""gutsy (local Qwen3.5-0.8B decision model, kouhxp/gutsy) with the SAME JSON contract the
jev-jfc skill used for Laya and Jev. JFC 2026-10-07: gutsy replaces Laya (better JevBench score,
smaller, no torch). Reads {"state":..,"questions":..} from stdin and prints the answers as JSON.

Order: running server on 127.0.0.1:8765 (fast, model already loaded) -> one-shot
`gutsy-inference decide -` (loads the model each time, ~5-15 s). No retries: on any error,
exit 1 and Claude decides. Same guards as Laya/Jev: no customer data, PIN, licenses or keys."""
import json, os, re, subprocess, sys, urllib.request

# Repo clone with models.json + models/. Laptop path first; cloud sessions clone to ~/gutsy (session hook).
ROOT = next((p for p in (os.environ.get("GUTSY_ROOT"), r"C:\00 Projects\gutsy\gutsy-inference",
             os.path.expanduser("~/gutsy/gutsy-inference")) if p and os.path.isdir(p)), None)
URL = "http://127.0.0.1:8765/v1/systemone"
MAX_CHARS, MAX_QUESTIONS = 12_000, 20
FORBIDDEN_KEY = re.compile(r"password|passwd|secret|token|api.?key|\bpin\b|license|credential|cookie|authorization", re.I)
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

def via_server(req):
    r = urllib.request.Request(URL, data=json.dumps(req).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=120) as resp:
        return json.load(resp)

def via_cli(req):
    if not ROOT: fail("gutsy not installed (no server on :8765 and no repo clone).")
    p = subprocess.run(["gutsy-inference", "decide", "-"], input=json.dumps(req), capture_output=True,
                       text=True, cwd=ROOT, timeout=300, encoding="utf-8")
    if p.returncode: fail("gutsy error: " + (p.stderr or p.stdout)[-600:])
    return json.loads(p.stdout)

def main():
    try: req = json.load(sys.stdin)
    except Exception as e: fail(f"Bad JSON: {e}")
    if not isinstance(req, dict) or "state" not in req: fail("Request.state is required.")
    qs = req.get("questions")
    if not isinstance(qs, dict) or not 1 <= len(qs) <= MAX_QUESTIONS: fail(f"Use 1-{MAX_QUESTIONS} questions.")
    if len(json.dumps(req)) > MAX_CHARS: fail(f"Request exceeds {MAX_CHARS} chars.")
    inspect(req)
    body = {"state": req["state"], "questions": qs}
    try:
        out, how = via_server(body), "server"
    except Exception:
        out, how = via_cli(body), "cli"
    print(json.dumps({"engine": "gutsy", "via": how, "model": out.get("model"), "answers": out.get("answers", out)},
                     ensure_ascii=False, default=str))

if __name__ == "__main__": main()
