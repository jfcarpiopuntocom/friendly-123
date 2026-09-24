/* Estado de cuenta del comisionista, paso 1 (JFC 2026-09-24, feature nueva).
   Cifrado en el fragmento del enlace, vence, lista blanca, datos alterados, XSS. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function cargar() {
  const ctx = { crypto: globalThis.crypto, TextEncoder, TextDecoder, Buffer, atob: globalThis.atob, btoa: globalThis.btoa, console };
  ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/estado-cifrado.js'), 'utf8'), ctx);
  return ctx.OCEstado;
}
const DIA = 86400000, T0 = Date.parse('2026-09-24T12:00:00Z');
const base = { nombre: 'Ana', negocio: 'Tienda', mes: '2026-09', totalVendido: 100, totalComision: 40, totalPagado: 20, totalPendiente: 20,
  lineas: [{ fecha: '2026-09-10', producto: 'Print', cantidad: 1, comision: 20, pagada: true, medio: 'efectivo' }, { fecha: '2026-09-12', producto: 'Print', cantidad: 1, comision: 20, pagada: false }] };

test('ida y vuelta: lo que se cifra es lo que se lee', async () => {
  const E = cargar();
  const frag = await E.cifrar(base, T0);
  assert.match(frag, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'solo caracteres seguros para una URL');
  const r = await E.leer('#' + frag, T0 + DIA);
  assert.equal(r.ok, true);
  assert.equal(r.datos.n, 'Ana'); assert.equal(r.datos.l.length, 2); assert.equal(r.datos.l[0].m, 'efectivo'); assert.equal(r.datos.t.pendiente, 20);
});

test('vence: a los 7 dias por defecto dice "vencido" y no entrega datos', async () => {
  const E = cargar();
  const frag = await E.cifrar(base, T0);
  assert.equal((await E.leer(frag, T0 + 6 * DIA)).ok, true);
  const r = await E.leer(frag, T0 + 8 * DIA);
  assert.equal(r.ok, false); assert.equal(r.motivo, 'vencido'); assert.equal(r.datos, undefined);
});

test('datos o clave alterados: no se abre (AES-GCM autentica, incluido el vencimiento)', async () => {
  const E = cargar();
  const [datos, clave] = (await E.cifrar(base, T0)).split('.');
  const mal = datos.slice(0, 20) + (datos[20] === 'A' ? 'B' : 'A') + datos.slice(21);
  assert.equal((await E.leer(mal + '.' + clave, T0)).ok, false);
  const otraClave = (await E.cifrar(base, T0)).split('.')[1];
  assert.equal((await E.leer(datos + '.' + otraClave, T0)).ok, false);
  assert.equal((await E.leer('basura', T0)).ok, false);
  assert.equal((await E.leer('', T0)).ok, false);
});

test('lista blanca: jamas viajan clientes, costos, PIN, licencia ni instanceId', async () => {
  const E = cargar();
  const sucio = Object.assign({}, base, { clientes: [{ nombre: 'Cliente X' }], costo: 9, pin: '1234', licencia: 'F123-XXXX-AAAA-BBBB-CCCCC', instanceId: 'dev-1',
    lineas: [Object.assign({}, base.lineas[0], { cliente: 'Cliente X', costoUnit: 9 })] });
  const r = await E.leer(await E.cifrar(sucio, T0), T0);
  const texto = JSON.stringify(r.datos);
  for (const prohibido of ['Cliente X', '1234', 'F123-', 'dev-1', 'costo', 'cliente']) assert.ok(!texto.includes(prohibido), 'no viaja: ' + prohibido);
});

test('XSS: la pagina pinta con textContent, nunca innerHTML con datos', () => {
  const html = fs.readFileSync(path.join(__dirname, '../docs/estado.html'), 'utf8');
  const script = html.slice(html.lastIndexOf('<script>'));
  assert.ok(!/innerHTML/.test(script), 'sin innerHTML');
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.ok(!/mock-backend|localStorage|indexedDB/i.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'no toca datos de la app');
});

test('recorta a 60 lineas y lo avisa', async () => {
  const E = cargar();
  const muchas = Object.assign({}, base, { lineas: Array.from({ length: 80 }, (_, i) => ({ fecha: '2026-09-01', producto: 'P' + i, cantidad: 1, comision: 1 })) });
  const r = await E.leer(await E.cifrar(muchas, T0), T0);
  assert.equal(r.datos.l.length, 60); assert.equal(r.datos.recortado, true);
});
