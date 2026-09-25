// Plan canarios F1 (JFC 2026-09-25): el mismo sw.js corre en /friendly-123/ (estable) y en
// /friendly-123/next/ (canario). Mismo origen = misma CacheStorage. Con el sw anterior, el
// canario en un shell MAS NUEVO borraba al activarse la cache del estable (filtro
// "f123-shell-*" ajeno). Aqui: servidor local con los dos canales, SW reales en Chromium.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const DOCS = path.join(__dirname, '../docs');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

function servidor() {
  return http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    let canario = false, previo = false;
    if (u.startsWith('/friendly-123/next/')) { canario = true; u = u.slice('/friendly-123/next'.length); }
    else if (u.startsWith('/friendly-123/previo/')) { previo = true; u = u.slice('/friendly-123/previo'.length); }
    else if (u.startsWith('/friendly-123/')) u = u.slice('/friendly-123'.length);
    else { res.writeHead(404); return res.end(); }
    if (u === '/') u = '/index.html';
    const f = path.join(DOCS, u);
    if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    let cuerpo = fs.readFileSync(f);
    // El canario va un shell ADELANTE (el caso real: master por delante de estable).
    // El previo va un shell ATRAS (el estable anterior, para el rewind).
    if (previo && u === '/sw.js') cuerpo = Buffer.from(cuerpo.toString('utf8').replace(/const CACHE = "f123-shell-v(\d+)"/, (m, n) => `const CACHE = "f123-shell-v${Number(n) - 1}"`));
    if (canario && u === '/sw.js') cuerpo = Buffer.from(cuerpo.toString('utf8').replace(/const CACHE = "f123-shell-v(\d+)"/, (m, n) => `const CACHE = "f123-shell-v${Number(n) + 1}"`));
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(cuerpo);
  });
}

async function esperarSW(page) {
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(1500);
}

test('estable y canario conviven: el canario mas nuevo NO borra la cache de los clientes', async () => {
  const srv = servidor();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/friendly-123/`;
  const web = await chromium.launch({ headless: true });
  try {
    const ctx = await web.newContext();
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: 'load' });
    await esperarSW(page);
    const antes = await page.evaluate(() => caches.keys());
    const estable = antes.find((n) => /^f123-shell-v\d+$/.test(n));
    assert.ok(estable, 'el estable creo su cache: ' + antes.join(','));

    const p2 = await ctx.newPage();
    await p2.goto(base + 'next/', { waitUntil: 'load' });
    // /next/ arranca controlado por el SW raiz (esta dentro de su scope); hay que esperar a
    // que el SW PROPIO de /next/ se active y tome control (clients.claim) antes de mirar.
    await p2.waitForFunction(() => navigator.serviceWorker.controller && /\/next\/sw\.js$/.test(navigator.serviceWorker.controller.scriptURL), null, { timeout: 30000 });
    await p2.waitForTimeout(2500);
    const despues = await p2.evaluate(() => caches.keys());
    assert.ok(despues.includes(estable), 'la cache del estable sigue viva: ' + despues.join(','));
    // Con el sw anterior la cache del estable se BORRABA y el SW raiz la recreaba solo con
    // URLs de /next/: la copia offline de los clientes (su index.html precacheado) se perdia.
    const copiaOffline = await p2.evaluate(async ([nombre, url]) => !!(await (await caches.open(nombre)).match(url)), [estable, base + 'index.html']);
    assert.ok(copiaOffline, 'la copia offline del estable (index.html) sigue en su cache');
    assert.ok(despues.some((n) => /^f123-shell-v\d+-next$/.test(n)), 'el canario tiene su propia cache -next: ' + despues.join(','));
    // El SW del canario responde su shell SIN sufijo (la verificacion de version no cambia).
    const shell = await p2.evaluate(() => new Promise((res) => {
      navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.tipo === 'shell-actual') res(e.data.shell); });
      navigator.serviceWorker.controller.postMessage({ tipo: 'que-shell' });
      setTimeout(() => res('sin respuesta'), 3000);
    }));
    assert.match(shell, /^f123-shell-v\d+$/);
  } finally { await web.close(); srv.close(); }
});

test('tres canales (previo, estable, next) conviven: ninguno borra la cache de otro', async () => {
  const srv = servidor();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/friendly-123/`;
  const web = await chromium.launch({ headless: true });
  try {
    const ctx = await web.newContext();
    for (const [ruta, re] of [['', null], ['next/', /\/next\/sw\.js$/], ['previo/', /\/previo\/sw\.js$/]]) {
      const p = await ctx.newPage();
      await p.goto(base + ruta, { waitUntil: 'load' });
      if (re) await p.waitForFunction((src) => navigator.serviceWorker.controller && new RegExp(src).test(navigator.serviceWorker.controller.scriptURL), re.source, { timeout: 30000 });
      else await esperarSW(p);
      await p.waitForTimeout(2000);
    }
    const p = await ctx.newPage();
    await p.goto(base + 'previo/', { waitUntil: 'load' });
    const nombres = await p.evaluate(() => caches.keys());
    assert.ok(nombres.some((n) => /^f123-shell-v\d+$/.test(n)), 'estable: ' + nombres.join(','));
    assert.ok(nombres.some((n) => /^f123-shell-v\d+-next$/.test(n)), 'next: ' + nombres.join(','));
    assert.ok(nombres.some((n) => /^f123-shell-v\d+-previo$/.test(n)), 'previo: ' + nombres.join(','));
    const offline = await p.evaluate(async (b) => {
      const est = (await caches.keys()).find((n) => /^f123-shell-v\d+$/.test(n));
      return !!(await (await caches.open(est)).match(b + 'index.html'));
    }, base);
    assert.ok(offline, 'la copia offline del estable sigue entera');
  } finally { await web.close(); srv.close(); }
});
