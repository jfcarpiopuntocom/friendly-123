/* v349 — "Aparato JFC": JFC marca desde su panel qué aparatos son suyos
   (soporte). La marca debe sobrevivir a cada login y viajar al aparato.
   Fixtures sintéticos; sin Worker vivo ni datos reales. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = () => import(pathToFileURL(path.join(__dirname, '..', 'cloudflare-worker', 'worker.js')).href);

function env() {
  const kv = new Map([['inst:fixture-jfc-device', JSON.stringify({ instanceId: 'fixture-jfc-device', licenseCode: 'F123-SYNTH-JFCX-0001', estado: 'minima' })]]);
  return { MASTER_KEY: 'synthetic-panel-key-only', _kv: kv,
    LICENCIAS: { async get(k) { return kv.get(k) || null; }, async put(k, v) { kv.set(k, v); },
      async delete(k) { kv.delete(k); }, async list() { return { keys: [], list_complete: true }; } } };
}
async function post(w, e, route, body, key) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.18' };
  if (key) headers['X-Master-Key'] = key;
  const r = await w.default.fetch(new Request('https://fixture.invalid' + route, { method: 'POST', headers, body: JSON.stringify(body) }), e, { waitUntil() {} });
  return { status: r.status, data: await r.json() };
}
const checkin = (w, e) => post(w, e, '/checkin', { instanceId: 'fixture-jfc-device', licenseCode: 'F123-SYNTH-JFCX-0001', accion: 'login' });

test('only the panel credential can mark a device as JFC', async () => {
  const w = await load(), e = env();
  assert.equal((await post(w, e, '/licencias/fixture-jfc-device/soporte', { soporte: true })).status, 401);
  assert.equal((await post(w, e, '/licencias/fixture-jfc-device/soporte', { soporte: 'si' }, e.MASTER_KEY)).status, 400);
});

test('the mark survives every login and reaches the device; removing it travels too', async () => {
  const w = await load(), e = env();
  const antes = await checkin(w, e);
  assert.equal('soporte' in antes.data, false, 'sin marca, el aparato no recibe nada (los ya marcados no se tocan)');
  assert.equal((await post(w, e, '/licencias/fixture-jfc-device/soporte', { soporte: true }, e.MASTER_KEY)).data.ok, true);
  assert.equal((await checkin(w, e)).data.soporte, true, 'llega en el login');
  assert.equal((await checkin(w, e)).data.soporte, true, 'y sigue en el siguiente: el checkin no la borra');
  await post(w, e, '/licencias/fixture-jfc-device/soporte', { soporte: false }, e.MASTER_KEY);
  assert.equal((await checkin(w, e)).data.soporte, false, 'quitar la marca también viaja');
});

// v350: "A mi licencia principal". La licencia principal es un secret del
// Worker (LORD_LICENSE); aquí una sintética.
test('"A mi licencia" re-points a loose device to the owner main license, only with the panel key', async () => {
  const w = await load(), e = env();
  e.LORD_LICENSE = 'F123-SYNTH-MAIN-0000-00000';
  assert.equal((await post(w, e, '/licencias/fixture-jfc-device/a-principal', {})).status, 401);
  const ok = await post(w, e, '/licencias/fixture-jfc-device/a-principal', {}, e.MASTER_KEY);
  assert.equal(ok.data.ok, true);
  assert.ok(!JSON.stringify(ok.data).includes('F123-SYNTH-MAIN'), 'la licencia principal no se devuelve');
  assert.equal(JSON.parse(e._kv.get('inst:fixture-jfc-device')).licenseCode, 'F123-SYNTH-MAIN-0000-00000');
  assert.ok(e._kv.get('hist:fixture-jfc-device'), 'reversible: el estado anterior queda en el historial');
});

test('"A mi licencia" refuses to run when the Worker has no main license configured', async () => {
  const w = await load(), e = env();
  assert.equal((await post(w, e, '/licencias/fixture-jfc-device/a-principal', {}, e.MASTER_KEY)).status, 503);
  assert.equal(JSON.parse(e._kv.get('inst:fixture-jfc-device')).licenseCode, 'F123-SYNTH-JFCX-0001', 'nada cambió');
});
