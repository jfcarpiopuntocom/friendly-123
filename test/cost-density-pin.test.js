const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('relay avoids per-operation table scans and indexes catch-up cursor', () => {
  const relay = read('cloudflare-sync-relay/worker.js');
  assert.match(relay, /CREATE INDEX IF NOT EXISTS ops_lam ON ops\(lam\)/);
  assert.doesNotMatch(relay, /SELECT COUNT\(\*\) AS n FROM ops/);
  assert.match(relay, /_opsDesdePoda >= 256/);
});

test('dashboard coalesces live refreshes and reconnects with capped backoff', () => {
  const dash = read('docs/dashboard.html');
  assert.match(dash, /fotoTimer = setTimeout\(pedirFoto, 120\)/);
  assert.match(dash, /reconexionMs = Math\.min\(30000, reconexionMs \* 2\)/);
  assert.match(dash, /function recibirTrozo[\s\S]*reconexionMs = 1500/);
});

test('888 remains a protected owner PIN while demo stays 456', () => {
  const crypto = read('docs/crypto-store.js');
  const backend = read('docs/mock-backend.js');
  const auth = read('docs/auth-ui.js');
  assert.match(crypto, /eq\.owner !== "888"/);
  assert.match(crypto, /eq\.owner = "888"/);
  assert.match(backend, /_libre\(eq\.owner, "789"\)/);
  assert.doesNotMatch(backend, /_libre\(eq\.owner, "888"\)/);
  assert.match(auth, /const DEMO_PIN = "456"/);
});

test('mobile interior uses dense two-column cards without shrinking Safari inputs', () => {
  const app = read('docs/index.html');
  assert.match(app, /minmax\(155px,1fr\)/);
  assert.match(app, /input, select, textarea\{ font-size:16px !important; \}/);
  assert.match(app, /\.caja\{padding:10px/);
});
