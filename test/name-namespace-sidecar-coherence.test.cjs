'use strict';
// v594 (plan16, pendiente 3): el nombre del negocio no puede divergir entre el
// exterior (candado/header, que lee RAM del cuaderno activo y, solo en la tienda
// PROPIA, el sidecar f123_owned) y el interior (tarjeta de equipo en Advanced).
// Causa demostrada: tres escritores de mock-backend copiaban el nombre de una
// tienda UNIDA a f123_owned (sidecar del negocio propio), y la tarjeta interior
// leia el sidecar tambien en una tienda unida. Datos 100% sinteticos.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { browser } = require('./helpers/browser.cjs');

function disk(seed) {
  const m = new Map(Object.entries(seed || {}));
  return { get length() { return m.size; }, key: i => [...m.keys()][i],
    getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
}
const OWN = { licenseCode: 'F123-OWNFIXTURE', instanceId: 'fixture-instance', nombreNegocio: 'Own Store A', nombreNegocioRev: 2 };
// f123_notebook_unificado_v2 = migracion de cuaderno unico ya hecha: sin ella el arranque
// fuerza f123_tienda_activa="" y el fixture dejaria de ser una tienda unida.
function joined(extra) {
  return browser(disk(Object.assign({ f123_owned: JSON.stringify(OWN), f123_tienda_activa: '::F123-JOINFIXTURE',
    f123_notebook_unificado_v2: '1' }, extra)));
}
// Catalogo remoto real: otro aparato sintetico, dueno, que renombra su cuaderno.
async function remoteCatalog(nombre) {
  const b = browser();
  b.OCAuth = { rolActual: () => 'dueno', esDemo: () => false };
  const r = await b.fetch('/api/instancia/nombre', { method: 'POST', body: JSON.stringify({ nombre }) });
  assert.equal(r.status, 200);
  return b.catalog();
}
const sidecar = app => JSON.parse(app.localStorage.getItem('f123_owned'));

function capturePanelHeartbeat(app) {
  const auth = fs.readFileSync(path.join(__dirname, '../docs/auth-ui.js'), 'utf8');
  const start = auth.indexOf('  async function enviarHeartbeat(datos) {');
  const end = auth.indexOf('  /* LATIDO DE SALUD DEL CANARIO', start);
  const sent = [];
  app.OC_WORKER_URL = 'https://panel.fixture.invalid';
  app._cbBloqueado = () => false;
  app._cbExito = app._cbFallo = () => {};
  app.fetch = async (url, opts) => {
    sent.push({ url, payload: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({}) };
  };
  vm.runInContext(auth.slice(start, end) + '\nOCAuth = { heartbeat: enviarHeartbeat };', app);
  return sent;
}

test('joined name adoption cannot label the own-license panel row with a foreign business', async () => {
  const app = joined();
  const sent = capturePanelHeartbeat(app);
  app.OCSync.aplicarCatalogo(await remoteCatalog('Joined Team B'), 'dueno');
  await Promise.resolve();
  assert.equal(app.OCTienda.nombreActivo(), 'Joined Team B');
  assert.equal(sent.length, 0, 'joined-store adoption does not send an own-license identity update');
});

test('own name adoption still sends confirmed own-license panel metadata', async () => {
  const app = browser(disk({ f123_owned: JSON.stringify(OWN), f123_notebook_unificado_v2: '1' }));
  const sent = capturePanelHeartbeat(app);
  app.OCSync.aplicarCatalogo(await remoteCatalog('Own Store A2'), 'dueno');
  await Promise.resolve();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://panel.fixture.invalid/checkin');
  assert.equal(sent[0].payload.licenseCode, OWN.licenseCode);
  assert.equal(sent[0].payload.nombreNegocio, 'Own Store A2');
  assert.equal(sent[0].payload.nombreNegocioRev, 1);
});

test('joined notebook: catalog sync that adopts a team name never rewrites the own-business sidecar', async () => {
  const app = joined();
  assert.equal(app.OCTienda.esUnida(), true, 'fixture is in a joined namespace');
  app.OCSync.aplicarCatalogo(await remoteCatalog('Joined Team B'), 'dueno');
  assert.equal(app.OCTienda.nombreActivo(), 'Joined Team B', 'active notebook adopted the team name');
  assert.equal(sidecar(app).nombreNegocio, 'Own Store A', 'sidecar keeps the own business name');
  assert.equal(sidecar(app).nombreNegocioRev, 2, 'sidecar keeps the own revision');
  assert.equal(sidecar(app).nombreNegocioTs, undefined, 'sidecar gets no foreign timestamp');
});

test('joined notebook: checkpoint name does not leak into the own-business sidecar', () => {
  const app = joined();
  app.OCSync.aplicarCheckpoint({ productos: [], ubicaciones: [], nombreNegocio: 'Joined Team B' });
  assert.equal(app.OCTienda.nombreActivo(), 'Joined Team B');
  assert.equal(sidecar(app).nombreNegocio, 'Own Store A');
});

test('joined notebook: owner rename stays in the joined namespace only', async () => {
  const app = joined();
  app.OCAuth = { rolActual: () => 'dueno', esDemo: () => false };
  const r = await app.fetch('/api/instancia/nombre', { method: 'POST', body: JSON.stringify({ nombre: 'Renamed Team B' }) });
  assert.equal(r.status, 200);
  assert.equal(app.OCTienda.nombreActivo(), 'Renamed Team B');
  assert.equal(sidecar(app).nombreNegocio, 'Own Store A');
  assert.equal(sidecar(app).nombreNegocioRev, 2);
});

test('own notebook keeps updating the sidecar (no regression)', async () => {
  const app = browser(disk({ f123_owned: JSON.stringify(OWN), f123_notebook_unificado_v2: '1' }));
  assert.equal(app.OCTienda.esUnida(), false);
  const cat = await remoteCatalog('Own Store A2');
  app.OCSync.aplicarCatalogo(cat, 'dueno');
  assert.equal(app.OCTienda.nombreActivo(), 'Own Store A2');
  assert.equal(sidecar(app).nombreNegocio, 'Own Store A2');
  assert.equal(sidecar(app).nombreNegocioRev, cat.nombreNegocioRev);
});

test('interior name has one source: nombreConocido ignores the sidecar inside a joined notebook', async () => {
  const j = joined();
  assert.equal(j.OCTienda.nombreActivo(), '', 'joined notebook has not synced a name yet');
  assert.equal(j.OCTienda.nombreConocido(), '', 'joined + no synced name yet: no foreign label');
  j.OCSync.aplicarCatalogo(await remoteCatalog('Joined Team B'), 'dueno');
  assert.equal(j.OCTienda.nombreConocido(), 'Joined Team B');
  const own = browser(disk({ f123_owned: JSON.stringify(OWN), f123_notebook_unificado_v2: '1' }));
  assert.equal(own.OCTienda.nombreActivo(), '');
  assert.equal(own.OCTienda.nombreConocido(), 'Own Store A', 'own notebook, RAM still empty: last known own name');
});

test('Advanced team card reads the name through nombreConocido (source check)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../docs/avanzado-extra.js'), 'utf8');
  const i = src.indexOf('let _nombreNegocio = "";');
  assert.ok(i > 0);
  const chunk = src.slice(i, i + 400);
  assert.match(chunk, /nombreConocido/);
  assert.doesNotMatch(chunk, /f123_owned/, 'the card must not read the sidecar directly');
});

test('read-only trace exposes namespace/revision/source as short hashes, never the name', async () => {
  const app = joined();
  app.OCSync.aplicarCatalogo(await remoteCatalog('Joined Team B'), 'dueno');
  const t = app.OCTienda.trazaNombre();
  assert.equal(t.unida, true);
  assert.equal(t.fuente, 'ram');
  assert.equal(t.rev, 1);
  assert.match(t.ns, /^[0-9a-f]{4}$/);
  assert.match(t.nombre, /^[0-9a-f]{4}$/);
  assert.doesNotMatch(JSON.stringify(t), /Joined Team|Own Store|F123-/);
});
