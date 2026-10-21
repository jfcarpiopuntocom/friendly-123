// Claude 2026-10-21 (reclamo de Belen; decision de JFC «elige quien cobra»).
// Datos sinteticos, sin red ni clientes reales. Caso de las cervezas: 3 consumidas y pagadas,
// 3 mas con abono parcial, luego 5 mas pendientes. Cada consumo debe decir Pagado / Parcial /
// Pendiente; el saldo NO cambia por asignar; los abonos viejos quedan «sin asignar».
const { test } = require('node:test');
const assert = require('node:assert/strict');

function cargarCartera(hechos) {
  const global = { AMG: {}, OCAuth: { usuarioActual: () => ({ nombre: 'Cajera' }) } };
  let n = 0;
  global.AMG.Hechos = {
    todos: () => Promise.resolve(hechos.slice()),
    registrar: (tipo, datos) => { const h = { id: 'h' + (++n), tipo, ts: 1000 + n, datos }; hechos.push(h); return Promise.resolve(h); },
    verificarCadenas: () => Promise.resolve({ ok: true })
  };
  const fs = require('fs'); const path = require('path'); const vm = require('vm');
  const src = fs.readFileSync(path.join(__dirname, '../docs/cartera.js'), 'utf8');
  const ctx = { window: global, localStorage: { getItem: () => null, setItem: () => {} }, console };
  vm.createContext(ctx);
  vm.runInContext(src.replace(/\}\)\(typeof window !== "undefined" \? window : this\);\s*$/, '})(window);'), ctx);
  return global.AMG.Cartera;
}
const CLI = 'cli-belen';
const venta = (id, fecha, cant) => ({ id, fecha, clienteId: CLI, cantidad: cant, precioUnit: 2, info: { formaPago: 'fiado', fiadoAtomico: true } });
const ventas = [venta('v1', '2026-10-01T20:00:00Z', 3), venta('v2', '2026-10-02T20:00:00Z', 3), venta('v3', '2026-10-03T20:00:00Z', 5)];
const abono = (id, ts, monto) => ({ id, tipo: 'cartera_abono', ts, datos: { clienteId: CLI, monto, motivo: 'Abono' } });

test('cada consumo fiado muestra pagado, parcial o pendiente segun lo que eligio quien cobra', async () => {
  const hechos = [abono('a-viejo', 10, 1), abono('a1', 20, 6), abono('a2', 30, 4)];
  const C = cargarCartera(hechos);
  await C.aplicarAbono(CLI, 'a1', [{ cargoKey: 'venta:v1', monto: 6 }], ventas);
  await C.aplicarAbono(CLI, 'a2', [{ cargoKey: 'venta:v2', monto: 4 }], ventas);
  const r = C.calcularSaldo(hechos, CLI, ventas);
  const est = Object.fromEntries(r.movimientos.filter(m => m.tipo === 'cargo').map(m => [m.ventaId, m.estado]));
  assert.deepEqual(est, { v1: 'pagado', v2: 'parcial', v3: 'pendiente' });
  const v2 = r.movimientos.find(m => m.ventaId === 'v2');
  assert.equal(v2.aplicado, 4); assert.equal(v2.pendiente, 2);
  // El saldo es el mismo que sin asignar: cargos 22 - abonos 11 = -11.
  assert.equal(r.saldo, -11);
  // El abono viejo nunca se reparte solo.
  assert.equal(r.movimientos.find(m => m.id === 'a-viejo').sinAsignar, 1);
});

test('no se puede asignar mas de lo que queda del pago ni mas de lo que falta del consumo', async () => {
  const hechos = [abono('a1', 20, 5)];
  const C = cargarCartera(hechos);
  await assert.rejects(C.aplicarAbono(CLI, 'a1', [{ cargoKey: 'venta:v1', monto: 7 }], ventas), /supera lo que falta/);
  await assert.rejects(C.aplicarAbono(CLI, 'a1', [{ cargoKey: 'venta:v1', monto: 6 }], ventas), /sin asignar/);
  await C.aplicarAbono(CLI, 'a1', [{ cargoKey: 'venta:v1', monto: 5 }], ventas);
  await assert.rejects(C.aplicarAbono(CLI, 'a1', [{ cargoKey: 'venta:v2', monto: 1 }], ventas), /sin asignar/);
});

test('deshacer una asignacion es otro hecho, nunca un borrado', async () => {
  const hechos = [abono('a1', 20, 6)];
  const C = cargarCartera(hechos);
  await C.aplicarAbono(CLI, 'a1', [{ cargoKey: 'venta:v1', monto: 6 }], ventas);
  await C.desaplicarAbono(CLI, 'a1', 'venta:v1');
  const r = C.calcularSaldo(hechos, CLI, ventas);
  assert.equal(r.movimientos.find(m => m.ventaId === 'v1').estado, 'pendiente');
  assert.equal(hechos.filter(h => h.tipo === 'cartera_aplicacion').length, 2);
});

test('el encargado ve los consumos abiertos para cobrar, pero no el historial completo', async () => {
  const hechos = [abono('a1', 20, 6)];
  const C = cargarCartera(hechos);
  await C.aplicarAbono(CLI, 'a1', [{ cargoKey: 'venta:v1', monto: 6 }], ventas);
  const r = C.calcularSaldo(hechos, CLI, ventas);
  const v = C.vistaCarteraSegunRol({ saldo: r.saldo, movimientos: r.movimientos }, 'empleado');
  assert.equal(v.historial.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(v.consumosPendientes.map(c => c.cargoKey))), ['venta:v2', 'venta:v3']);
});
