/* v658 (Directiva Prima 2): a licence issued before batch provisioning gets its Supabase room the first time a registered
   device checks in, once, in the background. Synthetic KV, fake Supabase RPC, no network, no real credentials. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function kvFalsa() {
  const store = new Map();
  return {
    store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, String(value)); },
    async delete(key) { store.delete(key); },
    async list({ prefix = "" } = {}) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; },
  };
}
const cargarWorker = () => import(pathToFileURL(path.join(__dirname, '..', 'cloudflare-worker', 'worker.js')).href);
const entorno = () => ({ LICENCIAS: kvFalsa(), MASTER_KEY: 'fixture-master-key-not-real',
  SUPABASE_ORIGIN: 'https://abcdefghijabcdefghij.supabase.co', RELAY_PROVISION_SECRET: 'a'.repeat(64), SUPABASE_PUBLISHABLE_KEY: 'fixture-publishable' });

async function checkin(worker, env, body) {
  const pend = [];
  const req = new Request('https://fixture.invalid/checkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const r = await worker.default.fetch(req, env, { waitUntil(p) { pend.push(p); } });
  await Promise.all(pend);
  return r;
}

test('v658: first check-in of a licence provisions its Supabase room once; later check-ins do not call again', async () => {
  const worker = await cargarWorker(), env = entorno(), real = globalThis.fetch, llamadas = [];
  globalThis.fetch = async (url, opt) => { llamadas.push(String(url)); return new Response(JSON.stringify({ ok: true, ready: 0, created: 1, migrationRequired: 0 }), { status: 200 }); };
  try {
    const body = { instanceId: 'fixture-relay-device', accion: 'login', licenseCode: 'F123-FIXTURE-RELA' };
    assert.equal((await checkin(worker, env, body)).status, 200);
    assert.equal(llamadas.filter(u => u.endsWith('/rest/v1/rpc/f123_relay_provision')).length, 1, 'provisioned once');
    assert.equal(env.LICENCIAS.store.get('relay-sala:F123-FIXTURE-RELA'), 'ok');
    await checkin(worker, env, body);
    assert.equal(llamadas.length, 1, 'remembered: no second RPC');
  } finally { globalThis.fetch = real; }
});

test('v658: Supabase unreachable never blocks the check-in and is retried later (nothing remembered)', async () => {
  const worker = await cargarWorker(), env = entorno(), real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network down'); };
  try {
    const r = await checkin(worker, env, { instanceId: 'fixture-relay-device2', accion: 'login', licenseCode: 'F123-FIXTURE-RELB' });
    assert.equal(r.status, 200, 'check-in still succeeds');
    assert.equal(env.LICENCIAS.store.has('relay-sala:F123-FIXTURE-RELB'), false, 'retry on a later check-in');
  } finally { globalThis.fetch = real; }
});
