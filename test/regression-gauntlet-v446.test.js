/* 2026-10-03 — approved 24h regression gauntlet.
   Synthetic fixtures only. Never points at a real license, room, customer, or Worker. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { browser: fixtureBrowser } = require('./helpers/browser.cjs');

async function withPage(viewport, fn) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href,
      { waitUntil: 'networkidle' });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

function overlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function previousMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function revAfter(rev, device) {
  return { c: Math.max(1, Number(rev && rev.c) || 0) + 100, d: device };
}

async function runShelfPage({ perchas, idPhotos = {}, putStatus = 200, yjsPhotos = {} }) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <!doctype html><html><body>
        <section id="vista-perchas" class="activa">
          <div id="vp-orden"></div>
          <div id="vp-grid"></div>
          <div id="vp-transfers"></div>
        </section>
      </body></html>
    `);

    await page.evaluate(({ perchas, idPhotos, putStatus, yjsPhotos }) => {
      window.__puts = [];
      window.__hashCalls = [];
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
        'shelves.addRackBtn': 'Add shelf'
      }[k] || k);
      window.OCI18n = { locale: () => 'en-US' };
      window.OCMoneda = { codigo: () => 'USD' };
      window.OCAuth = { puedeGestionar: () => false };
      window.OCFotos = {
        migrarSiHaceFalta: async () => {},
        leerTodas: async () => ({ ...idPhotos }),
        guardarFotoContenido: async (data) => {
          window.__hashCalls.push(data);
          return 'rehash-' + window.__hashCalls.length;
        },
        leerPorHash: async () => null,
        guardarPorHash: async () => true
      };
      window.OCYjs = { fotosMap: new Map(Object.entries(yjsPhotos)) };
      window.fetch = async (input, options = {}) => {
        const url = String(input);
        const method = options.method || 'GET';
        if (method === 'PUT') {
          window.__puts.push({ url, body: JSON.parse(options.body || '{}') });
          return new Response(JSON.stringify({ ok: putStatus < 400 }), {
            status: putStatus,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        let body = [];
        if (url === '/api/ubicaciones') body = perchas;
        else if (url === '/api/liquidaciones') body = [];
        else if (url === '/api/promotoras') body = [];
        else if (url === '/api/transferencias') body = [];
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      };
    }, { perchas, idPhotos, putStatus, yjsPhotos });

    await page.addScriptTag({ path: path.resolve(__dirname, '../docs/vista-perchas.js') });
    await page.evaluate(() => window.VPerchas.cargar());

    return await page.evaluate(() => ({
      text: document.getElementById('vp-grid').textContent,
      html: document.getElementById('vp-grid').innerHTML,
      puts: window.__puts.slice(),
      hashCalls: window.__hashCalls.slice(),
      imgs: Array.from(document.querySelectorAll('#vp-grid img')).map((img) => img.getAttribute('src'))
    }));
  } finally {
    await browser.close();
  }
}

async function legacyStockFixture(w, id, stock) {
  const fx = await w.request('/api/respaldo/exportar');
  const source = fx.productos.find((x) => Number(x.stockActual) >= 10);
  assert.ok(source, 'fixture seed must contain a product with stock');
  const p = { ...source, id, stockActual: stock, stockTs: 1000 };
  delete p.stockBase;
  delete p.stockPN;
  delete p.stockDeficit;
  fx.productos = [p];
  fx.ventas = [];
  fx.movimientos = [];
  await w.request('/api/respaldo/importar', 'POST', fx);
  return p;
}

test('24h #1 Record a payment survives integrity warning without a reason string', async () => {
  const r = await withPage({ width: 1000, height: 800 }, (page) => page.evaluate(async () => {
    const req = async (url, method = 'GET', body) => {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));
      return data;
    };
    const c = await req('/api/clientes', 'POST', { nombre: '24h debt fixture' });
    await req(`/api/clientes/${c.id}/fiar`, 'POST', { monto: 10, motivo: 'fixture' });
    const before = await req(`/api/clientes/${c.id}/cartera`);
    const originalFetch = window.fetch;
    window.fetch = async function (url, options) {
      const res = await originalFetch.apply(this, arguments);
      if (String(url) === `/api/clientes/${c.id}/cartera` &&
          (!options || !options.method || options.method === 'GET')) {
        const data = await res.clone().json();
        data.integridad = { ok: false };
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return res;
    };
    const host = document.createElement('div');
    host.id = 'cartera-' + c.id;
    document.body.appendChild(host);
    await pintarSaldoCartera(c.id);
    const button = host.querySelector('button[onclick*="ocPagarDeuda"]');
    window.fetch = originalFetch;
    const after = await req(`/api/clientes/${c.id}/cartera`);
    return {
      text: host.textContent,
      button: !!button,
      disabled: button ? button.disabled : null,
      beforeSaldo: before.saldo,
      afterSaldo: after.saldo,
      beforeHist: JSON.stringify(before.historial || []),
      afterHist: JSON.stringify(after.historial || [])
    };
  }));

  assert.equal(r.button, true);
  assert.equal(r.disabled, false);
  assert.match(r.text, /Debt \$10\.00/);
  assert.match(r.text, /Balance pending verification/);
  assert.match(r.text, /sync incomplete/);
  assert.equal(r.afterSaldo, r.beforeSaldo);
  assert.equal(r.afterHist, r.beforeHist);
});

test('24h #2 zero balance plus integrity warning does not invent debt or payment action', async () => {
  const r = await withPage({ width: 1000, height: 800 }, (page) => page.evaluate(async () => {
    const req = async (url, method = 'GET', body) => {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      return res.json();
    };
    const c = await req('/api/clientes', 'POST', { nombre: '24h zero fixture' });
    const originalFetch = window.fetch;
    let writes = 0;
    window.fetch = async function (url, options) {
      const method = (options && options.method) || 'GET';
      if (method !== 'GET') writes++;
      const res = await originalFetch.apply(this, arguments);
      if (String(url) === `/api/clientes/${c.id}/cartera` && method === 'GET') {
        const data = await res.clone().json();
        data.integridad = { ok: false };
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return res;
    };
    const host = document.createElement('div');
    host.id = 'cartera-' + c.id;
    document.body.appendChild(host);
    await pintarSaldoCartera(c.id);
    const out = {
      text: host.textContent,
      button: !!host.querySelector('button[onclick*="ocPagarDeuda"]'),
      writes
    };
    window.fetch = originalFetch;
    return out;
  }));

  assert.match(r.text, /Balance pending verification/);
  assert.match(r.text, /sync incomplete/);
  assert.doesNotMatch(r.text, /Debt \$/);
  assert.equal(r.button, false);
  assert.equal(r.writes, 0);
});

test('24h #3 Commissions auto-jumps to previous month once and respects manual return to current month', async () => {
  const r = await withPage({ width: 1000, height: 900 }, (page) => page.evaluate(async () => {
    const now = new Date();
    const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const previous = now.getMonth() === 0
      ? `${now.getFullYear() - 1}-12`
      : `${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`;
    const sale = {
      id: 'v-24h-prev', productoId: 'p-24h-prev', productoNombre: 'Previous month fixture',
      sku: 'FIX-PREV', mes: previous, delMesActual: false, cantidad: 1, precioUnit: 10,
      ubicacionNombre: 'Fixture rack', ubicacionTipo: 'propio', comisionPct: null,
      liquidada: false, devuelta: false
    };
    const originalFetch = window.fetch;
    const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json' }
    }));
    window.fetch = function (url, options) {
      const s = String(url);
      if (s.startsWith('/api/liquidaciones?mes=')) return json([]);
      if (s === '/api/promotores/desempeno') return json([]);
      if (s === '/api/ventas/todas?ubicacionId=todas') return json([sale]);
      if (s === '/api/liquidaciones/meses') return json([
        { mes: previous, actual: false, pendiente: 0 },
        { mes: current, actual: true, pendiente: 0 }
      ]);
      if (s.startsWith('/api/comisiones/cuadre?mes=')) return json(null);
      return originalFetch.apply(this, arguments);
    };

    window._ocMesAutoHecho = false;
    delete window._ocMesAuto;
    const waitFor = async (predicate) => {
      for (let i = 0; i < 80; i++) {
        if (predicate()) return true;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return false;
    };

    cambiarMesComisiones('');
    const jumped = await waitFor(() => {
      const sel = document.querySelector('[data-commissions-month]');
      return window._ocMesAutoHecho === true && sel && sel.value === previous;
    });
    const first = {
      jumped,
      selected: document.querySelector('[data-commissions-month]')?.value || '',
      auto: window._ocMesAuto || '',
      guard: window._ocMesAutoHecho
    };

    cambiarMesComisiones(current);
    const returned = await waitFor(() => document.querySelector('[data-commissions-month]')?.value === current);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const second = {
      returned,
      selected: document.querySelector('[data-commissions-month]')?.value || '',
      guard: window._ocMesAutoHecho
    };
    window.fetch = originalFetch;
    return { current, previous, first, second };
  }));

  assert.equal(r.first.jumped, true);
  assert.equal(r.first.selected, r.previous);
  assert.equal(r.first.auto, r.previous);
  assert.equal(r.first.guard, true);
  assert.equal(r.second.returned, true);
  assert.equal(r.second.selected, r.current);
  assert.equal(r.second.guard, true);
});

test('24h #4 narrow iPhone-class Today hero keeps the repaired clock readable and below text', async () => {
  const r = await withPage({ width: 390, height: 844 }, async (page) => {
    await page.waitForFunction(() => {
      const e = document.getElementById('heroReloj');
      return e && e.textContent.trim().length > 0;
    }, null, { timeout: 3000 });
    return page.evaluate(() => {
      const rect = (id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      };
      const hero = document.getElementById('heroSemaforo');
      const clock = document.getElementById('heroReloj');
      return {
        hero: rect('heroSemaforo'),
        title: rect('heroTitulo'),
        subtitle: rect('heroSubtitulo'),
        clock: rect('heroReloj'),
        clockFont: parseFloat(getComputedStyle(clock).fontSize),
        display: getComputedStyle(hero).display,
        overflow: hero.scrollWidth - hero.clientWidth
      };
    });
  });

  assert.equal(r.display, 'grid');
  assert.ok(r.clockFont >= 12, 'clock must stay at the repaired 12px readability floor');
  assert.ok(r.title.width > 0 && r.title.height > 0);
  assert.ok(r.subtitle.width > 0 && r.subtitle.height > 0);
  assert.ok(r.clock.width > 0 && r.clock.height > 0);
  assert.equal(overlap(r.clock, r.title), false);
  assert.equal(overlap(r.clock, r.subtitle), false);
  assert.ok(r.clock.top >= r.subtitle.bottom - 1, 'under 480px the clock belongs on row 3');
  assert.ok(r.clock.left >= r.hero.left - 1 && r.clock.right <= r.hero.right + 1);
  assert.ok(r.overflow <= 1, 'hero must not gain horizontal overflow');
});

test('24h #5 ~600px Today hero keeps the repaired clock in the side column without collision', async () => {
  const r = await withPage({ width: 600, height: 900 }, async (page) => {
    await page.waitForFunction(() => {
      const e = document.getElementById('heroReloj');
      return e && e.textContent.trim().length > 0;
    }, null, { timeout: 3000 });
    return page.evaluate(() => {
      const rect = (id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      };
      const hero = document.getElementById('heroSemaforo');
      const clock = document.getElementById('heroReloj');
      return {
        hero: rect('heroSemaforo'),
        title: rect('heroTitulo'),
        subtitle: rect('heroSubtitulo'),
        clock: rect('heroReloj'),
        clockFont: parseFloat(getComputedStyle(clock).fontSize),
        display: getComputedStyle(hero).display,
        overflow: hero.scrollWidth - hero.clientWidth
      };
    });
  });

  assert.equal(r.display, 'grid');
  assert.ok(r.clockFont >= 12);
  assert.equal(overlap(r.clock, r.title), false);
  assert.equal(overlap(r.clock, r.subtitle), false);
  assert.ok(r.clock.left >= Math.max(r.title.right, r.subtitle.right) - 1,
    'above 479px the clock must stay in the second grid column');
  assert.ok(r.clock.left >= r.hero.left - 1 && r.clock.right <= r.hero.right + 1);
  assert.ok(r.overflow <= 1);
});

test('24h #6 archived shelf with surviving local photo bytes stays invisible and triggers no repair write', async () => {
  const activePhoto = 'data:image/png;base64,QUNUSVZFLTI0SA==';
  const archivedPhoto = 'data:image/png;base64,QVJDSElWRUQtMjRI';
  const r = await runShelfPage({
    perchas: [
      { id: 'u-active-24h', nombre: 'Active 24h shelf', tipo: 'propio', activa: true, fotoHash: null },
      { id: 'u-archived-24h', nombre: 'Archived 24h shelf', tipo: 'propio', activa: false, fotoHash: null }
    ],
    idPhotos: {
      'u-active-24h': activePhoto,
      'u-archived-24h': archivedPhoto
    }
  });

  assert.match(r.text, /Active 24h shelf/);
  assert.doesNotMatch(r.text, /Archived 24h shelf/);
  assert.ok(r.imgs.includes(activePhoto));
  assert.equal(r.imgs.includes(archivedPhoto), false);
  assert.equal(r.puts.some((x) => x.url.includes('u-archived-24h')), false);
  assert.equal(r.hashCalls.includes(archivedPhoto), false);
  assert.equal(r.puts.some((x) => x.url.includes('u-active-24h')), true);
});

test('24h #7 failed shelf-photo self-heal write does not blank authentic local bytes', async () => {
  const photo = 'data:image/png;base64,TE9DQUwtMjRILVBIT1RP';
  const r = await runShelfPage({
    perchas: [
      { id: 'u-fail-24h', nombre: 'Write failure shelf', tipo: 'propio', activa: true, fotoHash: null }
    ],
    idPhotos: { 'u-fail-24h': photo },
    putStatus: 500
  });

  assert.match(r.text, /Write failure shelf/);
  assert.ok(r.imgs.includes(photo), 'the exact already-local photo must remain visible');
  assert.deepEqual(r.hashCalls, [photo]);
  assert.equal(r.puts.length, 1);
  assert.equal(r.puts[0].url, '/api/ubicaciones/u-fail-24h');
  assert.match(r.puts[0].body.fotoHash, /^rehash-1$/);
});

test('24h #8 modern fotoRev rejects a different legacy hash even when legacy general rev is newer', async () => {
  const w = fixtureBrowser();
  const u = await w.request('/api/ubicaciones', 'POST', { nombre: 'Modern photo shelf', tipo: 'propio' });
  await w.request('/api/ubicaciones/' + u.id, 'PUT', { fotoHash: 'hash-modern' });
  const before = (await w.request('/api/respaldo/exportar')).ubicaciones.find((x) => x.id === u.id);
  assert.ok(before.fotoRev);

  const remote = w.catalog();
  const ru = remote.ubicaciones.find((x) => x.id === u.id);
  ru.nombre = 'Legacy metadata rename';
  ru.fotoHash = 'hash-legacy-other';
  delete ru.fotoRev;
  ru.rev = revAfter(before.rev, 'legacy-other-hash');
  w.OCSync.aplicarCatalogo(remote, null);

  const after = (await w.request('/api/respaldo/exportar')).ubicaciones.find((x) => x.id === u.id);
  assert.equal(after.nombre, 'Legacy metadata rename');
  assert.equal(after.fotoHash, 'hash-modern');
  assert.deepEqual(after.fotoRev, before.fotoRev);
});

test('24h #9 explicit modern photo deletion cannot be resurrected by a legacy peer', async () => {
  const w = fixtureBrowser();
  const u = await w.request('/api/ubicaciones', 'POST', { nombre: 'Deleted modern photo shelf', tipo: 'propio' });
  await w.request('/api/ubicaciones/' + u.id, 'PUT', { fotoHash: 'hash-before-delete' });
  await w.request('/api/ubicaciones/' + u.id, 'PUT', { fotoHash: null });
  const deleted = (await w.request('/api/respaldo/exportar')).ubicaciones.find((x) => x.id === u.id);
  assert.equal(deleted.fotoHash, null);
  assert.ok(deleted.fotoRev);

  const remote = w.catalog();
  const ru = remote.ubicaciones.find((x) => x.id === u.id);
  ru.nombre = 'Legacy rename after delete';
  ru.fotoHash = 'hash-before-delete';
  delete ru.fotoRev;
  ru.rev = revAfter(deleted.rev, 'legacy-resurrection');
  w.OCSync.aplicarCatalogo(remote, null);

  const after = (await w.request('/api/respaldo/exportar')).ubicaciones.find((x) => x.id === u.id);
  assert.equal(after.nombre, 'Legacy rename after delete');
  assert.equal(after.fotoHash, null);
  assert.deepEqual(after.fotoRev, deleted.fotoRev);
});

test('24h #10 v445 blocks suspicious legacy zero but still accepts a legitimate newer positive legacy stock', async () => {
  const wZero = fixtureBrowser();
  const pZero = await legacyStockFixture(wZero, 'p-24h-zero', 9);
  const zeroEvents = [];
  wZero.addEventListener('oc-stock-cero-legado-ignorado', (e) => zeroEvents.push(e.detail));
  const zeroBefore = (await wZero.request('/api/respaldo/exportar')).productos.find((x) => x.id === pZero.id);
  const remoteZero = wZero.catalog();
  const rz = remoteZero.productos.find((x) => x.id === pZero.id);
  rz.stockActual = 0;
  rz.stockTs = zeroBefore.stockTs + 999999;
  rz.stockBase = null;
  rz.stockPN = null;
  wZero.OCSync.aplicarCatalogo(remoteZero, null);
  const zeroAfter = (await wZero.request('/api/respaldo/exportar')).productos.find((x) => x.id === pZero.id);

  assert.equal(zeroAfter.stockActual, 9);
  assert.equal(zeroAfter.stockTs, zeroBefore.stockTs, 'ignored suspicious zero must not poison local stockTs');
  assert.equal(zeroEvents.length, 1);
  assert.equal(zeroEvents[0].productoId, pZero.id);

  const wPositive = fixtureBrowser();
  const pPositive = await legacyStockFixture(wPositive, 'p-24h-positive', 5);
  const positiveEvents = [];
  wPositive.addEventListener('oc-stock-cero-legado-ignorado', (e) => positiveEvents.push(e.detail));
  const positiveBefore = (await wPositive.request('/api/respaldo/exportar')).productos.find((x) => x.id === pPositive.id);
  const remotePositive = wPositive.catalog();
  const rp = remotePositive.productos.find((x) => x.id === pPositive.id);
  rp.stockActual = 7;
  rp.stockTs = positiveBefore.stockTs + 5000;
  rp.stockBase = null;
  rp.stockPN = null;
  wPositive.OCSync.aplicarCatalogo(remotePositive, null);
  const positiveAfter = (await wPositive.request('/api/respaldo/exportar')).productos.find((x) => x.id === pPositive.id);

  assert.equal(positiveAfter.stockActual, 7);
  assert.equal(positiveAfter.stockTs, rp.stockTs);
  assert.equal(positiveEvents.length, 0);
});
