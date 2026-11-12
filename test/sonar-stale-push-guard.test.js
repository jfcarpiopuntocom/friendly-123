const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflow = name => fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', name), 'utf8');

test('Sonar cannot replay an earlier PUSH against a newer master commit', () => {
  const yml = workflow('sonar.yml');
  assert.match(yml, /MASTER_COMMIT_MS=\$\(\( \$\(git show -s --format=%ct origin\/master\) \* 1000 \)\)/);
  assert.match(yml, /\[ "\$AT" -lt "\$MASTER_COMMIT_MS" \]/);
  assert.match(yml, /if \[ "\$ACCION" = "push" \]/);
});

