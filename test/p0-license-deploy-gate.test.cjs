'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const WORKFLOW_PATH = path.join(ROOT, '.github', 'workflows', 'desplegar-licencias.yml');
const WRANGLER_PATH = path.join(ROOT, 'cloudflare-worker', 'wrangler.toml');

const workflow = fs.readFileSync(WORKFLOW_PATH, 'utf8');
const wrangler = fs.readFileSync(WRANGLER_PATH, 'utf8');

test('desplegar-licencias.yml never triggers automatic deploy on push and gates deploy on workflow_dispatch + verify', () => {
  assert.doesNotMatch(workflow, /^\s*push:\s*$/m, 'obsolete push trigger must be removed so no push can auto-deploy');
  assert.doesNotMatch(workflow, /APPROVED-SINGLE-PIN-DEPLOY-20261031/, 'obsolete one-off Oct 31 deploy gate must be removed');
  assert.match(workflow, /^\s*workflow_dispatch:\s*$/m, 'manual workflow_dispatch trigger required');
  assert.match(workflow, /^\s*pull_request:\s*$/m, 'pull_request trigger required to run dry verify gate without secrets');
  assert.match(workflow, /^\s*verify:\s*$/m, 'dedicated verify job required');
  assert.match(workflow, /^\s*deploy:\s*$/m, 'dedicated deploy job required');
  assert.match(workflow, /needs:\s*verify\b/, 'deploy job must require verify job');
  assert.match(
    workflow,
    /if:\s*github\.event_name == 'workflow_dispatch' && inputs\.worker_name == 'friendly123-licencias'/,
    'deploy must only run on explicit workflow_dispatch naming friendly123-licencias'
  );
});

test('desplegar-licencias.yml checks syntax of all 8 license/PIN/team/WS Worker modules', () => {
  const modules = [
    'cloudflare-worker/worker.js',
    'cloudflare-worker/pin-authority.mjs',
    'cloudflare-worker/pin-worker-api.mjs',
    'cloudflare-worker/team-authority.mjs',
    'cloudflare-worker/team-worker-api.mjs',
    'cloudflare-worker/ws-authorized-subject.mjs',
    'cloudflare-worker/ws-capability-issuer.mjs',
    'cloudflare-worker/ws-worker-api.mjs'
  ];
  for (const mod of modules) {
    assert.ok(fs.existsSync(path.join(ROOT, mod)), `expected module to exist: ${mod}`);
    assert.ok(workflow.includes(mod), `verify gate must syntax-check ${mod}`);
  }
});

test('desplegar-licencias.yml executes full synthetic license, PIN and /ws/ticket test suite before deploy', () => {
  const requiredSuites = [
    'test/p0-license-deploy-gate.test.cjs',
    'test/panel-durable-object.test.js',
    'test/worker-checkin.test.js',
    'test/worker-licencia-pagada.test.js',
    'test/worker-lotes-pagos.test.js',
    'test/worker-master-recovery.test.js',
    'test/worker-recover-pin.test.js',
    'test/worker-sonar.test.js',
    'test/worker-soporte-jfc.test.js',
    'test/p0-central-pin-authority.test.mjs',
    'test/p0-central-pin-worker-entry.test.mjs',
    'test/p0-central-pin-legacy-offline-guard.test.cjs',
    'test/p0-ws-authorized-subject.test.mjs',
    'test/p0-ws-capability-issuer.test.mjs',
    'test/p0-ws-worker-api.test.mjs'
  ];
  for (const suite of requiredSuites) {
    assert.ok(fs.existsSync(path.join(ROOT, suite)), `expected test file to exist: ${suite}`);
    assert.ok(workflow.includes(suite), `verify gate must run ${suite}`);
  }
});

test('desplegar-licencias.yml dry-run verifies exact Worker name, KV ID and all 4 required bindings', () => {
  assert.ok(workflow.includes('wrangler deploy --config ./wrangler.toml --dry-run'), 'must execute wrangler dry-run');
  for (const token of [
    'friendly123-licencias',
    'env.LICENCIAS',
    'f1599c69c4174cc2b38dd125c18ee3df',
    'env.REGISTROS',
    'env.MAESTRO_IP',
    'env.MAESTRO_INST'
  ]) {
    assert.ok(workflow.includes(token), `dry-run verification must assert ${token}`);
  }
});

test('cloudflare-worker/wrangler.toml preserves top-level LICENCIAS binding, no preview_urls and required secrets', () => {
  assert.match(wrangler, /^name\s*=\s*"friendly123-licencias"/m);
  assert.match(wrangler, /^preview_urls\s*=\s*false/m);
  const kvIdx = wrangler.indexOf('kv_namespaces');
  const secretsIdx = wrangler.indexOf('[secrets]');
  assert.ok(kvIdx > -1 && secretsIdx > -1 && kvIdx < secretsIdx, 'kv_namespaces must remain ABOVE [secrets] table');
  assert.ok(wrangler.includes('f1599c69c4174cc2b38dd125c18ee3df'), 'exact LICENCIAS KV namespace id required');
  assert.match(wrangler, /required\s*=\s*\[\s*"MASTER_KEY"\s*,\s*"PIN_PEPPER"\s*\]/);
});
