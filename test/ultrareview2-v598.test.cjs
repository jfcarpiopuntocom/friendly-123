// v598 · ultrareview 2 (2026-10-27), puntos 1, 2, 3 y 9. Datos sinteticos; cada test falla en v597.
// 1) Sin instanceId (demo, plan gratis, aparato sin activar) la caja seguia sin puntos automaticos.
// 2) Activar o "Import copy" cambian el instanceId: los puntos de antes quedaban sin forma de verse.
// 3) Con localStorage lleno el punto automatico no se guardaba y nadie se enteraba.
//    Decision de JFC 2026-10-27: "7 nuevos si caben"; aviso en texto dentro de la UI, sin modales.
// 9) Venta pagada, devuelta (aj-dev) y anulada en otro aparato: se descontaba dos veces.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { browser } = require('./helpers/browser.cjs');
const L = require('../docs/core/payout-ledger.js');

const hash = s => createHash('sha256').update(s).digest('hex');
const avanzado = fs.readFileSync(path.join(__dirname, '../docs/avanzado-extra.js'), 'utf8');
const cajaCode = avanzado.slice(avanzado.indexOf('    const CAJA_MAX_SNAPSHOTS ='), avanzado.indexOf('    function cajaPintarAlerta()'));

function mapStorage(seed, limit = Infinity) {
  const m = new Map(Object.entries(seed || {}));
  const size = () => [...m].reduce((s, [k, v]) => s + k.length + v.length, 0);
  return { get length() { return m.size; }, key: i => [...m.keys()][i],
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { const prev = m.get(k); m.set(k, String(v)); if (size() > limit) { if (prev === undefined) m.delete(k); else m.set(k, prev); throw new Error('QuotaExceededError'); } },
    removeItem: k => m.delete(k), _m: m };
}
async function app(seed, role = 'dueno', limit) {
  const ls = mapStorage(seed, limit);
  const w = browser(ls);
  w.OCAuth = { rolActual: () => role };
  w.OCSecure.hashTexto = async s => hash(s);
  const messages = [];
  Object.assign(w, { API: '/api', msg: (...a) => messages.push(a), confirm: () => true, escHtml: x => String(x), $: () => null });
  const rack = await w.request('/api/ubicaciones', 'POST', { nombre: 'v598 rack', tipo: 'socio' });
  await w.request('/api/productos', 'POST', { nombre: 'v598 cup', barcode: 'V598-1', precio: 10, costo: 2, stockInicial: 5, ubicacionId: rack.id });
  vm.runInContext(cajaCode, w);
  return { w, ls, messages };
}
const keysOf = ls => [...ls._m.keys()].filter(k => k.startsWith('f123_caja_snapshots::'));

/* ---------- 1. sin instanceId ---------- */
test('punto 1: cuaderno sin instanceId (demo / plan gratis) SI guarda puntos automaticos', async () => {
  const { w, ls } = await app({}, 'demo');
  const id = w.OCTienda.cuadernoId();
  assert.ok(id, 'la identidad de la caja nunca queda vacia');
  assert.equal(w.OCTienda.cuadernoId(), id, 'y es estable');
  await w.cajaGuardarPunto(true);
  assert.equal(keysOf(ls).length, 1);
  const saved = JSON.parse(JSON.parse(ls.getItem(keysOf(ls)[0]))[0].contenido).datos._recuperacion;
  assert.equal(saved.notebookId, id, 'cliente y /respaldo/exportar usan la misma identidad');
});

test('punto 1: aparato activado cuyo instanceId en memoria quedo null re-lee f123_owned en vivo', async () => {
  const { w, ls } = await app({});
  ls.setItem('f123_owned', JSON.stringify({ instanceId: 'INST-LIVE', licenseCode: 'F123-TEST-L' }));
  assert.equal(w.OCTienda.cuadernoId(), 'INST-LIVE');
});

/* ---------- 2. identidad anterior ---------- */
test('punto 2: tras activar o importar, los puntos de la identidad anterior siguen listados para descargar', () => {
  const start = avanzado.indexOf('$("oc-caja-ver").addEventListener');
  const handler = avanzado.slice(start, avanzado.indexOf('\n    });', start));
  assert.match(handler, /indexOf\("f123_caja_snapshots::"\) === 0 && k !== claveActual/, 'lista las otras claves de la caja');
  assert.match(handler, /data-caja-clave=/, 'cada punto se puede descargar desde su propia clave');
  assert.doesNotMatch(handler, /removeItem/, 'nunca borra puntos');
});

test('punto 2: descargar un punto de otra identidad lee su clave, no la legada', async () => {
  const { w, ls } = await app({ f123_owned: JSON.stringify({ instanceId: 'INST-NEW' }) });
  const contenido = JSON.stringify({ fecha: '2026-10-27', datos: { schemaVersion: 3 } });
  const otra = 'f123_caja_snapshots::' + encodeURIComponent(JSON.stringify(['', 'INST-OLD']));
  ls.setItem(otra, JSON.stringify([{ fecha: '2026-10-27', contenido, checksum: hash(contenido) }]));
  let blob = null;
  const a = { click() {}, remove() {} };
  Object.assign(w, { document: { createElement: () => a, body: { appendChild() {} } }, Blob: class { constructor(p) { blob = p[0]; } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, setTimeout: () => 0 });
  await w.cajaDescargarLegado(0, otra);
  assert.equal(blob, contenido);
  assert.equal(JSON.parse(ls.getItem(otra)).length, 1, 'la copia guardada se conserva');
});

/* ---------- 3. espacio ---------- */
test('punto 3: con espacio justo suelta los nuevos mas antiguos, conserva ancla, ultimo y legados', async () => {
  const { w, ls } = await app({ f123_owned: JSON.stringify({ instanceId: 'INST-Q' }) });
  for (let i = 0; i < 7; i++) await w.cajaGuardarPunto(true);
  const clave = keysOf(ls)[0];
  const antes = JSON.parse(ls.getItem(clave));
  assert.equal(antes.length, 7);
  ls.setItem('f123_caja_snapshots', JSON.stringify(antes.slice(0, 3))); // legados: intocables
  const legado = ls.getItem('f123_caja_snapshots');
  const usado = [...ls._m].reduce((s, [k, v]) => s + k.length + v.length, 0);
  // Cabe el estado actual menos ~2 puntos: el siguiente guardado tiene que soltar viejos para entrar.
  const limite = usado - 2 * antes[1].contenido.length;
  ls.setItem = ((orig) => (k, v) => { const prev = ls._m.get(k); ls._m.set(k, String(v)); if ([...ls._m].reduce((s, [a, b]) => s + a.length + b.length, 0) > limite) { if (prev === undefined) ls._m.delete(k); else ls._m.set(k, prev); throw new Error('QuotaExceededError'); } })();
  await w.cajaGuardarPunto(true);
  const despues = JSON.parse(ls.getItem(clave));
  assert.ok(despues.length >= 2 && despues.length < 7, 'guardo menos puntos en vez de ninguno: ' + despues.length);
  assert.deepEqual(despues[0], antes[0], 'el ancla no se suelta');
  assert.notDeepEqual(despues[despues.length - 1], antes[6], 'el punto nuevo si entro');
  assert.equal(ls.getItem('f123_caja_snapshots'), legado, 'los legados no se tocan');
});

test('punto 3: si ni ancla + nuevo caben, el punto automatico avisa en texto dentro de Advanced', async () => {
  const { w, ls, messages } = await app({ f123_owned: JSON.stringify({ instanceId: 'INST-F' }) });
  ls.setItem = () => { throw new Error('QuotaExceededError'); };
  await w.cajaGuardarPunto(true);
  const m = messages.find(x => x[0] === 'oc-respaldo-msg');
  assert.ok(m, 'hay mensaje en la zona de respaldos');
  assert.match(m[1], /localStorage has its own small limit/);
  assert.equal(m[2], 'var(--rojo)');
});

test('punto 3 (guarda): un fallo pasajero del export sigue callado en el punto automatico', async () => {
  const { w, messages } = await app({ f123_owned: JSON.stringify({ instanceId: 'INST-G' }) });
  w.fetch = async () => ({ ok: false, json: async () => ({}) });
  await w.cajaGuardarPunto(true);
  assert.equal(messages.length, 0);
});

/* ---------- 9. un solo descuento por venta anulada (core) ---------- */
const venta = (id, extra) => Object.assign({ id, fecha: '2026-10-01T10:00:00Z', ubicacionId: 'r1', split: { montoComisionSocio: 40 } }, extra || {});
const ajDev = (id, extra) => Object.assign({ id: 'aj-dev-' + id, tipo: 'devolucion', ventaId: id, ubicacionId: 'r1', fecha: '2026-10-02T10:00:00Z', montoComisionSocio: -40, liquidada: false }, extra || {});
const loc = [{ id: 'r1', promotoraId: 'alice' }];
const pagoV1 = { id: 'p1', opId: 'o1', status: 'paid', payeeId: 'alice', amountCents: 4000, items: [{ kind: 'sale', sourceId: 'v1', payeeId: 'alice', amountCents: 4000 }] };
const saldo = (input) => (L.balancesByPayee(input)[0] || { dueCents: 0 }).dueCents;

test('punto 9 core: pagada + devuelta + anulada descuenta lo pagado UNA vez (antes el doble)', () => {
  const input = { sales: [venta('v1', { anulada: true })], adjustments: [ajDev('v1')], locations: loc, payouts: [pagoV1] };
  assert.equal(saldo(input), -4000);
  assert.equal(L.buildObligations(input).filter(o => o.signedAmountCents < 0 && o.dueCents < 0).length, 1, 'un solo descuento pendiente');
});

test('punto 9 core: SIN pagar + devuelta + anulada no le cobra nada a la persona', () => {
  const input = { sales: [venta('v1', { anulada: true })], adjustments: [ajDev('v1')], locations: loc, payouts: [] };
  assert.equal(saldo(input), 0);
  assert.deepEqual(L.buildObligations(input), []);
});

test('punto 9 core: si un pago ya consumio la devolucion, el void no vuelve a descontar', () => {
  // p2 pago v2 (60) usando la devolucion de v1 (-40): neto 20. Despues otro aparato anula v1.
  const p2 = { id: 'p2', opId: 'o2', status: 'paid', payeeId: 'alice', amountCents: 2000, items: [
    { kind: 'sale', sourceId: 'v2', payeeId: 'alice', amountCents: 6000 },
    { kind: 'adjustment', sourceId: 'aj-dev-v1', payeeId: 'alice', amountCents: 4000, offset: true }] };
  const input = { sales: [venta('v1', { anulada: true }), venta('v2', { split: { montoComisionSocio: 60 } })],
    adjustments: [ajDev('v1')], locations: loc, payouts: [pagoV1, p2] };
  assert.equal(saldo(input), 0, 'lo pagado por v1 ya se recupero una vez');
  const consumida = L.buildObligations(input).find(o => o.sourceId === 'aj-dev-v1');
  assert.ok(consumida && consumida.paidCents === 4000 && consumida.dueCents === 0, 'el hecho del pago no se esconde');
});

test('punto 9 core (guarda): venta solo devuelta (no anulada) conserva su unico descuento', () => {
  const input = { sales: [venta('v1')], adjustments: [ajDev('v1')], locations: loc, payouts: [pagoV1] };
  assert.equal(saldo(input), -4000);
});

/* ---------- 9. entre dos aparatos (app real) ---------- */
const cents = n => Math.round(Number(n) * 100);
const sync = (X, Y) => { X.receive(Y); Y.receive(X); X.receive(Y); };
async function dosAparatos() {
  const A = browser(); A.OCAuth = { rolActual: () => 'dueno' };
  const shelf = await A.request('/api/ubicaciones', 'POST', { nombre: 'Race shelf 598', tipo: 'socio', comisionSocio: 40 });
  const product = await A.request('/api/productos', 'POST', { nombre: 'Race print 598', sku: 'RACE-598', barcode: 'RACE-598', precio: 50, costo: 10, stockInicial: 20, ubicacionId: shelf.id });
  await A.request(`/api/productos/${product.id}/venta`, 'POST', { cantidad: 1 });
  const v = (await A.request('/api/respaldo/exportar')).ventas.pop();
  const B = browser(); B.OCAuth = { rolActual: () => 'dueno' }; B.receive(A);
  return { A, B, shelf, v };
}
const liq = async (X, shelf) => (await X.request('/api/liquidaciones')).find(f => f.ubicacionId === shelf.id);

test('punto 9 app: A paga y devuelve, B cancela antes de sincronizar: un solo descuento en ambos', async () => {
  const { A, B, shelf, v } = await dosAparatos();
  const pagado = cents(v.split.montoComisionSocio);
  await A.request(`/api/liquidaciones/${shelf.id}/marcar-pagado`, 'POST', {});
  await A.request(`/api/ventas/${v.id}/devolucion`, 'POST', { motivo: 'race', quien: 'A' });
  assert.equal((await B.request(`/api/ventas/${v.id}/cancelar`, 'POST', { motivo: 'x' })).ok, true);
  sync(A, B);
  for (const [n, X] of [['A', A], ['B', B]]) assert.equal(cents((await liq(X, shelf)).stillDue), -pagado, n);
});

test('punto 9 app: A devuelve SIN pagar, B cancela: nadie le debe nada a nadie', async () => {
  const { A, B, shelf, v } = await dosAparatos();
  await A.request(`/api/ventas/${v.id}/devolucion`, 'POST', { motivo: 'race', quien: 'A' });
  await B.request(`/api/ventas/${v.id}/cancelar`, 'POST', { motivo: 'x' });
  sync(A, B);
  for (const [n, X] of [['A', A], ['B', B]]) assert.equal(cents((await liq(X, shelf)).stillDue), 0, n);
});
