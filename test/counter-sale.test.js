/* Regresion de diseno (JFC 2026-09-22): COUNTER SALE pertenece a la casa.
   Una venta debe poder registrarse sin associate/comisionista, aun cuando el
   producto viva en una percha que normalmente reparte comision. La eleccion es
   por venta: no borra ni cambia el acuerdo permanente de la percha. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { browser: fixtureBrowser } = require('./helpers/browser.cjs');

test('counter sale records a pure house sale without changing the shelf associate', async () => {
  const app = fixtureBrowser();
  const associate = await app.request('/api/promotoras', 'POST', {
    nombre: 'Fixture associate',
    comisionBase: 30
  });
  const shelf = await app.request('/api/ubicaciones', 'POST', {
    nombre: 'Fixture commissioned shelf',
    tipo: 'socio',
    comisionSocio: 30
  });
  await app.request(`/api/ubicaciones/${shelf.id}`, 'PUT', {
    promotoraId: associate.id
  });
  const product = await app.request('/api/productos', 'POST', {
    nombre: 'Fixture counter-sale product',
    sku: 'FIX-COUNTER-SALE',
    barcode: 'FIX-COUNTER-SALE',
    precio: 25,
    costo: 10,
    stockInicial: 3,
    ubicacionId: shelf.id
  });

  await app.request(`/api/productos/${product.id}/venta`, 'POST', {
    cantidad: 1,
    modoComision: 'counter'
  });

  const backup = await app.request('/api/respaldo/exportar');
  const sale = backup.ventas.find(v => v.productoId === product.id);
  const shelfAfter = backup.ubicaciones.find(u => u.id === shelf.id);

  assert.ok(sale, 'la venta queda registrada');
  assert.equal(sale.split, null, 'COUNTER SALE no asigna comision a nadie');
  assert.equal(sale.modoComision, 'counter', 'queda documentado que fue venta de la casa');
  assert.equal(shelfAfter.promotoraId, associate.id,
    'la venta de la casa no borra el acuerdo permanente de la percha');

  const listed = (await app.request('/api/ventas/todas')).find(v => v.id === sale.id);
  assert.equal(listed.comisionAsociado, 0, 'el reporte muestra comisión cero');
  assert.equal(listed.asociadoNombre, '',
    'el reporte no atribuye COUNTER SALE al associate permanente de la percha');
});

test('sale UI offers COUNTER SALE and sends it without rewriting the shelf', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href,
      { waitUntil: 'networkidle' });

    const result = await page.evaluate(async () => {
      const req = async (url, method = 'GET', body) => {
        const response = await fetch(url, {
          method,
          headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(`${method} ${url}: ${JSON.stringify(data)}`);
        return data;
      };
      const associate = await req('/api/promotoras', 'POST', {
        nombre: 'UI fixture associate', comisionBase: 25
      });
      const shelf = await req('/api/ubicaciones', 'POST', {
        nombre: 'UI fixture shelf', tipo: 'socio', comisionSocio: 25
      });
      await req(`/api/ubicaciones/${shelf.id}`, 'PUT', { promotoraId: associate.id });
      const product = await req('/api/productos', 'POST', {
        nombre: 'UI fixture counter sale', barcode: 'UI-FIX-COUNTER', sku: 'UI-FIX-COUNTER',
        precio: 20, costo: 8, stockInicial: 2, ubicacionId: shelf.id
      });

      await abrirPanelVentaInfo(product.id, false);
      const select = document.getElementById('vi-comisionista');
      const option = Array.from(select.options).find(o => o.value === '__counter__');
      const optionText = option && option.textContent;
      const initialValue = select.value;
      select.value = '__counter__';
      await confirmarVentaConInfo(product.id, false);

      // La opción de persona sigue funcionando: COUNTER SALE no reemplaza ni
      // debilita el flujo comisionado, solo evita volverlo obligatorio.
      await abrirPanelVentaInfo(product.id, false);
      document.getElementById('vi-comisionista').value = associate.id;
      await confirmarVentaConInfo(product.id, false);

      const backup = await req('/api/respaldo/exportar');
      const sales = backup.ventas.filter(v => v.productoId === product.id);
      const sale = sales.find(v => v.modoComision === 'counter');
      const commissioned = sales.find(v => v.modoComision === 'acuerdo');
      const shelfAfter = backup.ubicaciones.find(u => u.id === shelf.id);
      return {
        optionText,
        initialValue,
        split: sale && sale.split,
        modoComision: sale && sale.modoComision,
        commissionedSplit: commissioned && commissioned.split,
        shelfAssociate: shelfAfter && shelfAfter.promotoraId,
        originalAssociate: associate.id
      };
    });

    assert.match(result.optionText, /house sale.*no commission/i);
    assert.equal(result.initialValue, result.originalAssociate,
      'un acuerdo existente sigue preseleccionado, pero se puede cambiar a COUNTER SALE');
    assert.equal(result.split, null);
    assert.equal(result.modoComision, 'counter');
    assert.equal(result.commissionedSplit.comisionPct, 25,
      'elegir al associate conserva la venta comisionada');
    assert.equal(result.shelfAssociate, result.originalAssociate);
  } finally {
    await web.close();
  }
});
