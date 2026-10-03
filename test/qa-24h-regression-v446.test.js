/* 24h regression gauntlet (JFC approved 2026-10-03).
   Exactly 10 top-level tests. Synthetic fixtures only: no real licenses,
   customers, rooms, inventory, or network business data. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { browser: fixtureBrowser } = require('./helpers/browser.cjs');

async function withAppPage(fn, viewport) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(viewport ? { viewport } : undefined);
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href,
      { waitUntil: 'networkidle' });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

function monthPair() {
  const d = new Date();
  const cur = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const p = new Date(d.getFullYear(), d.getMonth() - 1, 15);
  const prev = `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}`;
  return { cur, prev };
}

function overlap(a, b) {
  return Math.max(a.left, b.left) < Math.min(a.right, b.right) - 0.5 &&
    Math.max(a.top, b.top) < Math.min(a.bottom, b.bottom) - 0.5;
}

async function shelfViewHarness({ shelves, photosById = {}, putStatus = 200, putReject = false }) {
  return withAppPage(async (page) => {
    await page.setContent(`
      <!doctype html><html><body>
        <section id="vista-perchas" class="activa">
          <div id="vp-orden"></div>
          <div id="vp-grid"></div>
          <div id="vp-transfers"></div>
        </section>
      </body></html>
    `);
    await page.evaluate(({ shelves, photosById, putStatus, putReject }) => {
      window.__puts = [];
      window.__hashed = [];
      window.t = (k) => ({
        'shelves.noRacksYet': 'No shelves yet',
        'shelves.noTarget': 'No target',
        'shelves.ofTargetMet': '% target',
        'shelves.monthlySales': 'Monthly sales',
        'shelves.target': 'Target',
        'shelves.commission': 'Commission',
        'shelves.promoter': 'Promoter',
        'shelves.open': 'Open',
        'shelves.transfersHeading': 'Transfers',
        'shelves.addRackBtn': 'Add shelf',
        'common.close': 'Close',
        'shelves.newRackTitle': 'New shelf',
        'shelves.rackNameLabel': 'Name',
        'shelves.rackNamePlaceholder': 'Shelf name',
        'shelves.assignHint': 'Assign',
        'shelves.createRackBtn': 'Create'
      }[k] || k);
      window.OCI18n = { locale: () => 'en-US' };
      window.OCMoneda = { codigo: () => 'USD' };
      window.OCAuth = { puedeGestionar: () => false };
      window.OCFotos = {
        migrarSiHaceFalta: async () => {},
        leerTodas: async () => Object.assign({}, photosById),
        guardarFotoContenido: async (data) => {
          window.__hashed.push(data);
          return data.includes('active') ? 'hash-active-recovered' : 'hash-recovered';
        },
        leerPorHash: async () => null,
        guardarPorHash: async () => true
      };
      window.fetch = async (input, options = {}) => {
        const url = String(input);
        const method = options.method || 'GET';
        if (method === 'PUT') {
          window.__puts.push({ url, body: JSON.parse(options.body || '{}') });
          if (putReject) throw new Error('fixture: pointer repair write failed');
          return new Response(JSON.stringify({ ok: putStatus < 400 }),
            { status: putStatus, headers: { 'Content-Type': 'application/json' } });
        }
        let body = [];
        if (url === '/api/ubicaciones') body = shelves;
        else if (url === '/api/liquidaciones') body = [];
        else if (url === '/api/promotoras') body = [];
        else if (url === '/api/transferencias') body = [];
        else if (url === '/api/ventas/todas') body = [];
        return new Response(JSON.stringify(body),
          { status: 200, headers: { 'Content-Type': 'application/json' } });
      };
    }, { shelves, photosById, putStatus, putReject });
    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/vista-perchas.js') });
    await page.evaluate(() => window.VPerchas.cargar());
    return page.evaluate(() => ({
      text: document.getElementById('vp-grid').textContent,
      html: document.getElementById('vp-grid').innerHTML,
      puts: window.__puts.slice(),
      hashed: window.__hashed.slice(),
      imgs: [...document.querySelectorAll('#vp-grid img')].map((x) => x.getAttribute('src'))
    }));
  });
}

async function shelfWithPhoto() {
  const w = fixtureBrowser();
  const u = await w.request('/api/ubicaciones', 'POST', { nombre: 'Photo shelf', tipo: 'propio' });
  await w.request('/api/ubicaciones/' + u.id, 'PUT', { fotoHash: 'hash-local' });
  const state = await w.request('/api/respaldo/exportar');
  return { w, id: u.id, shelf: state.ubicaciones.find((x) => x.id === u.id) };
}

function revAfter(rev, device) {
  return { c: Math.max(1, Number(rev && rev.c) || 0) + 100, d: device };
}

async function legacyStockFixture(id, stock) {
  const w = fixtureBrowser();
  const fx = await w.request('/api/respaldo/exportar');
  const p = fx.productos.find((x) => Number(x.stockActual) >= 10);
  p.id = id;
  p.stockActual = stock;
  p.stockTs = 1000;
  delete p.stockBase;
  delete p.stockPN;
  delete p.stockDeficit;
  fx.productos = [p];
  fx.ventas = [];
  fx.movimientos = [];
  await w.request('/api/respaldo/importar', 'POST', fx);
  return { w, p };
}

test('1/10 Record a payment survives integrity pending even when reason is absent', async () => {
  const r = await withAppPage(page => page.evaluate(async () => {
    const req = async (url, method = 'GET', body) => {
      const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined });
      return res.json();
    };
    const c = await req('/api/clientes', 'POST', { nombre: 'QA Debt Fixture' });
    await req(`/api/clientes/${c.id}/fiar`, 'POST', { monto: 10, motivo: 'fixture' });
    const before = await req(`/api/clientes/${c.id}/cartera`);
    const originalFetch = window.fetch;
    window.__paymentOpen = null;
    window.abonarCliente = (id, nombre) => { window.__paymentOpen = { id, nombre }; };
    window.fetch = async function (url, options) {
      const res = await originalFetch.apply(this, arguments);
      if (String(url) === `/api/clientes/${c.id}/cartera` &&
          (!options || !options.method || options.method === 'GET')) {
        const data = await res.clone().json();
        data.integridad = { ok: false };
        return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return res;
    };
    const card = document.createElement('div');
    card.className = 'cliente-card';
    card.dataset.clienteId = c.id;
    card.innerHTML = '<strong>QA Debt Fixture</strong><div id="cartera-' + c.id + '"></div>';
    document.body.appendChild(card);
    await pintarSaldoCartera(c.id);
    const host = document.getElementById('cartera-' + c.id);
    const button = host.querySelector('button[onclick*="ocPagarDeuda"]');
    if (button) button.click();
    window.fetch = originalFetch;
    const after = await req(`/api/clientes/${c.id}/cartera`);
    return { text: host.textContent, hasButton: !!button, paymentOpen: window.__paymentOpen,
      beforeSaldo: before.saldo, afterSaldo: after.saldo, beforeN: (before.historial || []).length, afterN: (after.historial || []).length };
  }));
  assert.match(r.text, /Debt \$10\.00/);
  assert.match(r.text, /sync incomplete/);
  assert.equal(r.hasButton, true);
  assert.ok(r.paymentOpen && r.paymentOpen.id);
  assert.equal(r.afterSaldo, r.beforeSaldo);
  assert.equal(r.afterN, r.beforeN);
});

test('2/10 zero balance plus integrity warning never invents debt or a payment action', async () => {
  const r = await withAppPage(page => page.evaluate(async () => {
    const c = await (await fetch('/api/clientes', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'QA Zero Fixture' }) })).json();
    const originalFetch = window.fetch;
    let writes = 0;
    window.fetch = async function (url, options = {}) {
      const method = options.method || 'GET';
      if (method !== 'GET') writes++;
      const res = await originalFetch.apply(this, arguments);
      if (String(url) === `/api/clientes/${c.id}/cartera` && method === 'GET') {
        const data = await res.clone().json();
        data.integridad = { ok: false };
        return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return res;
    };
    const host = document.createElement('div');
    host.id = 'cartera-' + c.id;
    document.body.appendChild(host);
    await pintarSaldoCartera(c.id);
    const out = { text: host.textContent, button: !!host.querySelector('button[onclick*="ocPagarDeuda"]'), writes };
    window.fetch = originalFetch;
    return out;
  }));
  assert.match(r.text, /Balance pending verification/);
  assert.match(r.text, /sync incomplete/);
  assert.doesNotMatch(r.text, /Debt \$0/);
  assert.equal(r.button, false);
  assert.equal(r.writes, 0);
});

test('3/10 Commissions auto-jumps to previous month once, then respects manual current-month choice', async () => {
  const { cur, prev } = monthPair();
  const r = await withAppPage(page => page.evaluate(async ({ cur, prev }) => {
    const originalFetch = window.fetch;
    const calls = [];
    window.fetch = async function (input, options = {}) {
      const url = String(input);
      calls.push(url);
      let body = [];
      if (url.includes('/api/ventas/todas?ubicacionId=todas')) {
        body = [{ id: 'v-prev', productoId: 'p-prev', productoNombre: 'Previous month item', sku: 'PREV',
          mes: prev, delMesActual: false, cantidad: 1, precioUnit: 10, ubicacionId: 'u-own',
          ubicacionNombre: 'Fixture own shelf', ubicacionTipo: 'propio', comisionPct: null, liquidada: false }];
      } else if (url.includes('/api/liquidaciones/meses')) {
        body = [{ mes: cur, actual: true, pendiente: 0 }, { mes: prev, actual: false, pendiente: 0 }];
      } else if (url.includes('/api/comisiones/cuadre')) {
        body = null;
      } else if (url.includes('/api/liquidaciones')) {
        body = [];
      } else if (url.includes('/api/promotores/desempeno')) {
        body = [];
      } else {
        return originalFetch.apply(this, arguments);
      }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try { _ocMesComisiones = null; } catch (_) {}
    window._ocMesAutoHecho = false;
    window._ocMesAuto = null;
    await cargarComisiones();
    const firstSelected = document.querySelector('[data-commissions-month]')?.value || '';
    const autoDone = !!window._ocMesAutoHecho;
    const firstPrevReads = calls.filter((u) => u.includes('/api/liquidaciones?mes=' + encodeURIComponent(prev))).length;
    calls.length = 0;
    cambiarMesComisiones(cur);
    for (let i = 0; i < 40; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (document.querySelector('[data-commissions-month]')?.value === cur) break;
    }
    const manualSelected = document.querySelector('[data-commissions-month]')?.value || '';
    const manualPrevReads = calls.filter((u) => u.includes('/api/liquidaciones?mes=' + encodeURIComponent(prev))).length;
    const manualCurReads = calls.filter((u) => u.includes('/api/liquidaciones?mes=' + encodeURIComponent(cur))).length;
    const text = document.getElementById('listaComisiones')?.textContent || '';
    window.fetch = originalFetch;
    return { firstSelected, autoDone, firstPrevReads, manualSelected, manualPrevReads, manualCurReads, text };
  }, { cur, prev }));
  assert.equal(r.autoDone, true);
  assert.equal(r.firstSelected, prev);
  assert.ok(r.firstPrevReads >= 1);
  assert.equal(r.manualSelected, cur);
  assert.equal(r.manualPrevReads, 0);
  assert.ok(r.manualCurReads >= 1);
});

test('4/10 narrow iPhone-class Today hero keeps 12px clock readable and non-overlapping', async () => {
  const r = await withAppPage(page => page.evaluate(() => {
    const hero = document.getElementById('heroSemaforo');
    const title = document.getElementById('heroTitulo');
    const sub = document.getElementById('heroSubtitulo');
    const clock = document.getElementById('heroReloj');
    title.textContent = 'Everything is visible today';
    sub.textContent = 'Stock, sales and commissions remain readable at a glance.';
    clock.textContent = '10:42:31 AM';
    const box = (el) => { const x = el.getBoundingClientRect(); return { left:x.left,right:x.right,top:x.top,bottom:x.bottom,width:x.width,height:x.height }; };
    return { hero: box(hero), title: box(title), sub: box(sub), clock: box(clock),
      clockFont: parseFloat(getComputedStyle(clock).fontSize),
      heroScrollWidth: hero.scrollWidth, heroClientWidth: hero.clientWidth };
  }), { width: 390, height: 844 });
  assert.ok(r.clockFont >= 12);
  assert.ok(r.title.width > 0 && r.sub.width > 0 && r.clock.width > 0);
  assert.equal(overlap(r.clock, r.title), false);
  assert.equal(overlap(r.clock, r.sub), false);
  assert.ok(r.clock.left >= r.hero.left - 1 && r.clock.right <= r.hero.right + 1);
  assert.ok(r.clock.top >= r.hero.top - 1 && r.clock.bottom <= r.hero.bottom + 1);
  assert.ok(r.heroScrollWidth <= r.heroClientWidth + 1);
});

test('5/10 ~600px Today hero keeps the clock in its side column without collision', async () => {
  const r = await withAppPage(page => page.evaluate(() => {
    const hero = document.getElementById('heroSemaforo');
    const title = document.getElementById('heroTitulo');
    const sub = document.getElementById('heroSubtitulo');
    const clock = document.getElementById('heroReloj');
    title.textContent = 'Everything is visible today';
    sub.textContent = 'Stock, sales and commissions remain readable at a glance.';
    clock.textContent = '10:42:31 AM';
    const box = (el) => { const x = el.getBoundingClientRect(); return { left:x.left,right:x.right,top:x.top,bottom:x.bottom,width:x.width,height:x.height }; };
    return { hero: box(hero), title: box(title), sub: box(sub), clock: box(clock),
      display: getComputedStyle(hero).display, clockFont: parseFloat(getComputedStyle(clock).fontSize),
      heroScrollWidth: hero.scrollWidth, heroClientWidth: hero.clientWidth };
  }), { width: 600, height: 900 });
  assert.equal(r.display, 'grid');
  assert.ok(r.clockFont >= 12);
  assert.equal(overlap(r.clock, r.title), false);
  assert.equal(overlap(r.clock, r.sub), false);
  assert.ok(r.clock.left >= r.title.right - 2);
  assert.ok(r.clock.top <= r.sub.bottom + 1);
  assert.ok(r.clock.left >= r.hero.left - 1 && r.clock.right <= r.hero.right + 1);
  assert.ok(r.heroScrollWidth <= r.heroClientWidth + 1);
});

test('6/10 archived shelf with surviving local photo bytes stays invisible and triggers no repair write', async () => {
  const activePhoto = 'data:image/png;base64,YWN0aXZlLXBob3Rv';
  const archivedPhoto = 'data:image/png;base64,YXJjaGl2ZWQtcGhvdG8=';
  const r = await shelfViewHarness({
    shelves: [
      { id: 'u-active', nombre: 'Active shelf', tipo: 'propio', activa: true, fotoHash: null },
      { id: 'u-archived', nombre: 'Archived shelf', tipo: 'propio', activa: false, fotoHash: null }
    ],
    photosById: { 'u-active': activePhoto, 'u-archived': archivedPhoto }
  });
  assert.match(r.text, /Active shelf/);
  assert.doesNotMatch(r.text, /Archived shelf/);
  assert.equal(r.puts.length, 1);
  assert.equal(r.puts[0].url, '/api/ubicaciones/u-active');
  assert.deepEqual(r.hashed, [activePhoto]);
  assert.deepEqual(r.imgs, [activePhoto]);
});

test('7/10 failed shelf-photo pointer repair never blanks authentic local bytes', async () => {
  const photo = 'data:image/png;base64,bG9jYWwtYXV0aGVudGljLXBob3Rv';
  const r = await shelfViewHarness({
    shelves: [{ id: 'u-photo-fail', nombre: 'Photo survives', tipo: 'propio', activa: true, fotoHash: null }],
    photosById: { 'u-photo-fail': photo },
    putStatus: 500
  });
  assert.match(r.text, /Photo survives/);
  assert.deepEqual(r.imgs, [photo]);
  assert.equal(r.puts.length, 1);
  assert.deepEqual(r.puts[0], { url: '/api/ubicaciones/u-photo-fail', body: { fotoHash: 'hash-recovered' } });
  assert.deepEqual(r.hashed, [photo]);
  assert.doesNotMatch(r.text, /No se pudo cargar|Could not load/i);
});

test('8/10 modern fotoRev blocks a legacy peer from replacing the shelf photo with a different old hash', async () => {
  const { w, id, shelf } = await shelfWithPhoto();
  const remote = w.catalog();
  const ru = remote.ubicaciones.find((x) => x.id === id);
  ru.nombre = 'Renamed by legacy peer';
  ru.fotoHash = 'hash-legacy-other';
  delete ru.fotoRev;
  ru.rev = revAfter(shelf.rev, 'legacy-different-photo');
  w.OCSync.aplicarCatalogo(remote, null);
  const after = (await w.request('/api/respaldo/exportar')).ubicaciones.find((x) => x.id === id);
  assert.equal(after.nombre, 'Renamed by legacy peer');
  assert.equal(after.fotoHash, 'hash-local');
  assert.deepEqual(after.fotoRev, shelf.fotoRev);
});

test('9/10 explicit modern photo deletion cannot be resurrected by a legacy peer', async () => {
  const { w, id } = await shelfWithPhoto();
  const legacy = w.catalog();
  const old = legacy.ubicaciones.find((x) => x.id === id);
  old.fotoHash = 'hash-local';
  delete old.fotoRev;
  await w.request('/api/ubicaciones/' + id, 'PUT', { fotoHash: null });
  const deleted = (await w.request('/api/respaldo/exportar')).ubicaciones.find((x) => x.id === id);
  assert.equal(deleted.fotoHash, null);
  assert.ok(deleted.fotoRev);
  old.nombre = 'Legacy metadata still converges';
  old.rev = revAfter(deleted.rev, 'legacy-resurrect');
  w.OCSync.aplicarCatalogo(legacy, null);
  const after = (await w.request('/api/respaldo/exportar')).ubicaciones.find((x) => x.id === id);
  assert.equal(after.nombre, 'Legacy metadata still converges');
  assert.equal(after.fotoHash, null);
  assert.deepEqual(after.fotoRev, deleted.fotoRev);
});

test('10/10 v445 legacy-stock guard rejects destructive zero but still accepts legitimate newer positive stock', async () => {
  const a = await legacyStockFixture('p-gauntlet-zero', 9);
  const beforeA = (await a.w.request('/api/respaldo/exportar')).productos.find((x) => x.id === a.p.id);
  const eventsA = [];
  a.w.addEventListener('oc-stock-cero-legado-ignorado', (e) => eventsA.push(e.detail && e.detail.productoId));
  const remoteA = a.w.catalog();
  const rpA = remoteA.productos.find((x) => x.id === a.p.id);
  rpA.stockActual = 0;
  rpA.stockTs = beforeA.stockTs + 9999;
  delete rpA.stockBase; delete rpA.stockPN;
  a.w.OCSync.aplicarCatalogo(remoteA, null);
  const afterA = (await a.w.request('/api/respaldo/exportar')).productos.find((x) => x.id === a.p.id);
  assert.equal(afterA.stockActual, 9);
  assert.equal(afterA.stockTs, beforeA.stockTs);
  assert.deepEqual(eventsA, [a.p.id]);

  const b = await legacyStockFixture('p-gauntlet-positive', 5);
  const beforeB = (await b.w.request('/api/respaldo/exportar')).productos.find((x) => x.id === b.p.id);
  const eventsB = [];
  b.w.addEventListener('oc-stock-cero-legado-ignorado', (e) => eventsB.push(e.detail && e.detail.productoId));
  const remoteB = b.w.catalog();
  const rpB = remoteB.productos.find((x) => x.id === b.p.id);
  rpB.stockActual = 7;
  rpB.stockTs = beforeB.stockTs + 7777;
  delete rpB.stockBase; delete rpB.stockPN;
  b.w.OCSync.aplicarCatalogo(remoteB, null);
  const afterB = (await b.w.request('/api/respaldo/exportar')).productos.find((x) => x.id === b.p.id);
  assert.equal(afterB.stockActual, 7);
  assert.equal(afterB.stockTs, rpB.stockTs);
  assert.deepEqual(eventsB, []);
});
