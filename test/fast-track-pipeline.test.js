const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { selectTests } = require('../scripts/pruebas-del-area.cjs');
test('focused selection retains smoke, new tests and helper dependants without unrelated tests', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'focused-area-'));
  const put = (file, value = '') => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), value); };
  try {
    put('test/business-read-model.test.js'); put('test/new.test.js'); put('test/unrelated.test.js');
    put('test/helpers/one.cjs', "require('./two.cjs')"); put('test/helpers/two.cjs');
    put('test/dependent.test.js', "require('./helpers/one.cjs')");
    assert.deepEqual(selectTests(['test/new.test.js', 'test/helpers/two.cjs', 'test/deleted.test.js'], root), ['test/business-read-model.test.js', 'test/dependent.test.js', 'test/new.test.js']);
    put('test/supabase-relay-transport.test.js'); put('test/supabase-relay-gateway.test.js');
    const selected = selectTests(['supabase-relay/gateway.mjs'], root);
    assert.ok(selected.includes('test/supabase-relay-gateway.test.js'));
    assert.ok(!selected.includes('test/unrelated.test.js'));
    fs.unlinkSync(path.join(root, 'test/supabase-relay-gateway.test.js'));
    assert.throws(() => selectTests(['supabase-relay/gateway.mjs'], root), /Missing mapped regression/);
    const sourceAreas = require('../scripts/test-source-areas.cjs');
    for (const tests of Object.values(sourceAreas)) for (const file of tests) put(file);
    put('test/incidental-ledger.test.js', '// payout-ledger.js is mentioned in unrelated prose');
    put('test/incidental-auth.test.js', '// auth-ui.js telemetry path, not an auth contract');
    for (const source of Object.keys(sourceAreas)) {
      const exact = selectTests([source], root);
      for (const test of sourceAreas[source]) assert.ok(exact.includes(test), `contract retained: ${test}`);
      assert.ok(!exact.includes('test/incidental-ledger.test.js'));
      assert.ok(!exact.includes('test/incidental-auth.test.js'));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('hotfix hands off tested SHA after promotion; broad regression cannot duplicate deployment', () => {
  const workflow = n => fs.readFileSync(path.join(__dirname, '../.github/workflows', n + '.yml'), 'utf8');
  const hotfix = workflow('hotfix'), publish = workflow('publicar'), broad = workflow('release-control');
  assert.doesNotMatch(publish, /^  workflow_run:/m);
  assert.match(publish, /^  workflow_dispatch:/m); assert.match(publish, /^  workflow_call:/m);
  assert.match(hotfix, /if: needs\.probar-y-mover\.outputs\.candidate != ''/);
  assert.match(hotfix, /candidate: \$\{\{ needs\.probar-y-mover\.outputs\.candidate \}\}/);
  assert.ok(hotfix.indexOf('git push --atomic') < hotfix.indexOf('echo "candidate=$GITHUB_SHA"'));
  assert.match(publish, /node scripts\/release-candidate\.cjs "\$EXPECT_CANDIDATE" "\$STABLE"/);
  assert.match(publish.replace(/\r\n/g, '\n'), /elif \[ -n "\$EXPECT_CANDIDATE" \]; then\n\s*#.*\n\s*CANDIDATE="\$EXPECT_CANDIDATE"/);
  assert.ok(publish.indexOf('CANDIDATE="$EXPECT_CANDIDATE"') < publish.indexOf('elif [ "$QA" = "true" ]'));
  assert.match(publish, /EXPECT_STABLE/); assert.match(publish, /EXPECT_PREVIOUS/);
  // v594: hotfix moved to the same version-matched official Playwright image as the broad gate
  // (run 40504468263 stalled on apt in install-deps). Same contract, asserted for both workflows.
  const pinnedHotfix = require('../package-lock.json').packages['node_modules/playwright'].version;
  assert.ok(hotfix.includes('image: mcr.microsoft.com/playwright:v' + pinnedHotfix + '-noble'));
  assert.doesNotMatch(hotfix, /npx playwright install-deps/);
  assert.match(hotfix, /npm ci/);
  // The full release gate now uses browsers already installed in a version-matched
  // official Playwright image. Assert THAT contract, not the obsolete cache layout.
  const pinned = require('../package-lock.json').packages['node_modules/playwright'].version;
  assert.ok(broad.includes('image: mcr.microsoft.com/playwright:v' + pinned + '-noble'));
  assert.match(broad, /npm ci/);
  assert.doesNotMatch(broad, /npx playwright install-deps/);
});
test('publication rejects a moved or malformed candidate and preserves explicit recovery', () => {
  const { assertStableCandidate } = require('../scripts/release-candidate.cjs');
  const tested = 'a'.repeat(40), advanced = 'b'.repeat(40);
  assert.equal(assertStableCandidate(tested, tested), tested);
  assert.equal(assertStableCandidate('', advanced), advanced);
  assert.throws(() => assertStableCandidate(tested, advanced), /Stable changed/);
  assert.throws(() => assertStableCandidate('HEAD', tested), /refusing/);
  assert.throws(() => assertStableCandidate('', 'master'), /Invalid stable/);
});
test('ready environment reuses browser/server but isolates storage and blocks outbound requests', async () => {
  const { readyEnvironment } = require('./helpers/ready-environment.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-environment-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>Synthetic fixture</title>');
  let env;
  try {
    env = await readyEnvironment({ root });
    const first = await env.context(); const a = await first.newPage();
    await a.goto(env.origin); await a.evaluate(() => { localStorage.setItem('synthetic', 'first'); document.cookie = 'synthetic=first'; });
    const second = await env.context(); const b = await second.newPage(); await b.goto(env.origin);
    assert.equal(await b.evaluate(() => localStorage.getItem('synthetic')), null);
    assert.equal(await b.evaluate(() => document.cookie), '');
    assert.equal(await b.evaluate(() => fetch('https://example.invalid/fixture').then(() => 'escaped', () => 'blocked')), 'blocked');
    assert.equal(await a.evaluate(() => localStorage.getItem('synthetic')), 'first');
    await first.close(); await second.close();
  } finally { if (env) await env.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
