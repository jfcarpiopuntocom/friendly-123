// v738: arreglos de hoy en el tablero (dashboard.html). Datos solo sinteticos.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readyEnvironment } = require('./helpers/ready-environment.cjs');

for (const engine of ['chromium', 'webkit']) {
  const nombre = engine === 'chromium' ? 'Chromium' : 'WebKit';

  test(`el tablero arranca sin modales ni dialogos de error (${nombre})`, async () => {
    const env = await readyEnvironment({ engine });
    const ctx = await env.context();
    try {
      const page = await ctx.newPage();
      const dialogos = [];
      page.on('dialog', d => { dialogos.push(d.message()); d.dismiss().catch(() => {}); });
      await page.goto(env.origin + '/dashboard.html');
      await page.locator('#pin').waitFor({ state: 'visible' });
      await page.waitForTimeout(500);
      const visibles = await page.evaluate(() => Array.from(document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"]'))
        .filter(el => getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0).map(el => el.id || el.tagName));
      assert.deepEqual(visibles, [], 'ningun modal visible al arrancar');
      assert.deepEqual(dialogos, [], 'ningun alert/confirm/prompt nativo al arrancar');
    } finally { await ctx.close(); await env.close(); }
  });

  test(`una version nueva recarga como maximo una vez y queda anotada (${nombre})`, async () => {
    const env = await readyEnvironment({ engine });
    const ctx = await env.context();
    try {
      await ctx.addInitScript(() => {
        // Simula un service worker que ya sirve el shell nuevo.
        const NUEVO = 'f123-shell-v999';
        const ctl = { postMessage() { setTimeout(() => { for (const f of oyentes) f({ source: ctl, data: { tipo: 'shell-actual', shell: NUEVO } }); }, 0); } };
        const oyentes = [];
        const reg = { update: async () => {}, waiting: null };
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {
          controller: ctl, getRegistration: async () => reg, register: async () => reg,
          addEventListener(t, f) { if (t === 'message') oyentes.push(f); }, removeEventListener() {}
        } });
        const f0 = window.fetch.bind(window);
        window.fetch = async (u, o) => {
          const s = String(u);
          if (s.includes('version.json')) return new Response(JSON.stringify({ shell: NUEVO }), { status: 200 });
          const r = await f0(u, o);
          if (s.includes('dashboard.html?dash')) {
            const t = (await r.text()).replace(/(name="dashboard-shell"\s+content=")[^"]+/, '$1' + NUEVO);
            return new Response(t, { status: 200 });
          }
          return r;
        };
      });
      const page = await ctx.newPage();
      let cargas = 0;
      page.on('load', () => { cargas++; });
      await page.goto(env.origin + '/dashboard.html');
      // El campo del PIN tiene el foco y eso (con razon) frena la recarga: se suelta para simular reposo.
      await page.evaluate(() => { document.activeElement && document.activeElement.blur(); return window.OCDashboardUpdates.check(); });
      for (let i = 0; i < 40 && cargas < 2; i++) await page.waitForTimeout(250);
      assert.equal(cargas, 2, 'la version nueva recarga una vez');
      await page.waitForLoadState('load');
      // La segunda carga intenta de nuevo sola (1 s) y a mano varias veces: no debe recargar otra vez.
      for (let i = 0; i < 3; i++) await page.evaluate(() => window.OCDashboardUpdates && window.OCDashboardUpdates.check());
      await page.waitForTimeout(2500);
      assert.equal(cargas, 2, 'una sola recarga');
      const log = await page.evaluate(() => JSON.parse(localStorage.getItem('f123_recargas_log') || '[]'));
      assert.equal(log.filter(x => x.m === 'version-segura').length, 1);
      assert.ok(log.some(x => x.m === 'omitida-tope:version-segura'), 'la recarga repetida se omite y se anota');
      assert.deepEqual(Object.keys(log[0]).sort(), ['m', 't', 'v']);
      assert.equal(log[0].v, 'f123-shell-v999');
    } finally { await ctx.close(); await env.close(); }
  });

  test(`un error provocado queda en el registro local sin mostrar nada (${nombre})`, async () => {
    const env = await readyEnvironment({ engine });
    const ctx = await env.context();
    try {
      const page = await ctx.newPage();
      const dialogos = [];
      page.on('dialog', d => { dialogos.push(d.message()); d.dismiss().catch(() => {}); });
      await page.goto(env.origin + '/dashboard.html');
      await page.locator('#pin').waitFor({ state: 'visible' });
      const antes = await page.evaluate(() => document.body.innerText);
      await page.evaluate(() => {
        setTimeout(() => { throw new Error('sintetico-boom'); }, 0);
        Promise.reject(new Error('sintetico-rechazo'));
      });
      await page.waitForFunction(() => (JSON.parse(localStorage.getItem('f123_errores_log') || '[]')).length >= 2);
      const log = await page.evaluate(() => JSON.parse(localStorage.getItem('f123_errores_log')));
      assert.ok(log.some(x => x.k === 'error' && /sintetico-boom/.test(x.m)));
      assert.ok(log.some(x => x.k === 'rechazo' && /sintetico-rechazo/.test(x.m)));
      for (const x of log) assert.deepEqual(Object.keys(x).sort(), ['k', 'm', 's', 't']);
      assert.equal(await page.evaluate(() => document.body.innerText), antes, 'la pantalla no cambia');
      assert.deepEqual(dialogos, []);
    } finally { await ctx.close(); await env.close(); }
  });
}
