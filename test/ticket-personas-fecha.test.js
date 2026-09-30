// idiomARTE (JFC 2026-09-30, shell v430). Dos fallas en la venta de tickets/clases:
// 1. "People in the reservation: 2" y Confirm Sale registraba UNA sola unidad (cobraba y descontaba 1).
// 2. "Event/class date *" era obligatoria al vender; JFC: basta con ponerla al crear el producto.
// Rojas contra el shell v429.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

async function enApp(fn, arg) {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'networkidle' });
    return await page.evaluate(fn, arg);
  } finally { await web.close(); }
}
const PRE = async () => {
  window._req = async (url, method = 'GET', body) => (await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })).json();
  const rack = await window._req('/api/ubicaciones', 'POST', { nombre: 'Clases', tipo: 'propio' });
  return rack.id;
};

test('1. a ticket with 2 people in the reservation sells 2 units (price x2, stock -2)', async () => {
  const r = await enApp(async (pre) => {
    const rackId = await (0, eval)('(' + pre + ')')();
    const p = await _req('/api/productos', 'POST', { nombre: 'Clase salsa', barcode: 'TK-P2', precio: 15, costo: 0, stockInicial: 10, ubicacionId: rackId, tipoProducto: 'ticket', fechaEvento: '2026-10-10' });
    await abrirPanelVentaInfo(p.id, true);
    document.getElementById('vi-personas').value = '2';
    await confirmarVentaConInfo(p.id, true);
    const v = (await _req('/api/ventas/todas')).find((x) => x.productoId === p.id);
    const prod = (await _req('/api/productos')).find((x) => x.id === p.id);
    return { cant: v && v.cantidad, stock: prod.stockActual };
  }, PRE.toString());
  assert.equal(r.cant, 2, 'two people = two units');
  assert.equal(r.stock, 8);
});

test('2. the event date is set when creating the ticket; the sale needs no date and inherits it', async () => {
  const r = await enApp(async (pre) => {
    const rackId = await (0, eval)('(' + pre + ')')();
    const p = await _req('/api/productos', 'POST', { nombre: 'Clase tango', barcode: 'TK-F1', precio: 20, costo: 0, stockInicial: 5, ubicacionId: rackId, tipoProducto: 'ticket', fechaEvento: '2026-10-12' });
    await abrirPanelVentaInfo(p.id, true);
    const pre1 = document.getElementById('vi-fecha').value;
    document.getElementById('vi-fecha').value = '';
    await confirmarVentaConInfo(p.id, true);
    const v = (await _req('/api/ventas/todas')).find((x) => x.productoId === p.id);
    return { pre1, ok: !!v, fecha: v && (v.eventoFecha || (v.info && v.info.fechaEvento)) };
  }, PRE.toString());
  assert.equal(r.pre1, '2026-10-12', 'sale form comes prefilled from the product');
  assert.ok(r.ok, 'sale is recorded without typing a date');
  assert.equal(r.fecha, '2026-10-12', 'the sale keeps the ticket date');
});

test('3. the new-product and edit forms carry the event date for tickets', async () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(path.resolve(__dirname, '../docs/index.html'), 'utf8');
  assert.equal((html.match(/id="np-fecha-evento"/g) || []).length, 2, 'both new-product forms');
  assert.match(html, /id="ed-fecha-evento"/);
});
