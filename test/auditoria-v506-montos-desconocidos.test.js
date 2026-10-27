// Auditoria 2026-10-14 (v506): un monto DESCONOCIDO del resumen diario no se
// muestra ni se manda como $0 en ninguna superficie (app, cierre del dia,
// WhatsApp, mosaico Today del dashboard). Cada prueba corre la funcion REAL
// extraida del archivo publicado; ninguna reimplementa la regla.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const R = require('../docs/core/business-read-model.js');
const { browser } = require('./helpers/browser.cjs');

const leer = (f) => require('./helpers/page-source.cjs').readFileSync(path.join(__dirname, '../docs', f), 'utf8').replace(/\r\n/g, '\n');
const app = leer('index.html');
const dash = leer('dashboard.html');
function bloque(src, inicio, fin) {
  const a = src.indexOf(inicio); assert.ok(a >= 0, 'no encuentro ' + inicio);
  const b = src.indexOf(fin, a); assert.ok(b > a, 'no encuentro el cierre de ' + inicio);
  return src.slice(a, b + fin.length);
}

test('app: fmtMoneyPend muestra — para desconocido y fmtMoney global no cambia', () => {
  const c = { window: {} }; vm.createContext(c);
  vm.runInContext(bloque(app, 'function fmtMoney(n){', '\n}\n') + bloque(app, 'function fmtMoneyPend(n)', '}\n'), c);
  assert.equal(c.fmtMoneyPend(null), '—');
  assert.equal(c.fmtMoneyPend(undefined), '—');
  assert.equal(c.fmtMoneyPend(12.5), '$12.50');
  assert.equal(c.fmtMoneyPend(0), '$0.00', 'un cero real sigue siendo cero');
  assert.equal(c.fmtMoney(null), '$0.00', 'fmtMoney global conserva su aspecto en las otras 133 llamadas');
});

test('app: cierre del dia (money del modal) no convierte null en $0', () => {
  const c = { window: {} }; vm.createContext(c);
  vm.runInContext(bloque(app, '  function money(v){\n    if(v===null', '\n  }\n'), c);
  assert.equal(c.money(null), '—');
  assert.match(c.money(7), /7\.00/);
});

test('app: resumen diario por WhatsApp no dice $0 cuando el monto es desconocido', async () => {
  let enviado = '';
  const respuesta = (x) => Promise.resolve({ json: () => Promise.resolve(x) });
  const c = {
    window: { open: (u) => { enviado = decodeURIComponent(u.split('text=')[1]); } },
    API: '/api', ubicacionActual: 'todas', t: (k) => k, tf: (k) => k,
    fetch: (u) => respuesta(u.includes('/dashboard') ? { resumenDia: { entra: null, ventasCount: 2 }, alertas: [] } : []),
  };
  vm.createContext(c);
  vm.runInContext(bloque(app, 'function fmtMoney(n){', '\n}\n') + bloque(app, 'async function enviarResumenWhatsApp(){', '\n}\n'), c);
  await c.enviarResumenWhatsApp();
  assert.match(enviado, /amount pending/);
  assert.ok(!/Today's sales: \$0\.00/.test(enviado), enviado);
});

function hub(datos) {
  const c = { datos, latidos: {}, micEstado: () => 'ok', VISTAS: { reposicion: { filas: () => [] } }, window: { OCBusinessReadModel: R }, mesLocalDe: value => R.day(value, 'America/Guayaquil').slice(0, 7) };
  vm.createContext(c);
  vm.runInContext(dash.slice(dash.indexOf('  function cmMesActual()'), dash.indexOf('  function cmRecibo(')) + bloque(dash, '  function totalesHub() {', '\n  }\n'), c);
  return c.totalesHub();
}
test('dashboard: mosaico Today conserva el desconocido y no inventa $0', () => {
  assert.equal(hub({ resumen: { resumenDia: { entra: null, ventasCount: 3 } } }).entra, null);
  const sinVentas = hub({ cobertura: { ventas: false }, resumen: { resumenDia: { entra: 0, ventasCount: 0 } } });
  assert.equal(sinVentas.entra, null, 'foto sin ventas: el 0 no se cree');
  assert.equal(sinVentas.nVentas, null);
  const ok = hub({ resumen: { resumenDia: { entra: 12.5, ventasCount: 2 } } });
  assert.equal(ok.entra, 12.5); assert.equal(ok.nVentas, 2);
});

test('backend real con el lector compartido: devolucion de venta pagada sale del ingreso del dia (B6)', async () => {
  const w = browser();
  assert.ok(w.OCBusinessReadModel, 'el arnes carga el lector como la app');
  w.OCAuth = { rolActual: () => 'dueno' };
  const socia = await w.request('/api/promotoras', 'POST', { nombre: 'Synthetic consignor', comisionBase: 50 });
  const rack = await w.request('/api/ubicaciones', 'POST', { nombre: 'Synthetic rack', tipo: 'consignacion' });
  await w.request(`/api/ubicaciones/${rack.id}`, 'PUT', { promotoraId: socia.id });
  const p = await w.request('/api/productos', 'POST', { nombre: 'Synthetic piece', barcode: 'SYN-V506', precio: 40, costo: 10, stockInicial: 2, ubicacionId: rack.id, umbralRojo: 0, umbralAmarillo: 1 });
  const base = (await w.request('/api/dashboard')).resumenDia; // el arnes trae ventas demo de hoy
  const v = await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  const antes = (await w.request('/api/dashboard')).resumenDia;
  assert.equal(+(antes.entra - base.entra).toFixed(2), 40); assert.equal(+(antes.gananciaHoy - base.gananciaHoy).toFixed(2), 30);
  await w.request(`/api/liquidaciones/${rack.id}/marcar-pagado`, 'POST', {});
  await w.request(`/api/ventas/${v.ventaId}/devolucion`, 'POST', { motivo: 'synthetic' });
  const despues = (await w.request('/api/dashboard')).resumenDia;
  assert.equal(despues.entra, base.entra, 'vendida y devuelta hoy: no entro plata');
  assert.equal(despues.gananciaHoy, base.gananciaHoy);
  assert.equal(R.daily([], '2026-10-14').entra, 0, 'dia vacio sigue siendo cero real');
});
