// COMISION POR PRODUCTO (IdiomARTE / Belen, 2026-09-29): "ahora solo necesita dejarnos cambiar el
// porcentaje dependiendo del producto". Antes el % salia SOLO del trato de la percha (o de la persona).
// Promesa nueva: un producto puede traer su propio % para el asociado (pctAsociado). Vacio = manda el
// trato de la percha, como siempre. La regla dura sigue: la comision se SELLA en la venta; cambiar el %
// del producto (o de la percha) despues NUNCA recalcula ventas pasadas.
// Rojas contra el shell v423 (el campo no existia); "fijacion" = ya era correcto y se fija.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');

let n = 0;
const bc = () => 'PP-' + Date.now().toString(36) + (n++);
async function base(w, pctRack = 70) {
  const bel = await w.request('/api/promotoras', 'POST', { nombre: 'Belen Carpio', comisionBase: pctRack });
  const rack = await w.request('/api/ubicaciones', 'POST', { nombre: 'Belen programs', tipo: 'socio' });
  await w.request(`/api/ubicaciones/${rack.id}`, 'PUT', { promotoraId: bel.id, comisionSocio: pctRack });
  return { bel, rack };
}
const prod = (w, rack, extra = {}) => w.request('/api/productos', 'POST', Object.assign({ nombre: 'Club ' + bc(), barcode: bc(), precio: 100, costo: 0, stockInicial: 20, ubicacionId: rack.id }, extra));
const ventas = async (w) => w.request('/api/ventas/todas');

test('fijacion: the rack deal 70/30 applies to every sale of a product without its own percentage', async () => {
  const w = browser(); w.OCAuth = { rolActual: () => 'dueno' };
  const { rack } = await base(w, 70);
  const p = await prod(w, rack);
  await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  const v = (await ventas(w)).find((x) => x.productoId === p.id);
  assert.equal(v.comisionPct, 70); assert.equal(v.comisionAsociado, 70); assert.equal(v.netoCasa, 30);
});

test('1. a product with its own percentage (60) overrides the rack deal (70); its sibling keeps 70', async () => {
  const w = browser(); w.OCAuth = { rolActual: () => 'dueno' };
  const { rack } = await base(w, 70);
  const a = await prod(w, rack, { pctAsociado: 60 });
  const b = await prod(w, rack);
  await w.request(`/api/productos/${a.id}/venta`, 'POST', { cantidad: 1 });
  await w.request(`/api/productos/${b.id}/venta`, 'POST', { cantidad: 1 });
  const vs = await ventas(w);
  const va = vs.find((x) => x.productoId === a.id), vb = vs.find((x) => x.productoId === b.id);
  assert.equal(va.comisionPct, 60); assert.equal(va.comisionAsociado, 60); assert.equal(va.netoCasa, 40);
  assert.equal(vb.comisionPct, 70); assert.equal(vb.comisionAsociado, 70);
});

test('2. commission + house always add up to the gross, to the cent (33.33 on a 99.99 sale)', async () => {
  const w = browser(); w.OCAuth = { rolActual: () => 'dueno' };
  const { rack } = await base(w, 70);
  const a = await prod(w, rack, { pctAsociado: 33.33, precio: 99.99 });
  await w.request(`/api/productos/${a.id}/venta`, 'POST', { cantidad: 1 });
  const v = (await ventas(w)).find((x) => x.productoId === a.id);
  assert.equal(+(v.comisionAsociado + v.netoCasa).toFixed(2), 99.99);
});

test('3. editing the product percentage changes NEW sales only; the old sale keeps its sealed percentage', async () => {
  const w = browser(); w.OCAuth = { rolActual: () => 'dueno' };
  const { rack } = await base(w, 70);
  const a = await prod(w, rack, { pctAsociado: 60 });
  await w.request(`/api/productos/${a.id}/venta`, 'POST', { cantidad: 1 });
  await w.request(`/api/productos/${a.id}`, 'PATCH', { pctAsociado: 50 });
  await w.request(`/api/productos/${a.id}/venta`, 'POST', { cantidad: 1 });
  const vs = (await ventas(w)).filter((x) => x.productoId === a.id).map((x) => x.comisionPct).sort();
  assert.deepEqual(vs, [50, 60], 'first sale sealed at 60, second at 50');
});

test('4. clearing the product percentage goes back to the rack deal', async () => {
  const w = browser(); w.OCAuth = { rolActual: () => 'dueno' };
  const { rack } = await base(w, 70);
  const a = await prod(w, rack, { pctAsociado: 60 });
  await w.request(`/api/productos/${a.id}`, 'PATCH', { pctAsociado: '' });
  await w.request(`/api/productos/${a.id}/venta`, 'POST', { cantidad: 1 });
  assert.equal((await ventas(w)).find((x) => x.productoId === a.id).comisionPct, 70);
});

test('5. 0 is a real percentage (associate takes nothing), not "empty"', async () => {
  const w = browser(); w.OCAuth = { rolActual: () => 'dueno' };
  const { rack } = await base(w, 70);
  const a = await prod(w, rack, { pctAsociado: 0 });
  await w.request(`/api/productos/${a.id}/venta`, 'POST', { cantidad: 1 });
  const v = (await ventas(w)).find((x) => x.productoId === a.id);
  assert.equal(v.comisionPct, 0); assert.equal(v.comisionAsociado, 0); assert.equal(v.netoCasa, 100);
});

test('6. out-of-range and garbage values are clamped or ignored, never stored as money', async () => {
  const w = browser(); w.OCAuth = { rolActual: () => 'dueno' };
  const { rack } = await base(w, 70);
  const a = await prod(w, rack, { pctAsociado: 150 });
  const b = await prod(w, rack, { pctAsociado: 'abc' });
  const c = await prod(w, rack, { pctAsociado: -5 });
  for (const p of [a, b, c]) await w.request(`/api/productos/${p.id}/venta`, 'POST', { cantidad: 1 });
  const vs = await ventas(w);
  assert.equal(vs.find((x) => x.productoId === a.id).comisionPct, 100, '150 -> 100');
  assert.equal(vs.find((x) => x.productoId === b.id).comisionPct, 70, 'garbage -> rack deal');
  assert.equal(vs.find((x) => x.productoId === c.id).comisionPct, 0, '-5 -> 0');
});

test('7. COUNTER SALE stays a pure house sale even when the product has its own percentage', async () => {
  const w = browser(); w.OCAuth = { rolActual: () => 'dueno' };
  const { rack } = await base(w, 70);
  const a = await prod(w, rack, { pctAsociado: 60 });
  await w.request(`/api/productos/${a.id}/venta`, 'POST', { cantidad: 1, modoComision: 'counter' });
  const v = (await ventas(w)).find((x) => x.productoId === a.id);
  assert.equal(v.comisionPct, null); assert.equal(v.comisionAsociado, 0);
});

test('8. day close (cierre) and reclassifying a house sale also use the product percentage', async () => {
  const w = browser(); w.OCAuth = { rolActual: () => 'dueno' };
  const { rack, bel } = await base(w, 70);
  const a = await prod(w, rack, { pctAsociado: 60 });
  const r = await w.request('/api/ventas/cierre', 'POST', { items: [{ productoId: a.id, cantidad: 1 }] });
  assert.ok(r && !r.error, JSON.stringify(r));
  const cierre = (await ventas(w)).find((x) => x.productoId === a.id);
  assert.equal(cierre.comisionPct, 60, 'day close');
  await w.request(`/api/productos/${a.id}/venta`, 'POST', { cantidad: 1, modoComision: 'counter' });
  const casa = (await ventas(w)).find((x) => x.productoId === a.id && x.modoComision === 'counter');
  const prev = await w.request(`/api/ventas/${casa.id}/asignar-comision`, 'POST', { promotoraId: bel.id, preview: true });
  assert.equal(prev.split.comisionPct, 60, 'reclassification preview');
});

test('9. the product sheet carries the percentage and clearing it returns to null', async () => {
  const w = browser(); w.OCAuth = { rolActual: () => 'dueno' };
  const { rack } = await base(w, 70);
  const a = await prod(w, rack, { pctAsociado: 45 });
  const ficha = await w.request(`/api/productos/${a.id}`);
  assert.equal(ficha.pctAsociado, 45, 'the product sheet (edit form) carries pctAsociado');
  await w.request(`/api/productos/${a.id}`, 'PATCH', { pctAsociado: '' });
  assert.equal((await w.request(`/api/productos/${a.id}`)).pctAsociado, null, 'cleared -> null');
});

test('fijacion (UI): both product forms carry the field and it has EN and ES texts', () => {
  const fs = require('node:fs'), path = require('node:path');
  const html = fs.readFileSync(path.resolve(__dirname, '../docs/index.html'), 'utf8');
  const i18n = fs.readFileSync(path.resolve(__dirname, '../docs/i18n.js'), 'utf8');
  for (const id of ['np-pct-asociado', 'np-pct-asociado-q', 'ed-pct-asociado']) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(/pctAsociado: v\("ed-pct-asociado"\)/.test(html), 'edit sends the field');
  for (const k of ['form.assocPct', 'form.assocPctPh', 'form.assocPctHint']) assert.equal(i18n.split(`"${k}":`).length - 1, 2, k + ' in EN and ES');
});
