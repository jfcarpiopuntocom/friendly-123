/* Lotes de licencias + registro de pagos en el Worker (JFC 2026-09-24).
   Escala 1.000-10.000 licencias por gremios: un lote emite N codigos con
   etiqueta y prefijo; el primer aparato que entra con uno hereda "full" solo.
   Un pago es un asiento append-only por licencia y deja pagoResumen en el
   aparato para que el listado no lea de mas. KV en memoria, credencial
   sintetica, sin tocar el Worker publicado. Feature nueva (no bug). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MASTER = 'fixture-master-key-not-real';
function kv() {
  const store = new Map();
  return { store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { store.set(k, String(v)); },
    async delete(k) { store.delete(k); },
    async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })) }; } };
}
const cargar = () => import(pathToFileURL(path.join(__dirname, '..', 'cloudflare-worker', 'worker.js')).href);
const env = () => ({ LICENCIAS: kv(), MASTER_KEY: MASTER });
const H = { 'Content-Type': 'application/json', 'X-Master-Key': MASTER };
const call = (w, e, p, method, body, headers = H) => w.default.fetch(new Request('https://fixture.invalid' + p, { method, headers, body: body ? JSON.stringify(body) : undefined }), e);
async function checkin(w, e, instanceId, licenseCode) {
  const r = await call(w, e, '/checkin', 'POST', { instanceId, accion: 'login', licenseCode }, { 'Content-Type': 'application/json' });
  assert.equal(r.status, 200, 'checkin ' + instanceId);
  return JSON.parse(await e.LICENCIAS.get('inst:' + instanceId));
}

test('emitir un lote: N codigos con prefijo y formato F123, guardados como lic: y en lote:', async () => {
  const w = await cargar(); const e = env();
  const r = await call(w, e, '/licencias/lote', 'POST', { etiqueta: 'Gremio Test', cantidad: 25, prefijo: 'tst' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.emitidos, 25);
  assert.equal(j.codigos.length, 25);
  assert.equal(new Set(j.codigos).size, 25, 'sin repetidos');
  for (const c of j.codigos) {
    assert.match(c, /^F123-TST[A-Z2-9]-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{5}$/, c);
    assert.doesNotMatch(c.slice(5), /[01IO]/, 'sin caracteres ambiguos despues del F123- fijo');
    const lic = JSON.parse(await e.LICENCIAS.get('lic:' + c));
    assert.equal(lic.estado, 'full');
    assert.equal(lic.lote, 'Gremio Test');
  }
  const lotes = await (await call(w, e, '/lotes', 'GET')).json();
  assert.equal(lotes.length, 1);
  assert.equal(lotes[0].total, 25);
  // Segundo lote con la misma etiqueta se acumula, no pisa.
  await call(w, e, '/licencias/lote', 'POST', { etiqueta: 'Gremio Test', cantidad: 5, prefijo: 'TST' });
  assert.equal((await (await call(w, e, '/lotes', 'GET')).json())[0].total, 30);
});

test('lote: sin master key 401; cantidad 0 o 501 y etiqueta rara 400', async () => {
  const w = await cargar(); const e = env();
  assert.equal((await call(w, e, '/licencias/lote', 'POST', { etiqueta: 'x y', cantidad: 3 }, { 'Content-Type': 'application/json' })).status, 401);
  assert.equal((await call(w, e, '/licencias/lote', 'POST', { etiqueta: 'Gremio', cantidad: 0 })).status, 400);
  assert.equal((await call(w, e, '/licencias/lote', 'POST', { etiqueta: 'Gremio', cantidad: 501 })).status, 400);
  assert.equal((await call(w, e, '/licencias/lote', 'POST', { etiqueta: '<script>', cantidad: 3 })).status, 400);
  assert.equal((await call(w, e, '/lotes', 'GET', null, {})).status, 401);
});

test('el primer aparato que entra con un codigo del lote hereda "full" sin tocar el panel', async () => {
  const w = await cargar(); const e = env();
  const j = await (await call(w, e, '/licencias/lote', 'POST', { etiqueta: 'Asociacion', cantidad: 2, prefijo: 'TEST' })).json();
  const reg = await checkin(w, e, 'device-lote-000001', j.codigos[0]);
  assert.equal(reg.estado, 'full');
  const otro = await checkin(w, e, 'device-lote-000002', 'F123-TEST-XXXX-XXXX-XXXXX');
  assert.equal(otro.estado, 'minima', 'un codigo que no es del lote sigue en minima');
});

test('registrar pagos: asientos append-only, resumen en el aparato, licencia pasa a full; correccion negativa', async () => {
  const w = await cargar(); const e = env();
  const reg0 = await checkin(w, e, 'device-pago-000001', 'F123-TEST-AAAA-BBBB-CCCCC');
  assert.equal(reg0.estado, 'minima');
  const r1 = await call(w, e, '/licencias/device-pago-000001/pagos', 'POST', { monto: 399, moneda: 'usd', medio: 'transferencia', referencia: 'TRX-1', hasta: '2031-09-24', nota: 'pago completo' });
  assert.equal(r1.status, 200);
  const j1 = await r1.json();
  assert.equal(j1.resumen.n, 1);
  assert.equal(j1.resumen.total, 399);
  assert.equal(j1.resumen.hasta, '2031-09-24');
  const reg1 = JSON.parse(await e.LICENCIAS.get('inst:device-pago-000001'));
  assert.equal(reg1.estado, 'full', 'pagar marca full');
  assert.equal(reg1.estadoFijadoPanel, true);
  assert.deepEqual(reg1.pagoResumen.n, 1);
  const lic = JSON.parse(await e.LICENCIAS.get('lic:F123-TEST-AAAA-BBBB-CCCCC'));
  assert.equal(lic.estado, 'full');
  // Un segundo aparato de la misma licencia hereda full en su checkin.
  const reg2 = await checkin(w, e, 'device-pago-000002', 'F123-TEST-AAAA-BBBB-CCCCC');
  assert.equal(reg2.estado, 'full');
  // Correccion: asiento negativo, nunca se edita el anterior.
  const r2 = await call(w, e, '/licencias/device-pago-000001/pagos', 'POST', { monto: -100, medio: 'otro', nota: 'reembolso parcial' });
  const j2 = await r2.json();
  assert.equal(j2.pagos.length, 2);
  assert.equal(j2.pagos[0].monto, 399, 'el primer asiento sigue intacto');
  assert.equal(j2.resumen.total, 299);
  const lista = await (await call(w, e, '/licencias/device-pago-000001/pagos', 'GET')).json();
  assert.equal(lista.pagos.length, 2);
  assert.equal(lista.codigo, 'F123-TEST-AAAA-BBBB-CCCCC');
});

test('pagos: monto 0 o texto 400; aparato inexistente 404; sin licencia 400; sin key 401', async () => {
  const w = await cargar(); const e = env();
  await checkin(w, e, 'device-pago-000009', 'F123-TEST-AAAA-BBBB-DDDDD');
  assert.equal((await call(w, e, '/licencias/device-pago-000009/pagos', 'POST', { monto: 0 })).status, 400);
  assert.equal((await call(w, e, '/licencias/device-pago-000009/pagos', 'POST', { monto: 'abc' })).status, 400);
  assert.equal((await call(w, e, '/licencias/no-existe-000/pagos', 'POST', { monto: 10 })).status, 404);
  assert.equal((await call(w, e, '/licencias/device-pago-000009/pagos', 'POST', { monto: 10 }, { 'Content-Type': 'application/json' })).status, 401);
  await checkin(w, e, 'device-demo-000010', '');
  assert.equal((await call(w, e, '/licencias/device-demo-000010/pagos', 'POST', { monto: 10 })).status, 400, 'sin licencia no hay a que asentar el pago');
});
