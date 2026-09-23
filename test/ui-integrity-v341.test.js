/* JFC 2026-09-22: pruebas de integridad de UI con datos ficticios y aislados.
   Nunca apuntan a licencias, clientes o inventario reales. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { browser: fixtureBrowser } = require('./helpers/browser.cjs');

async function withPage(fn) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href,
      { waitUntil: 'networkidle' });
    return await fn(page);
  } finally { await browser.close(); }
}

test('invalid sale price cannot silently charge list price or reduce stock', async () => {
  const result = await withPage(page => page.evaluate(async () => {
    const req = async (url, method = 'GET', body) => {
      const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));
      return data;
    };
    const shelf = await req('/api/ubicaciones', 'POST', { nombre: 'Price guard fixture' });
    const product = await req('/api/productos', 'POST', {
      nombre: 'Price guard item', sku: 'FIX-PRICE-GUARD', barcode: 'FIX-PRICE-GUARD',
      precio: 25, costo: 10, stockInicial: 2, ubicacionId: shelf.id
    });
    await abrirPanelVentaInfo(product.id, false);
    document.getElementById('vi-precio-override').value = '-1';
    await confirmarVentaConInfo(product.id, false);
    const backup = await req('/api/respaldo/exportar');
    return { message: document.getElementById('vi-msg')?.textContent || '',
      sales: backup.ventas.filter(v => v.productoId === product.id).length,
      stock: backup.productos.find(p => p.id === product.id).stockActual };
  }));
  assert.match(result.message, /precio|price/i);
  assert.equal(result.sales, 0);
  assert.equal(result.stock, 2);
});

test('category batch changes multiple product labels in one validated operation without touching stock or price', async () => {
  const app = fixtureBrowser();
  const shelf = await app.request('/api/ubicaciones', 'POST', { nombre: 'Batch fixture shelf' });
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const p = await app.request('/api/productos', 'POST', {
      nombre: `Batch fixture item ${i}`, sku: `FIX-BATCH-${i}`, barcode: `FIX-BATCH-${i}`,
      categoria: 'Before batch', precio: 25 + i, costo: 10, stockInicial: 3 + i,
      ubicacionId: shelf.id
    });
    ids.push(p.id);
  }
  const result = await app.request('/api/categorias/cambiar', 'POST',
    { vieja: 'Before batch', nueva: 'After batch' });
  const backup = await app.request('/api/respaldo/exportar');
  assert.equal(result.actualizados, 2);
  assert.deepEqual(ids.map(id => backup.productos.find(p => p.id === id).categoria),
    ['After batch', 'After batch']);
  assert.deepEqual(ids.map(id => backup.productos.find(p => p.id === id).stockActual), [3, 4]);
  assert.deepEqual(ids.map(id => backup.productos.find(p => p.id === id).precio), [25, 26]);
});

test('category rename must not report success after a rejected product update', async () => {
  const result = await withPage(page => page.evaluate(async () => {
    const req = async (url, method = 'GET', body) => {
      const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));
      return data;
    };
    const shelf = await req('/api/ubicaciones', 'POST', { nombre: 'Category guard fixture' });
    const product = await req('/api/productos', 'POST', {
      nombre: 'Category guard item', sku: 'FIX-CAT-GUARD', barcode: 'FIX-CAT-GUARD',
      categoria: 'Old fixture category', precio: 25, costo: 10, stockInicial: 2,
      ubicacionId: shelf.id
    });
    const originalFetch = window.fetch;
    window.fetch = (url, options) => {
      if (String(url) === '/api/categorias/cambiar' && options?.method === 'POST')
        return Promise.resolve(new Response(JSON.stringify({ error: 'Older shell fixture' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }));
      if (String(url).includes('/api/productos/') && options?.method === 'PATCH')
        return Promise.resolve(new Response(JSON.stringify({ error: 'Fixture rejected update' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }));
      return originalFetch(url, options);
    };
    let rejected = false;
    try { await window.OCCategorias.renombrar('Old fixture category', 'New fixture category'); }
    catch (_) { rejected = true; }
    window.fetch = originalFetch;
    const backup = await req('/api/respaldo/exportar');
    return { rejected, category: backup.productos.find(p => p.id === product.id).categoria,
      custom: localStorage.getItem('f123_categorias_custom') || '[]' };
  }));
  assert.equal(result.rejected, true);
  assert.equal(result.category, 'Old fixture category');
  assert.equal(JSON.parse(result.custom).includes('New fixture category'), false);
});

test('category deletion must not hide a category when its product update is rejected', async () => {
  const result = await withPage(page => page.evaluate(async () => {
    const req = async (url, method = 'GET', body) => {
      const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));
      return data;
    };
    const shelf = await req('/api/ubicaciones', 'POST', { nombre: 'Delete guard fixture' });
    const product = await req('/api/productos', 'POST', {
      nombre: 'Delete guard item', sku: 'FIX-DELETE-GUARD', barcode: 'FIX-DELETE-GUARD',
      categoria: 'Protected fixture category', precio: 25, costo: 10, stockInicial: 2,
      ubicacionId: shelf.id
    });
    const originalFetch = window.fetch;
    window.fetch = (url, options) => {
      if (String(url) === '/api/categorias/cambiar' && options?.method === 'POST')
        return Promise.resolve(new Response(JSON.stringify({ error: 'Older shell fixture' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }));
      if (String(url).includes('/api/productos/') && options?.method === 'PATCH')
        return Promise.resolve(new Response(JSON.stringify({ error: 'Fixture rejected update' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }));
      return originalFetch(url, options);
    };
    let rejected = false;
    try { await window.OCCategorias.borrar('Protected fixture category'); }
    catch (_) { rejected = true; }
    window.fetch = originalFetch;
    const backup = await req('/api/respaldo/exportar');
    return { rejected, category: backup.productos.find(p => p.id === product.id).categoria,
      hidden: localStorage.getItem('f123_categorias_ocultas') || '[]' };
  }));
  assert.equal(result.rejected, true);
  assert.equal(result.category, 'Protected fixture category');
  assert.equal(JSON.parse(result.hidden).includes('Protected fixture category'), false);
});

test('category manager preserves feedback and switches language without losing typed edits', async () => {
  const result = await withPage(page => page.evaluate(() => {
    const originalRole = window.OCAuth.rolActual;
    window.OCAuth.rolActual = () => 'demo';
    window.OCCategorias.agregar('Fixture category');
    abrirGestorCategorias();
    window.OCAuth.rolActual = originalRole;
    const panel = document.getElementById('oc-cat-manager');
    const input = panel.querySelector('#oc-cat-nueva');
    input.value = 'New fixture category';
    panel.querySelector('[data-cat-add]').click();
    const feedback = panel.querySelector('#oc-cat-msg').textContent;
    const row = panel.querySelector('[data-cat-rename="Fixture category"]');
    row.click();
    const editing = panel.querySelector('[data-cat-rn-input]');
    editing.value = 'Unsent typed category';
    window.OCI18n.setLang('es');
    return { feedback, title: panel.querySelector('strong[data-i18n]').textContent,
      typed: panel.querySelector('[data-cat-rn-input]')?.value,
      add: panel.querySelector('[data-cat-add]').textContent };
  }));
  assert.match(result.feedback, /added|agregad/i);
  assert.equal(result.typed, 'Unsent typed category');
  assert.match(result.title, /Categor/i);
  assert.match(result.add, /Agregar|Añadir/i);
});

test('a rejected location list preserves the selected shelf and shows an error', async () => {
  const result = await withPage(page => page.evaluate(async () => {
    const before = document.getElementById('selectUbicacion').innerHTML;
    const originalFetch = window.fetch;
    window.fetch = (url, options) => String(url) === '/api/ubicaciones' && !options
      ? Promise.resolve(new Response(JSON.stringify({ error: 'Fixture unavailable' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }))
      : originalFetch(url, options);
    let threw = false;
    try { await cargarUbicaciones(); } catch (_) { threw = true; }
    window.fetch = originalFetch;
    return { threw, before, after: document.getElementById('selectUbicacion').innerHTML,
      message: document.getElementById('oc-ubicacion-estado')?.textContent || '' };
  }));
  assert.equal(result.threw, false);
  assert.equal(result.after, result.before);
  assert.match(result.message, /ubicaciones|locations/i);
});

test('failed business rename keeps the old identity and informs the owner', async () => {
  const result = await withPage(page => page.evaluate(async () => {
    const name = document.getElementById('oc-negocio-nombre');
    const originalName = window.OCTienda.nombreActivo;
    window.OCTienda.nombreActivo = () => 'Original fixture business';
    window.dispatchEvent(new CustomEvent('oc-negocio-actualizado',
      { detail: { nombre: 'Original fixture business' } }));
    const originalPrompt = window.prompt;
    const originalFetch = window.fetch;
    window.prompt = () => 'New fixture business';
    window.fetch = (url, options) => String(url).includes('/api/instancia/nombre') && options?.method === 'POST'
      ? Promise.resolve(new Response(JSON.stringify({ error: 'Fixture reject' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }))
      : originalFetch(url, options);
    document.getElementById('oc-negocio-editar').click();
    await new Promise(resolve => setTimeout(resolve, 50));
    window.prompt = originalPrompt;
    window.fetch = originalFetch;
    window.OCTienda.nombreActivo = originalName;
    return { name: name.textContent,
      message: document.getElementById('oc-negocio-estado')?.textContent || '',
      visible: document.getElementById('oc-negocio-estado')?.style.display };
  }));
  assert.equal(result.name, 'Original fixture business');
  assert.match(result.message, /name|nombre/i);
  assert.notEqual(result.visible, 'none');
});

test('an open sale receives a newly synchronized customer without losing the current selection', async () => {
  const result = await withPage(page => page.evaluate(async () => {
    const req = async (url, method = 'GET', body) => {
      const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));
      return data;
    };
    const shelf = await req('/api/ubicaciones', 'POST', { nombre: 'Customer sync fixture' });
    const product = await req('/api/productos', 'POST', {
      nombre: 'Customer sync item', sku: 'FIX-CLIENT-SYNC', barcode: 'FIX-CLIENT-SYNC',
      precio: 25, costo: 10, stockInicial: 2, ubicacionId: shelf.id
    });
    const first = await req('/api/clientes', 'POST', { nombre: 'Selected fixture client' });
    await abrirPanelVentaInfo(product.id, false);
    const select = document.getElementById('vi-cliente');
    select.value = first.id;
    const second = await req('/api/clientes', 'POST', { nombre: 'Remote fixture client' });
    window.OCReactivo.emitir('clientes');
    await new Promise(resolve => setTimeout(resolve, 80));
    return { selected: select.value, first: first.id,
      hasNew: Array.from(select.options).some(o => o.value === second.id) };
  }));
  assert.equal(result.selected, result.first);
  assert.equal(result.hasNew, true);
});

test('quick customer creation during sale can save an email address', async () => {
  const result = await withPage(page => page.evaluate(async () => {
    const req = async (url, method = 'GET', body) => {
      const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));
      return data;
    };
    const shelf = await req('/api/ubicaciones', 'POST', { nombre: 'Email fixture shelf' });
    const product = await req('/api/productos', 'POST', {
      nombre: 'Email fixture item', sku: 'FIX-EMAIL', barcode: 'FIX-EMAIL',
      precio: 25, costo: 10, stockInicial: 2, ubicacionId: shelf.id
    });
    await abrirPanelVentaInfo(product.id, false);
    document.getElementById('vi-nuevo-cliente').click();
    document.getElementById('vi-newcli-nombre').value = 'Email fixture client';
    const email = document.getElementById('vi-newcli-email');
    if (!email) return { hasField: false };
    email.value = 'fixture@example.test';
    document.getElementById('vi-newcli-save').click();
    await new Promise(resolve => setTimeout(resolve, 80));
    const backup = await req('/api/respaldo/exportar');
    return { hasField: true, email: backup.clientes.find(c => c.nombre === 'Email fixture client')?.email };
  }));
  assert.equal(result.hasField, true);
  assert.equal(result.email, 'fixture@example.test');
});

test('sale details translate in place and preserve unsaved notes when switching language', async () => {
  const result = await withPage(page => page.evaluate(async () => {
    const req = async (url, method = 'GET', body) => {
      const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));
      return data;
    };
    const shelf = await req('/api/ubicaciones', 'POST', { nombre: 'Locale fixture shelf' });
    const product = await req('/api/productos', 'POST', {
      nombre: 'Locale fixture item', sku: 'FIX-LOCALE', barcode: 'FIX-LOCALE',
      precio: 25, costo: 10, stockInicial: 2, ubicacionId: shelf.id
    });
    await abrirPanelVentaInfo(product.id, false);
    document.getElementById('vi-notas').value = 'Unsent fixture note';
    document.querySelector('.oc-lang-btn[data-lang="es"]').click();
    return { title: document.querySelector('#oc-ventainfo-caja .titulo')?.textContent || '',
      notes: document.getElementById('vi-notas')?.value || '',
      save: document.querySelector('#vi-guardar')?.textContent || '' };
  }));
  assert.match(result.title, /Detalles|venta/i);
  assert.doesNotMatch(result.title, /Sale details/i);
  assert.equal(result.notes, 'Unsent fixture note');
});

test('the whole sale panel translates in place without changing stored values or typed input', async () => {
  /* v345 (Codex #8 completo): los 18 textos del panel de venta. Lo crítico no
     es la traducción: es que traducir NO cambie datos. Los <option> de forma de
     pago tienen value explícito, así que "Efectivo" sigue guardando "cash"; y
     las etiquetas que envuelven inputs traducen solo su <span>, sin borrar el
     input de adentro. */
  const r = await withPage(page => page.evaluate(async () => {
    const req = async (url, method = 'GET', body) => {
      const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined });
      return res.json();
    };
    const shelf = await req('/api/ubicaciones', 'POST', { nombre: 'Panel i18n fixture' });
    const product = await req('/api/productos', 'POST', { nombre: 'Panel item', sku: 'FIX-PANEL', barcode: 'FIX-PANEL',
      precio: 5, costo: 2, stockInicial: 3, ubicacionId: shelf.id });
    await abrirPanelVentaInfo(product.id, false);
    document.getElementById('vi-notas').value = 'nota sin guardar';
    document.getElementById('vi-forma-pago').value = 'cash';
    document.querySelector('.oc-lang-btn[data-lang="es"]').click();
    const caja = document.getElementById('oc-ventainfo-caja');
    return {
      texto: caja.textContent,
      valores: [...document.querySelectorAll('#vi-forma-pago option')].map(o => o.value),
      pago: document.getElementById('vi-forma-pago').value,
      notas: document.getElementById('vi-notas').value,
      inputsVivos: ['vi-email', 'vi-notas', 'vi-forma-pago'].every(id => !!document.getElementById(id)),
      aria: document.getElementById('vi-msg').getAttribute('aria-live'),
    };
  }));
  for (const es of ['Forma de pago', 'Efectivo', 'Confirmar venta', 'Cancelar', 'Notas (opcional)']) {
    assert.ok(r.texto.includes(es), 'falta en español: ' + es);
  }
  assert.ok(!r.texto.includes('Payment method'), 'no queda inglés en el panel');
  assert.deepEqual(r.valores, ['', 'cash', 'transfer', 'card', 'other'], 'los valores guardados NO cambian con el idioma');
  assert.equal(r.pago, 'cash', 'la forma de pago elegida se conserva');
  assert.equal(r.notas, 'nota sin guardar', 'lo escrito no se pierde');
  assert.equal(r.inputsVivos, true, 'traducir una etiqueta no borra el input de adentro');
  assert.equal(r.aria, 'polite', 'el mensaje de la venta se anuncia a lectores de pantalla');
});

test('pending-payment filter shows only customers who owe, with one touch (Belen)', async () => {
  /* v346: botón "Pago pendiente" en Clientes. Solo dueño/admin. Encendido =
     solo los que deben (saldo < 0); tocarlo de nuevo = todos otra vez. */
  const r = await withPage(page => page.evaluate(async () => {
    const req = async (url, method = 'GET', body) => (await fetch(url, { method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })).json();
    const debe = await req('/api/clientes', 'POST', { nombre: 'Fixture Deudor' });
    const alDia = await req('/api/clientes', 'POST', { nombre: 'Fixture AlDia' });
    await req(`/api/clientes/${debe.id}/fiar`, 'POST', { monto: 25, motivo: 'fixture' });
    window.OCAuth = Object.assign(window.OCAuth || {}, { rolActual: () => 'dueno' });
    await cargarClientes();
    const cont = document.getElementById('listaClientes');
    const btn = cont.querySelector('[data-filtro="pendiente"]');
    const nombres = () => cont.textContent;
    const antes = { d: nombres().includes('Fixture Deudor'), a: nombres().includes('Fixture AlDia') };
    btn.click(); await new Promise(res => setTimeout(res, 400));
    const con = { d: nombres().includes('Fixture Deudor'), a: nombres().includes('Fixture AlDia'), pressed: btn.getAttribute('aria-pressed'), alto: btn.getBoundingClientRect().height, minAlto: getComputedStyle(btn).minHeight, vistaVisible: !!cont.offsetParent };
    btn.click(); await new Promise(res => setTimeout(res, 300));
    const despues = { a: nombres().includes('Fixture AlDia') };
    return { hay: !!btn, antes, con, despues };
  }));
  assert.equal(r.hay, true, 'el dueño ve el botón');
  assert.deepEqual(r.antes, { d: true, a: true });
  assert.equal(r.con.d, true, 'el que debe aparece');
  assert.equal(r.con.a, false, 'el que está al día desaparece');
  assert.equal(r.con.pressed, 'true');
  // La vista de Clientes está oculta en esta página de prueba (offsetParent
  // null) y un elemento oculto mide 0: se verifica el mínimo declarado aquí y
  // el alto real se mide en el sitio vivo.
  assert.equal(r.con.vistaVisible, false, 'confirmado: la vista está oculta en el fixture');
  assert.equal(r.con.minAlto, '44px', 'botón de dedo (min-height 44px)');
  assert.equal(r.despues.a, true, 'segundo toque: vuelven todos');
});
