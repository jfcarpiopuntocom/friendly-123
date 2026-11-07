'use strict';
// P0: explicitly forward ONLY synthetic canary secrets through workflow_call.
// This test inspects static YAML wiring; it never reads credential values.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const hotfix = fs.readFileSync(path.join(__dirname, '../.github/workflows/hotfix.yml'), 'utf8');
const live = fs.readFileSync(path.join(__dirname, '../.github/workflows/recorrido.yml'), 'utf8');

test('P0 cold-join: reusable workflow declares optional synthetic secrets', () => {
  assert.match(live,
    /^  workflow_call:\s*\n    secrets:\s*\n      F123_CANARIO_LICENCIA:\s*\n        required: false\s*\n      F123_CANARIO_PIN:\s*\n        required: false/m,
    'a workflow_call must declare explicitly named synthetic secrets');
});

test('P0 cold-join: hotfix forwards exactly the two synthetic secrets', () => {
  const marker = '\n  recorrido:\n';
  const index = hotfix.lastIndexOf(marker);
  assert.ok(index >= 0, 'hotfix.yml must include the reusable recorrido job');
  const job = hotfix.slice(index + marker.length);
  assert.match(job, /uses:\s*\.\/\.github\/workflows\/recorrido\.yml/);
  assert.match(job,
    /secrets:\s*\n\s+F123_CANARIO_LICENCIA:\s*\$\{\{\s*secrets\.F123_CANARIO_LICENCIA\s*\}\}/);
  assert.match(job,
    /F123_CANARIO_PIN:\s*\$\{\{\s*secrets\.F123_CANARIO_PIN\s*\}\}/);
  assert.doesNotMatch(job, /secrets:\s*inherit/, 'no broad access to other secrets');
});

test('P0 cold-join: missing license still fails closed and no credentials are logged', () => {
  const script = fs.readFileSync(path.join(__dirname, '../scripts/canario-union-fria.cjs'), 'utf8');
  assert.match(script,
    /if \(!LICENCIA\) \{ console\.error\('CANARIO_CONFIG:[^']+'\); process\.exit\(2\); \}/);
  assert.match(script, /const diagnostico =/);
  assert.doesNotMatch(script, /console\.(?:log|error)\(\s*(?:LICENCIA|PIN)\s*\)/);
});
