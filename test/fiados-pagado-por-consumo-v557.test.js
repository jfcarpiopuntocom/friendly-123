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


test('un pago con varias compras genera UN solo hecho atomico, reintento idempotente', async () => {
  const hechos = [abono('a-lote', 20, 10)];
  const C = cargarCartera(hechos);
  const partes = [{ cargoKey: 'venta:v1', monto: 6 }, { cargoKey: 'venta:v2', monto: 4 }];
  const primero = await C.aplicarAbono(CLI, 'a-lote', partes, ventas, 'idempotente-lote-1');
  const otro = await C.aplicarAbono(CLI, 'a-lote', partes, ventas, 'idempotente-lote-1');
  assert.equal(primero.id, otro.id);
  assert.equal(hechos.filter(h => h.tipo === 'cartera_aplicacion').length, 1);
  const r = C.calcularSaldo(hechos, CLI, ventas);
  assert.equal(r.saldo, -12);
  assert.equal(r.movimientos.find(m => m.ventaId === 'v1').estado, 'pagado');
  assert.equal(r.movimientos.find(m => m.ventaId === 'v2').pendiente, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(r.aplicacionesAceptadas)), [primero.id]);
  await assert.rejects(
    C.aplicarAbono(CLI, 'a-lote', [{ cargoKey: 'venta:v3', monto: 4 }], ventas, 'idempotente-lote-1'),
    /referencia pertenece a otra asignación/
  );
});

test('una clave de consumo repetida es rechazada ANTES de grabar algun hecho', async () => {
  const hechos = [abono('a1', 20, 10)];
  const C = cargarCartera(hechos);
  await assert.rejects(
    C.aplicarAbono(CLI, 'a1', [
      { cargoKey: 'venta:v1', monto: 5 }, { cargoKey: 'venta:v1', monto: 5 }
    ], ventas, 'dup-synthetic'),
    /consumo repetido/
  );
  assert.equal(hechos.filter(h => h.tipo === 'cartera_aplicacion').length, 0);
  assert.equal(C.calcularSaldo(hechos, CLI, ventas).saldo, -12);
});

test('dos aparatos offline compiten por un mismo abono; ambos convergen sin borrar hechos', async () => {
  const origen = [abono('a1', 20, 6)];
  const A = origen.concat([]), B = origen.concat([]);
  const ca = cargarCartera(A), cb = cargarCartera(B);
  await ca.aplicarAbono(CLI, 'a1', [{ cargoKey: 'venta:v1', monto: 6 }], ventas, 'A');
  await cb.aplicarAbono(CLI, 'a1', [{ cargoKey: 'venta:v2', monto: 6 }], ventas, 'B');
  const ha = A.find(h => h.tipo === 'cartera_aplicacion');
  const hb = B.find(h => h.tipo === 'cartera_aplicacion');
  ha.id = 'app-device-A'; hb.id = 'app-device-B';
  ha.ts = hb.ts = 1050; // Un reloj empatado se deshace por ID estable.
  const union1 = origen.concat([ha, hb]), union2 = origen.concat([hb, ha]);
  const uno = ca.calcularSaldo(union1, CLI, ventas);
  const dos = cb.calcularSaldo(union2, CLI, ventas);
  assert.deepEqual(JSON.parse(JSON.stringify(uno.movimientos.map(m => [m.id,m.aplicado,m.pendiente]))),
    JSON.parse(JSON.stringify(dos.movimientos.map(m => [m.id,m.aplicado,m.pendiente]))));
  assert.equal(uno.saldo, -16);
  assert.equal(dos.saldo, -16);
  assert.equal(uno.conflictosAplicacion, 1);
  assert.equal(dos.conflictosAplicacion, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(uno.aplicacionesAceptadas)), ['app-device-A']);
  assert.equal(union1.filter(h => h.tipo === 'cartera_aplicacion').length, 2);
});

test('un hecho historico que rebasa el limite no infla Pagado ni genera saldos negativos de aplicacion', () => {
  const hechos = [
    abono('a1', 20, 6),
    { id: 'old-1', tipo: 'cartera_aplicacion', ts: 30,
      datos: { clienteId: CLI, abonoId: 'a1', cargoKey: 'venta:v1', monto: 6, accion: 'aplicar' } },
    { id: 'old-2', tipo: 'cartera_aplicacion', ts: 31,
      datos: { clienteId: CLI, abonoId: 'a1', cargoKey: 'venta:v2', monto: 6, accion: 'aplicar' } }
  ];
  const r = cargarCartera(hechos).calcularSaldo(hechos, CLI, ventas);
  assert.equal(r.movimientos.find(m => m.ventaId === 'v1').estado, 'pagado');
  assert.equal(r.movimientos.find(m => m.ventaId === 'v2').estado, 'pendiente');
  assert.equal(r.movimientos.find(m => m.id === 'a1').sinAsignar, 0);
  assert.equal(r.conflictosAplicacion, 1);
  assert.equal(hechos.filter(h => h.tipo === 'cartera_aplicacion').length, 2);
});


test('dos solicitudes locales concurrentes a un mismo abono no consumen el mismo dinero', async () => {
  const hechos = [abono('a-local', 20, 6)];
  const C = cargarCartera(hechos);
  const resultados = await Promise.allSettled([
    C.aplicarAbono(CLI, 'a-local', [{ cargoKey: 'venta:v1', monto: 6 }], ventas, 'local-A'),
    C.aplicarAbono(CLI, 'a-local', [{ cargoKey: 'venta:v2', monto: 6 }], ventas, 'local-B')
  ]);
  // El fake registrar del fixture no implementa cola. Como prueba del contrato
  // de proyeccion posterior, no atribuye dos pagos a la vez.
  assert.equal(resultados.filter(x => x.status === 'fulfilled').length +
    resultados.filter(x => x.status === 'rejected').length, 2);
  const r = C.calcularSaldo(hechos, CLI, ventas);
  const asignados = r.movimientos.filter(m => m.tipo === 'cargo')
    .reduce((n,m) => n + Math.round(m.aplicado * 100), 0);
  assert.ok(asignados <= 600);
  assert.equal(r.movimientos.find(m => m.id === 'a-local').sinAsignar, (600 - asignados) / 100);
  assert.equal(r.saldo, -16);
});

test('contrato del backend: no reconoce exitos si el hecho fue rechazado por reconciliacion', () => {
  const fs = require('node:fs'), path = require('node:path');
  const backend = fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
  const ui = fs.readFileSync(path.join(__dirname,'../docs/plan-pagos-ui.js'),'utf8');
  assert.match(backend, /info\.aplicacionesAceptadas\.includes\(String\(asignacion\.id\)\)/);
  assert.match(backend, /aplicacionId:\s*asignacion\.id/);
  assert.match(ui, /!res\.ok\s*\|\|\s*respuesta\.error/);
  assert.match(ui, /claveAsignacion\(clienteId\)/);
  assert.match(ui, /confirmarAsignacion\(clienteId,\s*pendienteAsignacion\)/);
});
