/* Invariantes al arrancar (JFC 2026-09-30). Reglas: dinero SOLO se avisa, nunca se repara;
   lo unico que se repara es lo derivable sin dinero (percha vacia en una venta). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function cargar() {
  const w = { console };
  w.window = w; w.globalThis = w;
  vm.createContext(w);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'docs', 'invariantes.js'), 'utf8'), w);
  return w.OCInvariantes;
}
const prod = [{ id: 'p1', ubicacionId: 'u1' }];
const ubi = [{ id: 'u1' }];
const buena = () => ({ id: 'v1', productoId: 'p1', ubicacionId: 'u1', cantidad: 2, precioUnit: 10, costoUnit: 4,
  split: { montoBruto: 20, montoComisionSocio: 6, montoNetoDueno: 14 } });
const codigos = (r) => r.avisos.map((a) => a.codigo);

test('una venta sana no genera avisos ni reparaciones', () => {
  const r = cargar().revisar({ ventas: [buena()], productos: prod, ubicaciones: ubi });
  assert.equal(r.avisos.length, 0); assert.equal(r.reparaciones.length, 0); // .length: los arreglos del vm tienen otro prototipo
});
test('comision + neto distinto del bruto se AVISA y no se toca', () => {
  const v = buena(); v.split.montoNetoDueno = 13;
  const r = cargar().revisar({ ventas: [v], productos: prod, ubicaciones: ubi });
  assert.ok(codigos(r).includes('dinero-partido'));
  assert.equal(v.split.montoNetoDueno, 13, 'el dinero no se reescribe');
});
test('comision mayor que la venta, bruto distinto y numeros invalidos se avisan', () => {
  const a = buena(); a.split.montoComisionSocio = 25; a.split.montoNetoDueno = -5;
  const b = buena(); b.id = 'v2'; b.split.montoBruto = 99; b.split.montoComisionSocio = 0; b.split.montoNetoDueno = 99;
  const c = buena(); c.id = 'v3'; c.precioUnit = -1; c.split = null;
  const d = buena(); d.id = 'v4'; d.cantidad = NaN; d.split = null;
  const cs = codigos(cargar().revisar({ ventas: [a, b, c, d], productos: prod, ubicaciones: ubi }));
  ['comision-mayor-que-venta', 'bruto-distinto', 'numero-invalido'].forEach((k) => assert.ok(cs.includes(k), k));
});
test('id duplicado y producto huerfano se avisan; ninguna venta se borra', () => {
  const a = buena(); const b = buena(); const h = buena(); h.id = 'v9'; h.productoId = 'no-existe';
  const ventas = [a, b, h];
  const r = cargar().revisar({ ventas, productos: prod, ubicaciones: ubi });
  assert.ok(codigos(r).includes('id-duplicado'));
  assert.ok(codigos(r).includes('producto-huerfano'));
  assert.equal(ventas.length, 3);
});
test('anuladas no se revisan (su dinero ya no cuenta)', () => {
  const v = buena(); v.anulada = true; v.split.montoNetoDueno = 1;
  assert.equal(cargar().revisar({ ventas: [v], productos: prod, ubicaciones: ubi }).avisos.length, 0);
});
test('percha vacia: se LLENA desde el producto; una percha ya puesta NUNCA se sobrescribe', () => {
  const vacia = buena(); vacia.ubicacionId = '';
  const otra = buena(); otra.id = 'v2'; otra.ubicacionId = 'u-vieja';
  const I = cargar();
  const r = I.revisar({ ventas: [vacia, otra], productos: prod, ubicaciones: ubi });
  assert.equal(r.reparaciones.length, 1);
  assert.equal(r.reparaciones[0].ventaId, 'v1');
  I.aplicar(r, [vacia, otra]);
  assert.equal(vacia.ubicacionId, 'u1');
  assert.equal(otra.ubicacionId, 'u-vieja');
});
test('aplicar solo ejecuta reparaciones: jamas cambia dinero aunque haya avisos de dinero', () => {
  const v = buena(); v.split.montoNetoDueno = 13; v.ubicacionId = '';
  const I = cargar(); const r = I.revisar({ ventas: [v], productos: prod, ubicaciones: ubi });
  I.aplicar(r, [v]);
  assert.equal(v.split.montoNetoDueno, 13); assert.equal(v.ubicacionId, 'u1');
});
