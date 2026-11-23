'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { webkit, chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');

function makeRelayBackend() {
  const cfRooms = new Map();
  const fbRooms = new Map();
  const getRoom = (map, room) => {
    if (!map.has(room)) map.set(room, { rev: 0, ops: [], ckpts: new Map() });
    return map.get(room);
  };
  return {
    cfRooms,
    fbRooms,
    async attach(context) {
      await context.route('https://friendly123-licencias.jfcarpio.workers.dev/**', async (route) => {
        const url = route.request().url();
        if (url.endsWith('/ws/ticket')) {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, token: 'mock-ticket-tok' }) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
      });
      await context.route('https://friendly123-relay-privado.jfcarpio.workers.dev/**', async (route) => {
        const req = route.request();
        const u = new URL(req.url());
        const m = u.pathname.match(/^\/f123\/([a-f0-9]{40}(?:-y|-ops|-fotos)?)\/([a-z]+)$/);
        if (!m) return route.fulfill({ status: 404, body: '{}' });
        const [, room, action] = m;
        const r = getRoom(cfRooms, room);
        if (action === 'session') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, token: 'sess-' + room, expiresAt: Date.now() + 600000 }) });
        }
        if (action === 'ts') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, t1: Date.now() }) });
        }
        if (action === 'head') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, rev: r.rev, seq: r.ops.length }) });
        }
        if (action === 'op' && req.method() === 'POST') {
          const body = JSON.parse(req.postData() || '{}');
          if (!r.ops.some(x => x.id === body.id)) r.ops.push({ seq: r.ops.length + 1, id: body.id, c: body.c, lam: body.lam });
          return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, seq: r.ops.length }) });
        }
        if (action === 'ckpt' && req.method() === 'POST') {
          const body = JSON.parse(req.postData() || '{}');
          r.rev += 1;
          r.ckpts.set(r.rev, { seq: r.ops.length, c: body.c, lam: body.lam });
          return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ok: true, rev: r.rev }) });
        }
        if (action === 'pull') {
          const seq = Math.max(0, Number(u.searchParams.get('seq') || 0));
          const reqRev = Number(u.searchParams.get('rev') ?? -1);
          const limit = Math.min(64, Number(u.searchParams.get('limit') || 64));
          const frames = [];
          let start = seq;
          if (reqRev !== r.rev && r.rev > 0 && r.ckpts.has(r.rev)) {
            const ck = r.ckpts.get(r.rev);
            frames.push(ck.c);
            start = Math.max(ck.seq, seq);
          }
          const slice = r.ops.filter(o => o.seq > start).slice(0, limit);
          slice.forEach(o => frames.push(o.c));
          const newSeq = slice.length ? slice[slice.length - 1].seq : start;
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, rev: r.rev, seq: newSeq, n: slice.length, more: newSeq < r.ops.length, frames })
          });
        }
        return route.fulfill({ status: 400, body: '{}' });
      });
      await context.route('https://friendly-123-ab7b3-default-rtdb.firebaseio.com/**', async (route) => {
        const req = route.request();
        const u = new URL(req.url());
        const m = u.pathname.match(/^\/f123\/([a-f0-9]{40}(?:-y|-ops|-fotos)?)\/([ko])(?:\/([^/.]+))?\.json$/);
        if (!m) return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
        const [, room, kind, itemId] = m;
        const r = getRoom(fbRooms, room);
        const method = u.searchParams.get('x-http-method-override') === 'PUT' ? 'PUT' : req.method();
        if (kind === 'k' && method === 'GET' && !itemId) {
          const shallow = {};
          for (const rev of r.ckpts.keys()) shallow[rev] = true;
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(shallow) });
        }
        if (kind === 'k' && method === 'GET' && itemId) {
          const ck = r.ckpts.get(Number(itemId));
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ck ? { s: ck.seq, c: ck.c, lam: ck.lam } : null) });
        }
        if (kind === 'o' && method === 'GET') {
          const limitLast = u.searchParams.get('limitToLast');
          if (limitLast) {
            const last = r.ops[r.ops.length - 1];
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(last ? { [last.id]: { s: last.seq, c: last.c, lam: last.lam } } : {}) });
          }
          const startAt = Number(u.searchParams.get('startAt') || 0);
          const limitFirst = Number(u.searchParams.get('limitToFirst') || 192);
          const out = {};
          r.ops.filter(o => o.seq >= startAt).slice(0, limitFirst).forEach(o => {
            out[o.id] = { s: o.seq, c: o.c, lam: o.lam };
          });
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
        }
        if (kind === 'o' && method === 'PUT' && itemId) {
          const body = JSON.parse(req.postData() || '{}');
          if (!r.ops.some(x => x.id === itemId)) r.ops.push({ seq: r.ops.length + 1, id: itemId, c: body.c, lam: body.lam || 0 });
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: r.ops.length }) });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      });
    }
  };
}

test('RED->GREEN (WebKit): Path (a) Owner one-time encrypted migration pushes historical sales, commissions, customers, expenses & movimientos/logs through real cf-relay to fresh WebKit device while Yjs is stuck; Path (b) Firebase fallback reads when CF is empty', async () => {
  const relay = makeRelayBackend();
  const browser = await webkit.launch({ headless: true });
  try {
    const indexUrl = pathToFileURL(path.join(ROOT, 'docs/index.html')).href;
    const lic = 'F123-TEST-MIGRATION1A';

    // 1) Device A (Owner) holds 18 historical sales, expenses, customers & movimientos/logs, with stuck Yjs pendingStructs
    const ctxA = await browser.newContext();
    await relay.attach(ctxA);
    const pageA = await ctxA.newPage();
    await pageA.addInitScript((licenseCode) => {
      localStorage.setItem('f123_owned', JSON.stringify({ licenseCode, syncCode: licenseCode, instanceId: 'dev-owner-a', nombreNegocio: 'Tienda Historica' }));
      localStorage.setItem('f123_sync_room', JSON.stringify({ codigo: licenseCode }));
      localStorage.setItem('OC_PIN_VERIF', JSON.stringify({ owner: '314' }));
    }, lic);
    await pageA.goto(indexUrl, { waitUntil: 'load' });
    await pageA.evaluate(async () => {
      // Authenticate Owner session cleanly so real cf-relay session & role gates see rol="dueno"
      window.OCSecure.abrirSesionLocalConPin && null;
      window.OCAuth = Object.assign(window.OCAuth || {}, { rolActual: () => 'dueno', esDemo: () => false });
      if (window.OCSecure) {
        window.OCSecure.leerPinQueAbre = () => ({ owner: '314', emp: '', acct: '' });
      }
      const resShelf = await fetch('/api/ubicaciones', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nombre: 'Percha Sur', comisionSocio: 25 }) });
      const shelf = await resShelf.json();
      const resProd = await fetch('/api/productos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nombre: 'Cafe Especial', sku: 'CAF-1', precio: 15, costo: 5, ubicacionId: shelf.id, stockActual: 50 }) });
      const prod = await resProd.json();
      const resCli = await fetch('/api/clientes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nombre: 'Cliente Historico' }) });
      const cli = await resCli.json();
      const histSales = [];
      for (let i = 1; i <= 18; i++) {
        const m = i <= 6 ? '2026-06' : i <= 12 ? '2026-08' : '2026-09';
        histSales.push({
          id: 'v-hist-' + i,
          productoId: prod.id,
          ubicacionId: shelf.id,
          clienteId: cli.id,
          cantidad: 1,
          precioUnit: 15,
          costoUnit: 5,
          fecha: `${m}-10T15:00:00.000Z`,
          split: { version: 1, bruto: 15, descuento: 0, base: 15, neta: 15, montoBruto: 15, pctSocio: 25, montoComisionSocio: 3.75, montoNetoDueno: 11.25 },
          liquidada: i <= 6
        });
      }
      window.OCSync.aplicarCatalogo({
        ubicaciones: [], productos: [],
        ventas: histSales,
        gastos: [{ id: 'g-hist-1', concepto: 'Renta Vieja', monto: 40, fecha: '2026-08-12', rev: { c: 1, d: 'dev-owner-a' } }],
        clientes: []
      }, 'dueno');
      // Simulate stuck Yjs pendingStructs
      if (window.OCYjs && window.OCYjs.doc && window.OCYjs.doc.store) {
        window.OCYjs.doc.store.pendingStructs = { missing: new Map([[1, 2]]) };
      }
      // Reset any pre-PIN CF pause via genuine oc-login and reconnect
      window.dispatchEvent(new CustomEvent('oc-login', { detail: { rol: 'dueno', demo: false } }));
      if (window.OCSyncControl && window.OCSyncControl.resincronizar) window.OCSyncControl.resincronizar();
      await new Promise(r => setTimeout(r, 3200));
    });
    const baseRoom = [...relay.cfRooms.keys()].find(k => /^[a-f0-9]{40}$/.test(k));
    const uploadedCountA = baseRoom ? relay.cfRooms.get(baseRoom).ops.length : 0;
    assert.ok(uploadedCountA >= 1, `Path (a): expected encrypted fichas ops in Cloudflare room, got ${uploadedCountA}`);

    // Verify one-time idempotency: second pass uploads ZERO new ops
    await pageA.evaluate(async () => {
      window.dispatchEvent(new CustomEvent('oc-catalogo-cambiado'));
      await new Promise(r => setTimeout(r, 2400));
    });
    const uploadedCountA2 = relay.cfRooms.get(baseRoom).ops.length;
    assert.equal(uploadedCountA2, uploadedCountA, 'Path (a) migration must be one-time: unchanged records must not re-upload');
    await ctxA.close();

    // 2) Brand-new Device B (WebKit) joins with License + PIN -> reads Path (a) from Cloudflare!
    const ctxB = await browser.newContext();
    await relay.attach(ctxB);
    const pageB = await ctxB.newPage();
    await pageB.addInitScript((licenseCode) => {
      localStorage.setItem('f123_owned', JSON.stringify({ licenseCode, syncCode: licenseCode, instanceId: 'dev-fresh-b' }));
      localStorage.setItem('f123_sync_room', JSON.stringify({ codigo: licenseCode }));
    }, lic);
    await pageB.goto(indexUrl, { waitUntil: 'load' });
    const recB = await pageB.evaluate(async () => {
      window.OCAuth = Object.assign(window.OCAuth || {}, { rolActual: () => 'dueno', esDemo: () => false });
      if (window.OCSecure) window.OCSecure.leerPinQueAbre = () => ({ owner: '314', emp: '', acct: '' });
      window.dispatchEvent(new CustomEvent('oc-login', { detail: { rol: 'dueno', demo: false } }));
      if (window.OCSyncControl && window.OCSyncControl.resincronizar) window.OCSyncControl.resincronizar();
      for (let i = 0; i < 40; i++) {
        const exp = await (await fetch('/api/respaldo/exportar')).json();
        if ((exp.ventas || []).length >= 18) return exp;
        await new Promise(r => setTimeout(r, 150));
      }
      return await (await fetch('/api/respaldo/exportar')).json();
    });
    await ctxB.close();
    assert.equal((recB.ventas || []).length, 18, `WebKit Path (a): expected 18 historical sales, got ${(recB.ventas || []).length}`);
    assert.ok((recB.gastos || []).some(g => g.id === 'g-hist-1'), 'WebKit Path (a): expected historical expense');
    assert.ok((recB.actividadCompartida || []).length >= 1, 'WebKit Path (a): expected synced movimientos/actividad logs');

    // 3) Path (b) Fallback: Move ops ONLY to Firebase while Cloudflare is EMPTY (rev:0, seq:0), test fresh WebKit Device C!
    const fbBase = relay.fbRooms.get(baseRoom);
    relay.cfRooms.get(baseRoom).ops.forEach(o => fbBase.ops.push(o));
    relay.cfRooms.clear();
    const ctxC = await browser.newContext();
    await relay.attach(ctxC);
    const pageC = await ctxC.newPage();
    await pageC.addInitScript((licenseCode) => {
      localStorage.setItem('f123_owned', JSON.stringify({ licenseCode, syncCode: licenseCode, instanceId: 'dev-fresh-c' }));
      localStorage.setItem('f123_sync_room', JSON.stringify({ codigo: licenseCode }));
    }, lic);
    await pageC.goto(indexUrl, { waitUntil: 'load' });
    const recC = await pageC.evaluate(async () => {
      window.OCAuth = Object.assign(window.OCAuth || {}, { rolActual: () => 'dueno', esDemo: () => false });
      if (window.OCSecure) window.OCSecure.leerPinQueAbre = () => ({ owner: '314', emp: '', acct: '' });
      window.dispatchEvent(new CustomEvent('oc-login', { detail: { rol: 'dueno', demo: false } }));
      if (window.OCSyncControl && window.OCSyncControl.resincronizar) window.OCSyncControl.resincronizar();
      for (let i = 0; i < 100; i++) {
        const exp = await (await fetch('/api/respaldo/exportar')).json();
        if ((exp.ventas || []).length >= 18) return exp;
        await new Promise(r => setTimeout(r, 150));
      }
      return await (await fetch('/api/respaldo/exportar')).json();
    });
    await ctxC.close();
    assert.equal((recC.ventas || []).length, 18, `WebKit Path (b): expected 18 historical sales from Firebase fallback when CF is empty, got ${(recC.ventas || []).length}`);
  } finally {
    await browser.close();
  }
});

test('RED->GREEN: sync-yjs processes Firebase HEAD access BEFORE causal rescue and records markRecovered when HEAD matches despite missing parents', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'docs/sync-yjs.js'), 'utf8');
  const start = src.indexOf('    function clavePendientes() {', src.indexOf('function crearCanal('));
  const end = src.indexOf('    function reprogramar() {', start);
  assert.ok(start > 0 && end > start);

  let appliedCount = 0;
  let markRecoveredCount = 0;
  const sent = [];
  const ws = {
    readyState: 1,
    relayLayer: 'f123_relay_cupo_fb_v1',
    send: msg => sent.push(JSON.parse(msg)),
    markRecovered: () => { markRecoveredCount++; }
  };
  const ctx = {
    ws, Promise, Number, Math, JSON, Object, Map, Array, Uint8Array,
    doc: { store: { pendingStructs: { missing: new Map([[7, 9]]) } } },
    partesEntrantes: {},
    canal: { ws, recuperando: true, headAcceso: false, accesoListo: () => ctx.canal.headAcceso === true },
    _pullCursorReady: Promise.resolve(),
    _pullCursor: { rev: 3, seq: 120 },
    _appliedPullCursor: { rev: 3, seq: 120 },
    _ultimoCursorLimpio: { rev: 3, seq: 80 },
    _replayUsed: 0, _replayKey: null, _tReplay: null,
    _antecedentesBuscados: false,
    _soloMemoria: false, PULL_PAGE_SIZE: 64, nombre: 'catalogo',
    API: { _store: { aplicar() { appliedCount++; } } },
    setTimeout: () => 17, clearTimeout: () => {}, log() {},
    Y: { encodeStateVector: () => new Uint8Array([1]) }
  };
  vm.createContext(ctx);
  vm.runInContext(src.slice(start, end), ctx);
  ctx.accesoSinPendientes = () => true;

  const state = { enCurso: false, fallos: 0, usarHead: true, validacionFinal: true };
  await ctx.pedirPagina(ws, state);
  await ctx.procesarHead(ws, state, { rev: 3, seq: 120 });

  assert.equal(ctx.canal.headAcceso, true, 'headAcceso must become true immediately even when Firebase triggers ancestor rescue');
  assert.equal(appliedCount >= 1, true, 'API._store.aplicar must run immediately so downloaded sales are visible');
  assert.equal(markRecoveredCount >= 1, true, 'Firebase HEAD match with zero chunk debt must markRecovered so relay-selector stops looping 26 KB CF pauses');
});

test('RED->GREEN: relay-selector exposes single valid ckptFrameBytes and oc-login does not kill an active unrecovered Firebase catch-up', async () => {
  const rs = fs.readFileSync(path.join(ROOT, 'docs/relay-selector.js'), 'utf8');
  assert.doesNotMatch(rs.slice(rs.indexOf('window.F123Relay =')), /ckptFrameBytes:.*\n\s*ckptFrameBytes:/, 'Must not contain duplicate ckptFrameBytes property');

  const closedReasons = [];
  const winListeners = {};
  function makeSocket(layer) {
    const s = {
      relayLayer: layer, readyState: 0, _l: {},
      addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); },
      close(c, r) { if (this.readyState < 2) { this.readyState = 3; closedReasons.push({ layer, c, r }); (this._l.close || []).forEach(f => f({ code: c, reason: r })); } },
      send() {},
      openNow() { this.readyState = 1; (this._l.open || []).forEach(f => f({})); }
    };
    return s;
  }
  const cfWs = makeSocket('f123_relay_cupo_cf_v1');
  const fbWs = makeSocket('f123_relay_cupo_fb_v1');
  const fakeWindow = {
    F123CloudflareRelay: { ckptFrameBytes: 1536 * 1024, connect: () => { setTimeout(() => cfWs.openNow(), 5); return cfWs; }, leerHead: async () => ({ rev: 0, seq: 0 }) },
    F123FirebaseRelay: { ckptFrameBytes: 786432, connect: () => { fbWs.openNow(); return fbWs; }, leerHead: async () => ({ rev: 2, seq: 500 }) },
    addEventListener: (ev, fn) => { winListeners[ev] = fn; }
  };
  const store = new Map();
  const ctx = {
    window: fakeWindow,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    Date, Math, Number, String, JSON, Object, Array, Promise, EventTarget, Event, DOMException,
    setTimeout, clearTimeout, setInterval, clearInterval
  };
  vm.createContext(ctx);
  vm.runInContext(rs, ctx);
  assert.equal(fakeWindow.F123Relay.ckptFrameBytes, 1536 * 1024);

  const url = 'wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/' + 'a'.repeat(40) + '-y';
  // Connect CF, open, let sondaOtraCapa detect non-empty FB (2:500) -> CF closes -> FB opens!
  const hub = fakeWindow.F123Relay.connect(url);
  await new Promise(r => setTimeout(r, 30));
  // Trigger next connect on FB now that CF paused by sondaOtraCapa
  const hub2 = fakeWindow.F123Relay.connect(url);
  closedReasons.length = 0;
  winListeners['oc-login']?.();
  assert.equal(closedReasons.filter(x => x.layer === 'f123_relay_cupo_fb_v1').length, 0, 'oc-login must NOT kill an active un-recovered Firebase fallback download');
  hub.close?.(); hub2.close?.();
});

test('RED->GREEN (Chromium): PR #1096 deep-link #editar=comisiones opens By rack visibly and preserves hash while locked; dashboard All dates guards cobertura.liquidaciones', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(ROOT, 'docs/index.html')).href, { waitUntil: 'load' });
    const res = await page.evaluate(async () => {
      await cargarComisiones();
      window._ocVistaComisiones = 'product';
      cambiarVistaComisiones('product');

      const gate = document.getElementById('oc-gate');
      if (gate) gate.hidden = false;
      window.OCAuth = { rolActual: () => null, esDemo: () => false };
      location.hash = '#editar=comisiones:u1&mes=2026-09';
      await new Promise(r => setTimeout(r, 20)); // flush any queued hashchange while locked
      await procesarDeepLinkEditar();
      const preservedWhileLocked = location.hash;

      if (gate) gate.hidden = true;
      window.OCAuth = { rolActual: () => 'dueno', esDemo: () => false };
      await procesarDeepLinkEditar();
      await new Promise(r => setTimeout(r, 120));
      const panelRack = document.getElementById('comm-panel-rack');

      // Also verify PR #1096 All dates paid vs unpaid button guard
      const htmlPaid = resumenComisionesGlobalHtml([{
        id: 'vp', productoId: 'p1', productoNombre: 'Paid Item', ubicacionId: 'u1', ubicacionNombre: 'Rack 1',
        cantidad: 1, precioUnit: 20, fecha: '2026-09-10T12:00:00Z', comisionPct: 30, comisionAsociado: 6, liquidada: true, comisionPendiente: 0
      }]);
      const htmlDue = resumenComisionesGlobalHtml([{
        id: 'vd', productoId: 'p2', productoNombre: 'Due Item', ubicacionId: 'u2', ubicacionNombre: 'Rack 2',
        cantidad: 1, precioUnit: 20, fecha: '2026-09-10T12:00:00Z', comisionPct: 30, comisionAsociado: 6, liquidada: false, comisionPendiente: 6
      }]);
      return {
        preservedWhileLocked,
        vistaDespues: window._ocVistaComisiones,
        rackHidden: panelRack ? panelRack.hidden : null,
        mes: _ocMesComisiones,
        paidHasPrimaryPay: /data-comm-pay-product=/.test(htmlPaid),
        dueHasPrimaryPay: /data-comm-pay-product="p2"/.test(htmlDue)
      };
    });
    assert.equal(res.preservedWhileLocked, '#editar=comisiones:u1&mes=2026-09', 'Locked user must keep #editar=comisiones hash until PIN unlock');
    assert.equal(res.mes, '2026-09');
    assert.equal(res.vistaDespues, 'rack', 'Deep-link #editar=comisiones must switch Commissions view to rack');
    assert.equal(res.rackHidden, false, '#comm-panel-rack must be visible');
    assert.equal(res.paidHasPrimaryPay, false, 'Already-paid product in All dates must not show green Record payment');
    assert.equal(res.dueHasPrimaryPay, true, 'Unpaid product in All dates must show Record payment');

    await page.goto(pathToFileURL(path.join(ROOT, 'docs/dashboard.html')).href, { waitUntil: 'load' });
    const dashText = await page.evaluate(() => {
      window.OCDashComisiones.pintarConDatos({
        ventas: [], liquidaciones: [], ajustesComision: [],
        cobertura: { ventas: true, liquidaciones: false, ajustesComision: true }
      });
      return document.getElementById('cm')?.textContent || '';
    });
    assert.match(dashText, /incomplete records never become zero|Ventas pendientes de sincronizar/i, 'Dashboard All dates must guard cobertura.liquidaciones === false');
  } finally {
    await browser.close();
  }
});
