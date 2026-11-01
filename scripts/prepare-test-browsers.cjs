#!/usr/bin/env node
'use strict';
// Developer/CI machines only. NEVER loaded by docs/, customer PWA or production.
// Install only the Playwright browser binaries missing for this package's pinned version.
// Respects PLAYWRIGHT_BROWSERS_PATH (e.g. D:\\ms-playwright on Windows).
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium, webkit } = require('playwright');

// Windows browser tests default to Chromium; WebKit remains a required CI/Linux gate.
// Opt-in F123_REQUIRE_WEBKIT=1 only on machines that actually run both engines.
const engines = process.env.F123_REQUIRE_WEBKIT === '1' ? { chromium, webkit } : { chromium };
const missing = Object.entries(engines).filter(([, engine]) => {
  const executable = engine.executablePath();
  return !executable || !fs.existsSync(executable);
}).map(([name]) => name);

if (!missing.length) {
  console.log('Playwright: required test browser binaries already installed; no download.');
  process.exit(0);
}
const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
if (!fs.existsSync(cli)) throw new Error('Pinned local Playwright CLI is missing; run npm ci first.');
console.log('Playwright: installing only missing test browsers:', missing.join(', '));
const child = spawnSync(process.execPath, [cli, 'install', ...missing], {
  stdio: 'inherit',
  env: process.env,
  windowsHide: true,
  timeout: 420000
});
if (child.error) throw child.error;
if (child.status !== 0) process.exit(child.status || 1);
for (const name of missing) {
  if (!fs.existsSync(engines[name].executablePath())) {
    throw new Error('Playwright installation did not produce the expected ' + name + ' executable at ' + engines[name].executablePath());
  }
}
console.log('Playwright browser preflight: PASS.');
