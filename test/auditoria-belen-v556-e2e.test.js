'use strict';
// Auditoria Belen v556: dos aparatos REALES (dos contextos de Chromium, cada uno con su propio
// almacenamiento) con la app servida desde docs/. Sin red de produccion, solo datos sinteticos.
// Los cambios de un aparato viajan al otro como lo haria el relay: cada update de Yjs se captura
// y se aplica en el otro (test/helpers/e2e-app.cjs).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { startServer, openDevice, enterAs, go, chromium, installPump, pump } = require('./helpers/e2e-app.cjs');

const CAPTURAS = path.resolve(__dirname, '../auditoria-belen-v556-capturas');
let server, base, web;
before(async () => { ({ srv: server, base } = await startServer()); web = await chromium.launch(); fs.mkdirSync(CAPTURAS, { recursive: true }); });
after(async () => { await web.close(); await new Promise(r => server.close(r)); });

const api = (d, url, method = 'GET', body) => d.page.evaluate(async ([u, m, b]) => {
  const r = await fetch(u, { method: m, body: b === undefined ? undefined : JSON.stringify(b) }); return r.json();
}, [url, method, body]);
async function pair(roleA = 'dueno', roleB = 'admin', size) {
  const errors = [];
  const A = await openDevice(web, base, { errors, ...size }), B = await openDevice(web, base, { errors, ...size });
  await enterAs(A.page, roleA); await enterAs(B.page, roleB);
  await A.page.waitForFunction(() => OCYjs.estado === 'activo'); await B.page.waitForFunction(() => OCYjs.estado === 'activo');
  await installPump([A, B]);
  return { A, B, errors, close: async () => { await A.ctx.close(); await B.ctx.close(); } };
}
const stocks = async d => (await api(d, '/api/productos')).map(p => `${p.nombre}:${p.stockActual}:${p.precio}`).sort();

test('item 3: producto nuevo y edicion (nombre, precio) aparecen en el otro aparato', async () => {
  const { A, B, errors, close } = await pair();
  const jw = await api(A, '/api/productos', 'POST', { nombre: 'Johnny Walker', barcode: 'SYN-JW', stockInicial: 3, precio: 50, costo: 20 });
  await api(A, '/api/productos', 'POST', { nombre: 'ceramic con puntitos', barcode: 'SYN-CP', stockInicial: 1, precio: 30, costo: 10 });
  await pump(A, B);
  assert.deepEqual(await stocks(B), await stocks(A)); assert.equal((await stocks(B)).length, 2);
  await api(B, '/api/productos/' + jw.id, 'PATCH', { nombre: 'Johnny Walker Black', precio: 60 });
  await pump(A, B);
  assert.ok((await stocks(A)).includes('Johnny Walker Black:3:60'));
  assert.deepEqual(await stocks(B), await stocks(A));
  // persistencia: recargar un aparato conserva la edicion
  await A.page.reload({ waitUntil: 'domcontentloaded' }); await A.page.waitForFunction(() => window.OCYjs && OCYjs.estado === 'activo');
  assert.ok((await stocks(A)).includes('Johnny Walker Black:3:60'));
  assert.deepEqual(errors, []);
  await close();
});

test('item 2: vender la pieza unica en un aparato pone 0 solo ahi; ajustar 0 a 1 converge y un reseed viejo no lo revierte', async () => {
  const { A, B, close } = await pair();
  const cer = await api(A, '/api/productos', 'POST', { nombre: 'ceramic con puntitos', barcode: 'SYN-CP2', stockInicial: 1, precio: 30, costo: 10 });
  await api(A, '/api/productos', 'POST', { nombre: 'Otro', barcode: 'SYN-OT', stockInicial: 5, precio: 9, costo: 3 });
  await pump(A, B);
  await api(A, '/api/productos/' + cer.id + '/venta', 'POST', { cantidad: 1 });
  await pump(A, B);
  assert.deepEqual(await stocks(B), ['Otro:5:9', 'ceramic con puntitos:0:30'], 'solo la pieza vendida queda en 0');
  await api(A, '/api/productos/' + cer.id + '/ajustar', 'POST', { delta: 1, motivo: 'correccion' });
  await pump(A, B);
  assert.ok((await stocks(B)).includes('ceramic con puntitos:1:30'));
  await B.page.evaluate(() => OCYjs._store.sembrar()); await pump(A, B);
  assert.deepEqual(await stocks(A), await stocks(B));
  assert.ok((await stocks(A)).includes('ceramic con puntitos:1:30'), 'un reseed del otro aparato no revierte 1 a 0');
  // ventas simultaneas en los dos aparatos sobre el mismo producto: se suman las dos salidas
  const otro = (await api(A, '/api/productos')).find(p => p.nombre === 'Otro');
  await api(A, '/api/productos/' + otro.id + '/venta', 'POST', { cantidad: 1 });
  await api(B, '/api/productos/' + otro.id + '/venta', 'POST', { cantidad: 2 });
  await pump(A, B);
  assert.deepEqual(await stocks(A), await stocks(B));
  assert.ok((await stocks(A)).includes('Otro:2:9'));
  await close();
});

test('item 12: gastos de Dueno y Admin convergen (alta, edicion, anulacion, concurrencia sin conexion, recarga)', async () => {
  const { A, B, errors, close } = await pair('dueno', 'admin');
  const fecha = i => new Date(Date.now() - i * 3600000).toISOString();
  for (let i = 0; i < 4; i++) {
    await api(A, '/api/gastos', 'POST', { concepto: 'A' + i, monto: 100 + i * 7.13, fecha: fecha(i), metodoPago: i % 2 ? 'cash' : 'transfer' });
    await api(B, '/api/gastos', 'POST', { concepto: 'B' + i, monto: 50 + i * 3.31, fecha: fecha(i) });
  }
  await pump(A, B);
  const lista = (await api(A, '/api/gastos')).gastos;
  const id = n => lista.find(g => g.concepto === n).id;
  // sin conexion entre aparatos: cada uno hace cambios, incluso editar lo mismo
  for (let i = 0; i < 3; i++) { await api(A, '/api/gastos', 'POST', { concepto: 'AO' + i, monto: 11.11 * (i + 1), fecha: fecha(i) }); await api(B, '/api/gastos', 'POST', { concepto: 'BO' + i, monto: 22.22 * (i + 1), fecha: fecha(i) }); }
  await api(A, '/api/gastos/' + id('B1'), 'PATCH', { monto: 999.99 });
  await api(B, '/api/gastos/' + id('A1'), 'DELETE');
  await api(A, '/api/gastos/' + id('A2'), 'PATCH', { monto: 1.5 }); await api(B, '/api/gastos/' + id('A2'), 'PATCH', { monto: 2.5 });
  await pump(A, B);
  const fila = async d => (await api(d, '/api/gastos')).gastos.map(g => `${g.concepto}:${g.monto}:${g.metodoPago || '-'}`).sort();
  assert.deepEqual(await fila(B), await fila(A));
  const total = async d => Math.round((await api(d, '/api/gastos')).total * 100);
  assert.equal(await total(A), await total(B));
  for (const d of [A, B]) { await d.page.reload({ waitUntil: 'domcontentloaded' }); await d.page.waitForFunction(() => window.OCYjs && OCYjs.estado === 'activo'); }
  assert.equal(await total(A), await total(B));
  assert.deepEqual(errors, []);
  await close();
});

test('item 13: gasto con efectivo/transferencia y foto de comprobante desde la pantalla llega al otro aparato', async () => {
  const { A, B, close } = await pair('dueno', 'admin');
  await go(A.page, 'gastos');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await A.page.fill('#gastoConcepto', 'Comprobante sintetico'); await A.page.fill('#gastoMonto', '42.5');
  await A.page.selectOption('#gastoMetodoPago', 'transfer');
  await A.page.setInputFiles('#gastoFoto', { name: 'recibo.png', mimeType: 'image/png', buffer: png });
  await A.page.click('button[onclick="registrarGasto()"]');
  await A.page.waitForFunction(async () => (await (await fetch('/api/gastos')).json()).gastos.some(g => g.concepto === 'Comprobante sintetico'), null, { timeout: 8000 });
  const g = (await api(A, '/api/gastos')).gastos.find(x => x.concepto === 'Comprobante sintetico');
  assert.equal(g.metodoPago, 'transfer'); assert.match(g.facturaFotoHash || '', /^[a-f0-9]{64}$/);
  await pump(A, B, 400, 20);
  const en = (await api(B, '/api/gastos')).gastos.find(x => x.concepto === 'Comprobante sintetico');
  assert.ok(en, 'el otro aparato ve el gasto'); assert.equal(en.metodoPago, 'transfer'); assert.equal(en.facturaFotoHash, g.facturaFotoHash);
  await A.page.screenshot({ path: path.join(CAPTURAS, 'gastos-movil-390x844.png') });
  await close();
});

test('capturas: Inicio y Gastos en celular (390x844) y escritorio (1366x900)', async () => {
  for (const [nombre, size] of [['movil-390x844', { width: 390, height: 844 }], ['escritorio-1366x900', { width: 1366, height: 900 }]]) {
    const { A, close } = await pair('dueno', 'admin', size);
    for (let i = 1; i <= 6; i++) await api(A, '/api/productos', 'POST', { nombre: 'Obra unica ' + i, barcode: 'SYN-OU' + i, stockInicial: 1, precio: 100, costo: 40, umbralRojo: 1, umbralAmarillo: 2 });
    await api(A, '/api/gastos', 'POST', { concepto: 'Luz', monto: 2300, categoria: 'utilities', metodoPago: 'cash', fecha: new Date().toISOString() });
    await A.page.evaluate(() => cargarHoy()); await A.page.waitForTimeout(500);
    await A.page.screenshot({ path: path.join(CAPTURAS, `inicio-${nombre}.png`), fullPage: true });
    await go(A.page, 'gastos'); await A.page.evaluate(() => cargarGastos()); await A.page.waitForTimeout(500);
    await A.page.screenshot({ path: path.join(CAPTURAS, `gastos-${nombre}.png`), fullPage: true });
    await close();
  }
});
