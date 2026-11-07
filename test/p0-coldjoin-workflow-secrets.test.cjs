'use strict';
// P0: the hotfix workflow calls the recurring cold-join canary as a reusable
// workflow. GitHub does NOT pass repository secrets automatically across a
// workflow_call. Explicitly forward ONLY the synthetic test license and PIN.
// This test never accesses or logs secret values; it checks YAML wiring only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const hotfix = fs.readFileSync(path.join(__dirname, '../.github/workflows/hotfix.yml'), 'utf8');
const live = fs.readFileSync(path.join(__dirname, '../.github/workflows/recorrido.yml'), 'utf8');

test('P0 cold-join: reusable workflow declares both optional synthetic secrets', () => {
  assert.match(live, /^  workflow_call:\s*\n    secrets:\s*\n      F123_CANARIO_LICENCIA:\s*\n        required: false\s*\n      F123_CANARIO_PIN:\s*\n        required: false/m,
    'a workflow_call must declare named synthetic secrets; a push event is NOT secret forwarding');
});

test('P0 cold-join: hotfix forwards ONLY the two synthetic secrets by exact name', () => {
  const marker = '\n  recorrido:\n';
  const index = hotfix.lastIndexOf(marker);
  assert.ok(index >= 0, 'reusable recorrido job exists in hotfix');
  // The job is last in hotfix.yml; avoid a multiline regex with '
  assert.match(body, /uses:\s*\.\/\.github\/workflows\/recorrido\.yml/, 'still calls same live recorrido workflow');
  assert.match(body, /secrets:\s*\n\s+F123_CANARIO_LICENCIA:\s*\$\{\{\s*secrets\.F123_CANARIO_LICENCIA\s*\}\}/,
    'cold-join synthetic test license must cross the workflow-call boundary');
  assert.match(body, /F123_CANARIO_PIN:\s*\$\{\{\s*secrets\.F123_CANARIO_PIN\s*\}\}/,
    'synthetic owner PIN must cross the workflow-call boundary');
  assert.doesNotMatch(body, /secrets:\s*inherit/, 'never pass all repository secrets');
});

test('P0 cold-join: never log synthetic credentials or treat missing license as PASS', () => {
  const script = fs.readFileSync(path.join(__dirname, '../scripts/canario-union-fria.cjs'), 'utf8');
  assert.match(script, /if \(!LICENCIA\) \{ console\.error\('CANARIO_CONFIG:[^']+'\); process\.exit\(2\); \}/);
  assert.match(script, /const diagnostico =/);
  assert.doesNotMatch(script, /console\.(?:log|error)\(\s*(?:LICENCIA|PIN)\s*\)/);
});
 that
  // would stop after needs: publicar and never inspect secrets/uses.
  const body = hotfix.slice(index + marker.length);
  assert.match(body, /uses:\s*\.\/\.github\/workflows\/recorrido\.yml/, 'still calls same live recorrido workflow');
  assert.match(body, /secrets:\s*\n\s+F123_CANARIO_LICENCIA:\s*\$\{\{\s*secrets\.F123_CANARIO_LICENCIA\s*\}\}/,
    'cold-join synthetic test license must cross the workflow-call boundary');
  assert.match(body, /F123_CANARIO_PIN:\s*\$\{\{\s*secrets\.F123_CANARIO_PIN\s*\}\}/,
    'synthetic owner PIN must cross the workflow-call boundary');
  assert.doesNotMatch(body, /secrets:\s*inherit/, 'never pass all repository secrets');
});

test('P0 cold-join: never log synthetic credentials or treat missing license as PASS', () => {
  const script = fs.readFileSync(path.join(__dirname, '../scripts/canario-union-fria.cjs'), 'utf8');
  assert.match(script, /if \(!LICENCIA\) \{ console\.error\('CANARIO_CONFIG:[^']+'\); process\.exit\(2\); \}/);
  assert.match(script, /const diagnostico =/);
  assert.doesNotMatch(script, /console\.(?:log|error)\(\s*(?:LICENCIA|PIN)\s*\)/);
});
