const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = name => fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', name), 'utf8');

test('a stale emergency PUSH cannot bypass a new candidate 33-minute window', () => {
  const yml = workflow('promover.yml');
  assert.match(yml, /PUSH_DESDE=\$\(\( \$\(date -d "\$INICIO" \+%s\) \* 1000 \)\)/);
  assert.match(yml, /\[ "\$AT" -lt "\$\{PUSH_DESDE:-0\}" \]/);
  assert.match(yml, /FIN=\$\(\( \$\(date -d "\$INICIO" \+%s\) \+ 33 \* 60 \)\)/);
});

test('Sonar cannot replay an earlier PUSH against a newer master commit', () => {
  const yml = workflow('sonar.yml');
  assert.match(yml, /MASTER_COMMIT_MS=\$\(\( \$\(git show -s --format=%ct origin\/master\) \* 1000 \)\)/);
  assert.match(yml, /\[ "\$AT" -lt "\$MASTER_COMMIT_MS" \]/);
  assert.match(yml, /if \[ "\$ACCION" = "push" \]/);
});

test('automatic promotion requires exact public canary proof', () => {
  const yml = workflow('promover.yml');
  assert.match(yml, /node scripts\/release-control\.cjs published "\$GITHUB_SHA"/);
  assert.match(yml, /CANARIO SIN PRUEBA PUBLICA DEL SHA EXACTO/);
});
