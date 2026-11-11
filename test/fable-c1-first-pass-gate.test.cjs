'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
for (const filename of ['release-control.yml','hotfix.yml']) {
  test('Fable C1: ' + filename + ' rejects first-pass RED even if isolated retry passes', () => {
    const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', filename), 'utf8');
    const lines = yml.split(/\r?\n/);
    const marker = '"$' + '{FAILED[@]}"';
    const isolated = lines.findIndex(line => line.includes('--test-concurrency=1') && line.includes(marker));
    assert.notEqual(isolated, -1, 'isolated retry must remain only for diagnostics');
    const indent = lines[isolated].match(/^\s*/)[0];
    const next = lines.slice(isolated + 1, isolated + 5);
    assert.ok(next.some(l => l.includes('First-attempt regression was RED')), 'red must remain visible');
    assert.ok(next.some(l => l === indent + 'exit 1'), 'first-pass red must cause nonzero exit');
    assert.ok(yml.includes('set -euo pipefail'), 'shell must honor errors');
  });
}
