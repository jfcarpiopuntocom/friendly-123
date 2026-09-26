#!/usr/bin/env node

const ENDPOINT = "https://ai-gateway.vercel.sh/typesafe/v1/systemone";
const MODEL = "typesafe-ai/jev";
const MAX_CHARS = 12_000;
const MAX_QUESTIONS = 20;
const TIMEOUT_MS = 8_000;
const FORBIDDEN_KEY = /(?:password|passwd|secret|token|api.?key|pin|license|credential|cookie|authorization)/i;
const FORBIDDEN_VALUE = /(?:\bvck_[A-Za-z0-9_-]{12,}|\bsk-[A-Za-z0-9_-]{12,}|\bgh[opusr]_[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})/i;

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function inspect(value, path = "request") {
  if (typeof value === "string") {
    if (FORBIDDEN_VALUE.test(value)) fail(`Refusing credential-like value at ${path}.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspect(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) fail(`Refusing sensitive field ${path}.${key}.`);
      inspect(item, `${path}.${key}`);
    }
  }
}

function validate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Request must be a JSON object.");
  if (!("state" in input)) fail("Request.state is required.");
  if (!input.questions || typeof input.questions !== "object" || Array.isArray(input.questions)) fail("Request.questions must be an object.");
  const entries = Object.entries(input.questions);
  if (!entries.length || entries.length > MAX_QUESTIONS) fail(`Use 1-${MAX_QUESTIONS} questions per call.`);
  const serialized = JSON.stringify(input);
  if (serialized.length > MAX_CHARS) fail(`Request exceeds the ${MAX_CHARS}-character local cap.`);
  inspect(input);
  return { model: MODEL, state: input.state, questions: input.questions };
}

if (process.argv.includes("--self-test")) {
  validate({ state: { public_context: "ok" }, questions: { safe: { type: "noul", instructions: "Is this safe?" } } });
  process.stdout.write(JSON.stringify({ ok: true, model: MODEL, maxChars: MAX_CHARS, maxQuestions: MAX_QUESTIONS, retries: 0 }) + "\n");
  process.exit(0);
}

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
let input;
try { input = JSON.parse(raw); } catch { fail("stdin must contain valid JSON."); }
const body = validate(input);
const apiKey = process.env.AI_GATEWAY_API_KEY;
if (!apiKey) fail("AI_GATEWAY_API_KEY is not available in this process.");

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
try {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  const responseText = await response.text();
  if (!response.ok) fail(`Jev request failed with HTTP ${response.status}: ${responseText.slice(0, 600)}`, 2);
  let result;
  try { result = JSON.parse(responseText); } catch { fail("Jev returned non-JSON output.", 2); }
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  if (error?.name === "AbortError") fail(`Jev timed out after ${TIMEOUT_MS}ms; no retry was attempted.`, 2);
  fail(`Jev request failed; no retry was attempted: ${error?.message || error}`, 2);
} finally {
  clearTimeout(timer);
}
