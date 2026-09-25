/* Recovery authorization is issued only by the existing private license-panel
   credential. Synthetic fixtures; no live Worker, customer data or real keys. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'cloudflare-worker', 'worker.js')).href);
function limiter(max) {
  const counts = new Map();
  return { async limit({ key }) { const n = (counts.get(key) || 0) + 1; counts.set(key, n); return { success: n <= max }; } };
}
function fixture() {
  const records = new Map([['inst:fixture-device', JSON.stringify({ instanceId: 'fixture-device', estado: 'full' })]]);
  return { MASTER_KEY: 'synthetic-panel-key-only',
    LICENCIAS: { async get(k) { return records.get(k) || null; } },
    MAESTRO_IP: limiter(20), MAESTRO_INST: limiter(2) };
}
async function post(worker, env, route, body, key = '') {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.17' };
  if (key) headers['X-Master-Key'] = key;
  const response = await worker.default.fetch(new Request(`https://fixture.invalid${route}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  }), env, { waitUntil() {} });
  return { status: response.status, data: await response.json() };
}

test('only panel credential issues a scoped, expiring recovery token', async () => {
  const worker = await load();
  const env = fixture();
  const denied = await post(worker, env, '/maestro/emitir', { instanceId: 'fixture-device' });
  assert.equal(denied.status, 401);
  const issued = await post(worker, env, '/maestro/emitir', { instanceId: 'fixture-device' }, env.MASTER_KEY);
  assert.equal(issued.status, 200);
  assert.equal(typeof issued.data.token, 'string');
  assert.ok(issued.data.token.length > 40);
  assert.ok(!JSON.stringify(issued.data).includes(env.MASTER_KEY));
  const verified = await post(worker, env, '/maestro/verificar', { instanceId: 'fixture-device', token: issued.data.token });
  assert.deepEqual(verified.data, { ok: true });
  assert.ok(!JSON.stringify(verified.data).includes(env.MASTER_KEY));
  const other = await post(worker, env, '/maestro/verificar', { instanceId: 'other-device', token: issued.data.token });
  assert.equal(other.data.ok, false);
});

test('tampered and expired tokens fail closed without revealing signing material', async () => {
  const worker = await load();
  const env = fixture();
  const issued = await post(worker, env, '/maestro/emitir', { instanceId: 'fixture-device' }, env.MASTER_KEY);
  assert.equal(issued.status, 200);
  const token = issued.data.token;
  /* 2026-09-25: antes se alteraba el ULTIMO caracter. En base64 ese caracter lleva
     2 bits de relleno: si era A-D, cambiarlo por A/B no cambiaba ningun byte y el
     token seguia valido (medido: 26 de 400 = 6.5 % de corridas rojas sin bug real).
     Ahora se altera el MEDIO de la firma, que siempre cambia bytes. Mas estricto. */
  const _d = token.lastIndexOf('.'); const _i = _d + 1 + Math.floor((token.length - _d - 1) / 2);
  const tampered = await post(worker, env, '/maestro/verificar', { instanceId: 'fixture-device', token: token.slice(0, _i) + (token[_i] === 'A' ? 'B' : 'A') + token.slice(_i + 1) });
  assert.equal(tampered.data.ok, false);
  const realNow = Date.now;
  Date.now = () => realNow() + 10 * 60 * 1000;
  try {
    const expired = await post(worker, env, '/maestro/verificar', { instanceId: 'fixture-device', token });
    assert.equal(expired.data.ok, false);
  } finally { Date.now = realNow; }
});

test('verification attempts are bounded independently by device and IP', async () => {
  const worker = await load();
  const env = fixture();
  const invalid = { instanceId: 'fixture-device', token: 'not-a-token' };
  assert.equal((await post(worker, env, '/maestro/verificar', invalid)).data.ok, false);
  assert.equal((await post(worker, env, '/maestro/verificar', invalid)).data.ok, false);
  const limited = await post(worker, env, '/maestro/verificar', invalid);
  assert.equal(limited.status, 429);
  assert.equal(limited.data.ok, false);
});
