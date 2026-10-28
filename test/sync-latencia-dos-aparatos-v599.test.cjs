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
before(async () => { ({ srv: server, base } = await startServer()); web = await chromium.launch(); });
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
      const ya = () => document.body.innerText.includes(nombre);
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
  for (let i = 0; i < N; i++) {
    const nombre = 'Renombrado' + i + 'x';
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
    await A.page.waitForTimeout(400);
  }
  await A.ctx.close(); await B.ctx.close();
  return { desg, dom: muestras, recv, p50: pct(muestras, 0.5), p95: pct(muestras, 0.95) };
}

// Meta del dueno: 500 ms. El cuaderno grande (O(N) en mock-backend + render de inventario) aun NO la cumple a 1000+ productos:
// con 300 sintetico la guarda es 800 ms (medido ~475); subir LAT_BIG para ver la curva (1000 productos ~2500 ms).
for (const [etiqueta, grande, tope] of [['cuaderno chico', 0, 500], ['cuaderno grande', BIG, 800]]) {
  test('latencia A->B ' + etiqueta + ': p95 < ' + tope + ' ms', { timeout: 600000 }, async () => {
    const r = await medir(grande);
    console.log('LAT ' + etiqueta + ' docs=' + (process.env.E2E_DOCS || 'actual') + ' p50=' + r.p50 + ' p95=' + r.p95 + ' dom=' + r.dom.join(',') + ' recvEnB=' + r.recv.join(',') + ' | ' + r.desg.join(' | '));
    assert.ok(r.p95 < tope, 'p95 ' + r.p95 + ' ms >= ' + tope);
  });
}
