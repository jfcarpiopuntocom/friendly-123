'use strict';
/* v599 (JFC 2026-10-27): latencia aparato A -> pantalla de aparato B.
   Meta del dueno: < 500 ms (ideal 150 ms). Aqui la red es un reenvio inmediato (~0 ms),
   asi que se mide SOLO el retraso interno de la app: desde que A inicia el cambio
   hasta que el DOM de B (vista inventario) muestra el nombre nuevo.
   Env: E2E_DOCS (otra carpeta docs para comparar versiones), LAT_N (muestras), LAT_BIG (productos).
   Datos sinteticos, sin red. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openDevice, enterAs, go, chromium, installPump } = require('./helpers/e2e-app.cjs');
let server, base, web;
before(async () => { ({ srv: server, base } = await startServer()); web = await require('playwright')[process.env.MEGA_ENGINE || 'chromium'].launch(); });
after(async () => { await web.close(); await new Promise(r => server.close(r)); });

const N = Number(process.env.LAT_N || 8), BIG = Number(process.env.LAT_BIG || 300);
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };

async function pair(grande) {
  const A = await openDevice(web, base), B = await openDevice(web, base);
  await enterAs(A.page, 'dueno'); await enterAs(B.page, 'admin');
  await A.page.waitForFunction(() => OCYjs.estado === 'activo'); await B.page.waitForFunction(() => OCYjs.estado === 'activo');
  await installPump([A, B]);
  const ids = [];
  if (grande) {
    // Cuaderno grande sintetico: se siembra en A y se pasa a B con un reenvio de estado completo.
    await A.page.evaluate(async n => {
      for (let i = 0; i < n; i++) await fetch('/api/productos', { method: 'POST', body: JSON.stringify({ nombre: 'Sintetico ' + i, barcode: 'SYN-' + i, stockInicial: 2, precio: 10 + (i % 50), costo: 3 }) });
    }, grande);
    await A.page.waitForTimeout(1500);
  }
  const p = await A.page.evaluate(async () => (await (await fetch('/api/productos', { method: 'POST', body: JSON.stringify({ nombre: 'Objetivo', barcode: 'SYN-OBJ', stockInicial: 3, precio: 50, costo: 20 }) })).json()));
  await A.page.waitForTimeout(1500);
  // Estado completo A -> B (como un aparato que ya estaba al dia)
  const full = await A.page.evaluate(() => Array.from(Y.encodeStateAsUpdate(OCYjs.doc)));
  await B.page.evaluate(arr => { Y.applyUpdate(OCYjs.doc, new Uint8Array(arr), 'red'); try { OCYjs._store.aplicar(); } catch (_) {} }, full);
  await B.page.waitForTimeout(1500);
  // Reenvio inmediato A -> B (reemplaza al pump por sondeo)
  await A.page.evaluate(() => { window.__pumpOn = false; });
  await A.page.exposeBinding('__fwd', (_, arr) => B.page.evaluate(a => {
    window.__tRecv = performance.timeOrigin + performance.now();
    Y.applyUpdate(OCYjs.doc, new Uint8Array(a), 'red'); // aplicar() lo dispara el propio listener de la app
    window.__tAplic = performance.timeOrigin + performance.now();
  }, arr));
  await A.page.evaluate(() => { OCYjs.doc.on('update', (u, o) => { if (o !== 'red') { if (!window.__tUpd || true) window.__tUpd = performance.timeOrigin + performance.now(); window.__sz = (window.__sz||[]).concat(u.length + '@' + Math.round(window.__tUpd - window.__t0)); window.__fwd(Array.from(u)); } }); });
  await go(B.page, 'inventario');
  // Observador en B: marca el instante en que aparece el nombre buscado en el DOM
  await B.page.evaluate(() => {
    window.__vigia = nombre => new Promise(res => {
      const ya = () => document.body.textContent.includes(nombre); // textContent: sin forzar layout
      if (ya()) return res(-1);
      const mo = new MutationObserver(() => { if (ya()) { mo.disconnect(); res(performance.timeOrigin + performance.now()); } });
      mo.observe(document.body, { subtree: true, childList: true, characterData: true });
      setTimeout(() => { mo.disconnect(); res(null); }, 30000);
    });
  });
  return { A, B, id: p.id };
}

async function medir(grande) {
  const { A, B, id } = await pair(grande);
  const muestras = [], recv = [], desg = [];
  const prof = process.env.MEGA_PROF ? await Promise.all([A, B].map(async d => { const s = await d.ctx.newCDPSession(d.page); await s.send('Profiler.enable'); await s.send('Profiler.setSamplingInterval', { interval: 200 }); return s; })) : null;
  await B.page.evaluate(() => { const o = Storage.prototype.setItem; window.__si = []; Storage.prototype.setItem = function (k, v) { const t = performance.timeOrigin + performance.now(); const r = o.call(this, k, v); const st = (new Error().stack || '').split(String.fromCharCode(10)).slice(2, 16).map(s => s.trim().slice(3).split('127.0.0.1:').map(x => x.replace(/^[0-9]+./, '')).join('').slice(0, 70)).join(' < '); window.__bytes = (window.__bytes || 0) + String(v).length; window.__si.push([t, performance.timeOrigin + performance.now(), k, String(v).length, st]); return r; }; });
  const antesPintar = [];
  for (let i = 0; i < N; i++) {
    const nombre = 'Renombrado' + i + 'x';
    if (prof && i === 3) for (const s of prof) await s.send('Profiler.start');
    await B.page.evaluate(n => { window.__esp = window.__vigia(n); }, nombre);
    const t0 = await A.page.evaluate(async ([id, n]) => {
      const t = performance.timeOrigin + performance.now();
      window.__tUpd = null; window.__t0 = t;
      await fetch('/api/productos/' + id, { method: 'PATCH', body: JSON.stringify({ nombre: n }) });
      window.__tPatch = performance.timeOrigin + performance.now();
      return t;
    }, [id, nombre]);
    const t1 = await B.page.evaluate(() => window.__esp);
    const tr = await B.page.evaluate(() => window.__tRecv);
    assert.ok(t1 && t1 > 0, 'B nunca mostro ' + nombre);
    const ta = await A.page.evaluate(() => [window.__tUpd, window.__tPatch]); const tap = await B.page.evaluate(() => window.__tAplic);
    desg.push('sz=' + await A.page.evaluate(() => (window.__sz || []).splice(0).join('/')) + ' patch=' + Math.round(ta[1] - t0) + ' upd=' + Math.round(ta[0] - t0) + ' aplicB=' + Math.round(tap - tr) + ' domTras=' + Math.round(t1 - tap));
    muestras.push(Math.round(t1 - t0)); recv.push(Math.round(tr - t0));
    antesPintar.push(await B.page.evaluate(([a, b]) => { const s = window.__si.filter(x => x[0] >= a && x[0] <= b); window.__si = []; return s.length + ':' + Math.round(s.reduce((n, x) => n + x[1] - x[0], 0)) + 'ms' + (window.__dump || !s.length ? '' : (window.__dump = 1, ' KEYS ' + s.map(x => x[2] + '(' + x[3] + 'B,' + Math.round(x[1] - x[0]) + 'ms) <= ' + x[4]).join(' || '))); }, [tr, t1]));
    if (prof && i === 3) for (const [k, s] of prof.entries()) {
      const { profile } = await s.send('Profiler.stop'); const self = new Map(); const dt = profile.timeDeltas; const byId = new Map(profile.nodes.map(n => [n.id, n]));
      profile.samples.forEach((id, j) => { const n = byId.get(id); const cf = n.callFrame; const key = (cf.functionName || '(anon)') + ' ' + cf.url.split('/').pop() + ':' + (cf.lineNumber + 1); self.set(key, (self.get(key) || 0) + (dt[j] || 0)); });
      console.log('PROF ' + (k ? 'B' : 'A') + ' ' + [...self].filter(([n]) => !/^\(idle|program|garbage/.test(n)).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([n, us]) => n + '=' + (us / 1000).toFixed(1) + 'ms').join(' ; '));
    }
    await A.page.waitForTimeout(400);
  }
  const mbB = (await B.page.evaluate(() => window.__bytes || 0) / N / 1e6).toFixed(2);
  console.log('SETITEM-ANTES-DE-PINTAR ' + antesPintar.join(' ').replace(/ KEYS.*/, '') + ' | MB-escritos-por-cambio-en-B=' + mbB);
  await A.ctx.close(); await B.ctx.close();
  return { desg, dom: muestras, recv, p50: pct(muestras, 0.5), p95: pct(muestras, 0.95) };
}


// Umbral JFC para 300 productos: p50 <= 300 ms, p95 <= 500 ms. Otros tamanos son referencia.
for (const [etiqueta, grande] of [['cuaderno chico', 0], ['cuaderno 300', 300], ['cuaderno 1000', 1000]].filter(x => (process.env.MEGA_SIZES || '0,300,1000,frio').split(',').includes(String(x[1])))) {
  test('MEGA ' + (process.env.MEGA_ENGINE || 'chromium') + ' ' + etiqueta, { timeout: 1800000 }, async () => {
    const r = await medir(grande);
    console.log('MEGA ' + (process.env.MEGA_ENGINE || 'chromium') + ' ' + etiqueta + ' n=' + r.dom.length + ' p50=' + r.p50 + ' p95=' + r.p95 + ' meta=' + (grande === 300 ? (r.p50 <= 300 && r.p95 <= 500 ? 'PASS' : 'FAIL') : 'REFERENCIA') + ' DESG ' + r.desg.slice(-5).join(' | '));
  });
}
if ((process.env.MEGA_SIZES || '0,300,1000,frio').split(',').includes('frio')) test('MEGA apertura en frio x10', { timeout: 600000 }, async () => {
  const tiempos = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now(); const d = await openDevice(web, base); await enterAs(d.page, 'dueno');
    await d.page.waitForFunction(() => OCYjs.estado === 'activo'); tiempos.push(Date.now() - t0); await d.ctx.close();
  }
  console.log('MEGA ' + (process.env.MEGA_ENGINE || 'chromium') + ' apertura ms=' + tiempos.join(',') + ' peor=' + Math.max(...tiempos) + ' meta=' + (Math.max(...tiempos) < 3000 ? 'PASS' : 'FAIL'));
});