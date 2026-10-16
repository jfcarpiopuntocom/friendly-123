const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

for (const lang of ['es', 'en']) test('reservation and walk-in forms and actual sale (' + lang + ')', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.OCAuth && window.OCI18n && typeof mostrarFormNuevoProducto === 'function');
    const result = await page.evaluate(async lang => {
      OCAuth.rolActual = () => 'dueno'; OCI18n.setLang(lang);
      const req = async (url, method = 'GET', body) => {
        const r = await fetch(url, { method, body: body ? JSON.stringify(body) : undefined });
        if (!r.ok) throw Error(await r.text()); return r.json();
      };
      mostrarFormNuevoProducto('SYNTHETIC-RESERVE-UI');
      const formHasPrices = !!document.getElementById('np-precio-reserva') && !!document.getElementById('np-precio-walkin');
      for (const [id, value] of Object.entries({ 'np-nombre': 'Synthetic class', 'np-precio': '18', 'np-precio-reserva': '15', 'np-precio-walkin': '18', 'np-costo': '2', 'np-stock': '5', 'np-tipo-producto': 'ticket' })) document.getElementById(id).value = value;
      await crearProductoNuevo('SYNTHETIC-RESERVE-UI');
      const product = (await req('/api/respaldo/exportar')).productos.find(p => p.barcode === 'SYNTHETIC-RESERVE-UI');
      if (!product) throw Error('Product form did not save its fields');
      await mostrarFormEditarProducto(product.id);
      const editPrices = [document.getElementById('ed-precio-reserva').value, document.getElementById('ed-precio-walkin').value];
      await abrirPanelVentaInfo(product.id, true);
      await confirmarVentaConInfo(product.id, true);
      const missing = document.getElementById('vi-msg').textContent;
      const salesBefore = (await req('/api/respaldo/exportar')).ventas.filter(v => v.productoId === product.id).length;
      document.getElementById('vi-modalidad').value = 'reservation';
      document.getElementById('vi-modalidad').dispatchEvent(new Event('change'));
      document.getElementById('vi-personas').value = '2';
      await confirmarVentaConInfo(product.id, true);
      const sales = (await req('/api/respaldo/exportar')).ventas.filter(v => v.productoId === product.id);
      const categories = OCCategorias.listar([{ categoria: 'Tickets & events' }, { categoria: 'Events' }]);
      return { formHasPrices, editPrices, missing, salesBefore, sales, categories };
    }, lang);
    assert.equal(result.formHasPrices, true);
    assert.deepEqual(result.editPrices, ['15', '18']);
    assert.match(result.missing, /reserva|reservation/);
    assert.equal(result.salesBefore, 0);
    assert.equal(result.sales.length, 1);
    assert.equal(result.sales[0].precioUnit, 15);
    assert.equal(result.sales[0].cantidad, 2);
    assert.equal(result.sales[0].modalidadVenta, 'reservation');
    assert.equal(result.categories.filter(c => c === 'Events').length, 1);
    assert.ok(!result.categories.includes('Tickets & events'));
  } finally { await web.close(); }
});
