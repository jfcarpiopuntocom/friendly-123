'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('Fable C3: sale-lab release hygiene and independent benchmark deadline', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'p0-sale-speed-lab.yml'), 'utf8');
  assert.match(yml, /image: mcr\.microsoft\.com\/playwright@sha256:[a-f0-9]{64}/);
  assert.match(yml, /- uses: actions\/checkout@v4\s+with:\s+persist-credentials: false/);
  assert.match(yml, /- name: Benchmark 1, 300, and 1000 products \(no client data\)\s+timeout-minutes: 4\s+run:/);
  assert.match(yml, /- name: Chromium and Safari-WebKit two-tab atomic sales/);
});
