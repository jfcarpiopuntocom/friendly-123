// devoluciones.test.js — Tests FAILSAFE de devoluciones (anular venta).
// Prueban la capa REAL data.js en modo local (lowdb), no la demo estática
// (Pages usa mock-backend.js en el navegador). Se corre con: npm test.
//
// Invariante central: anular una venta reingresa EXACTAMENTE el stock vendido,
// una sola vez. Nunca stock negativo, nunca doble reingreso, nunca vender más
// de lo que hay. Todo lo demás del negocio depende de que esto sea a prueba de
// balas (dinero y stock).
//
// Snapshotea data/db.json al empezar y lo restaura al final: los tests mutan la
// db local, pero el archivo queda idéntico a como estaba (o borrado si no
// existía). No toca nada de la demo pública.

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');
let snapshot = null;
let existiaAntes = false;
try { snapshot = fs.readFileSync(DB_PATH, 'utf8'); existiaAntes = true; } catch (_) { /* aún no existe */ }

const data = require('../data'); // dispara db.js (lee/crea data/db.json)
const db = require('../db');

// Un producto de una percha ACTIVA y con stock suficiente para las pruebas.
function productoVendible() {
  const activas = new Set(db.get('ubicaciones').value().filter((u) => u.activa !== false).map((u) => u.id));
  return db.get('productos').value().find((p) => activas.has(p.ubicacionId) && p.stockActual > 2);
}
const stockDe = (id) => db.get('productos').find({ id }).value().stockActual;

after(() => {
  if (existiaAntes && snapshot != null) fs.writeFileSync(DB_PATH, snapshot);
  else { try { fs.unlinkSync(DB_PATH); } catch (_) {} }
});

test('vender descuenta el stock y devuelve un ventaId', async () => {
  const p = productoVendible();
  assert.ok(p, 'el seed debe tener al menos un producto vendible');
  const antes = stockDe(p.id);
  const r = await data.venderUno(p.id, 1);
  assert.ok(r.ventaId, 'la venta debe devolver ventaId');
  assert.strictEqual(stockDe(p.id), antes - 1, 'el stock baja en 1');
  await data.anularVenta(r.ventaId); // limpiar
});

test('anular restaura el stock EXACTO (ni más, ni menos)', async () => {
  const p = productoVendible();
  const antes = stockDe(p.id);
  const r = await data.venderUno(p.id, 2);
  assert.strictEqual(stockDe(p.id), antes - 2);
  const a = await data.anularVenta(r.ventaId);
  assert.ok(!a.error, 'la anulación debe tener éxito');
  assert.strictEqual(stockDe(p.id), antes, 'el stock vuelve al valor original');
});

test('anular DOS veces la misma venta NO reingresa stock dos veces (failsafe)', async () => {
  const p = productoVendible();
  const antes = stockDe(p.id);
  const r = await data.venderUno(p.id, 1);
  const a1 = await data.anularVenta(r.ventaId);
  assert.ok(!a1.error, 'la primera anulación tiene éxito');
  const a2 = await data.anularVenta(r.ventaId);
  assert.ok(a2.error, 'la segunda anulación debe fallar limpio');
  assert.strictEqual(stockDe(p.id), antes, 'sin doble reingreso: el stock no infla');
});

test('no se puede vender más que el stock disponible (nunca negativo)', async () => {
  const p = productoVendible();
  const antes = stockDe(p.id);
  const r = await data.venderUno(p.id, antes + 5);
  assert.ok(r.error, 'debe rechazar la venta por falta de stock');
  assert.strictEqual(stockDe(p.id), antes, 'el stock queda intacto tras el rechazo');
});

test('anular una venta inexistente falla limpio (sin excepción)', async () => {
  const r = await data.anularVenta('venta-que-no-existe-jamas');
  assert.ok(r.error, 'debe devolver error controlado, no lanzar');
});

test('muchos ciclos vender+anular mantienen el invariante de stock', async () => {
  const p = productoVendible();
  const antes = stockDe(p.id);
  for (let i = 0; i < 8; i++) {
    const r = await data.venderUno(p.id, 1);
    assert.ok(r.ventaId, `venta ${i} ok`);
    const a = await data.anularVenta(r.ventaId);
    assert.ok(!a.error, `anulación ${i} ok`);
  }
  assert.strictEqual(stockDe(p.id), antes, 'tras 8 ciclos el stock es el mismo');
});
