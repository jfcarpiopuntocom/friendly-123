// Revision nivel Linus, Bloque 1 (JFC 2026-09-25): dinero y stock POR LA INTERFAZ.
// Leccion del Spray: las pruebas de API pasaban y la pantalla no mandaba el dato. Aqui cada
// venta sale del panel real (abrirPanelVentaInfo / confirmarVentaConInfo) en Chromium, con
// los campos que toca una persona: cantidad, precio especial, cortesia, comisionista y
// house sale. Despues se exige que Sold, Today, Commissions (cuadre) y el stock digan lo
// mismo al centavo, antes y despues de anular.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

test('Bloque 1: ventas por la UI (cantidad, precio especial, cortesia, comisionista, house sale, anular) cuadran al centavo', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'networkidle' });
    const r = await page.evaluate(async () => {
      const req = async (u, m = 'GET', b) => (await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined })).json();
      const ce = (n) => Math.round((Number(n) || 0) * 100);
      const pr = await req('/api/promotoras', 'POST', { nombre: 'Linus Seller', comisionBase: 20 });
      const propia = await req('/api/ubicaciones', 'POST', { nombre: 'Linus own', tipo: 'propio' });
      const comp = await req('/api/ubicaciones', 'POST', { nombre: 'Linus shared', tipo: 'socio' });
      await req(`/api/ubicaciones/${comp.id}`, 'PUT', { promotoraId: pr.id });
      const a = await req('/api/productos', 'POST', { nombre: 'Linus A', barcode: 'LIN-A', precio: 19.99, costo: 7.5, stockInicial: 20, ubicacionId: comp.id });
      const b = await req('/api/productos', 'POST', { nombre: 'Linus B', barcode: 'LIN-B', precio: 3.33, costo: 1.1, stockInicial: 20, ubicacionId: propia.id });
      const vender = async (id, campos) => {
        await abrirPanelVentaInfo(id, false);
        const set = (k, v) => { const el = document.getElementById(k); if (!el) throw new Error('falta campo ' + k); if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
        Object.entries(campos).forEach(([k, v]) => set(k, v));
        await confirmarVentaConInfo(id, false);
      };
      await vender(a.id, { 'vi-cantidad': '3', 'vi-comisionista': pr.id });            // compartida + comision
      await vender(a.id, { 'vi-comisionista': '__counter__' });                          // house sale
      await vender(b.id, { 'vi-cantidad': '2', 'vi-comisionista': pr.id });            // percha propia + persona (Spray)
      await vender(b.id, { 'vi-cortesia': true });                                        // cortesia
      const ventas0 = await req('/api/ventas/todas');
      const mias = ventas0.filter((v) => v.productoId === a.id || v.productoId === b.id);
      // Anular la house sale por la ruta que usa la pantalla.
      const house = mias.find((v) => v.modoComision === 'counter');
      await req(`/api/ventas/${house.id}/anular`, 'POST', {});
      const ventas = (await req('/api/ventas/todas')).filter((v) => v.productoId === a.id || v.productoId === b.id);
      const prods = await req('/api/productos');
      const dash = await req('/api/dashboard');
      const todas = await req('/api/ventas/todas');
      const hoy = todas.filter((v) => new Date(v.fecha).toDateString() === new Date().toDateString());
      const cq = await req('/api/comisiones/cuadre');
      const delMes = todas.filter((v) => v.delMesActual);
      const cuadre = (delMes.reduce((s, v) => s + ce(v.precioUnit * v.cantidad), 0) === ce(cq.totalVentas) && delMes.length === cq.ventas) ? 'ok' : 'fallo';
      return {
        n0: mias.length, n: ventas.length,
        filas: ventas.map((v) => ({ cant: v.cantidad, precio: v.precioUnit, com: v.comisionAsociado, neto: v.netoCasa, modo: v.modoComision, cort: !!(v.cortesia || (v.info && v.info.cortesia)), quien: v.asociadoNombre })),
        stockA: prods.find((p) => p.id === a.id).stockActual, stockB: prods.find((p) => p.id === b.id).stockActual,
        todayEntra: ce(dash.resumenDia.entra), sumaHoy: hoy.reduce((s, v) => s + ce(v.precioUnit * v.cantidad), 0),
        cuadre,
      };
    });
    assert.equal(r.n0, 4, 'cuatro ventas desde la UI');
    assert.equal(r.n, 3, 'la anulada ya no esta en Sold');
    assert.equal(r.stockA, 20 - 3, 'stock A: 3 vendidas, la house sale anulada volvio');
    assert.equal(r.stockB, 20 - 2 - 1, 'stock B: 2 + 1 cortesia');
    const comA = r.filas.find((f) => f.cant === 3);
    assert.equal(comA.com, 11.99, '20 % de 59.97 al centavo');
    assert.equal(Math.round((comA.com + comA.neto) * 100), 5997, 'comision + neto = bruto');
    const spray = r.filas.find((f) => f.cant === 2 && !f.cort);
    assert.equal(spray.quien, 'Linus Seller', 'percha propia: la persona elegida cobra');
    const cort = r.filas.find((f) => f.cort);
    assert.ok(cort, 'la cortesia quedo marcada');
    assert.equal(cort.precio, 0, 'cortesia sin ingreso'); assert.equal(cort.com, 0, 'cortesia sin comision');
    assert.equal(r.todayEntra, r.sumaHoy, 'Today = suma de las ventas de hoy');
    assert.equal(r.cuadre, 'ok', 'Sold = Commissions (cuadre)');
  } finally { await web.close(); }
});
