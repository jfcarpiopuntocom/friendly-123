'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, openDevice, chromium } = require('./helpers/e2e-app.cjs');

test('quantity actions stay reachable above the mobile keyboard and setting 7 commits once', { timeout: 60000 }, async () => {
  const { srv, base } = await startServer();
  let web;
  try {
    web = await chromium.launch();
    const { page, ctx } = await openDevice(web, base, { license: 'F123-SYNTHETIC-MOBILE-ONLY' });
    const id = await page.evaluate(async () => {
      const original = OCAuth;
      window.OCAuth = Object.assign({}, original, { rolActual: () => 'dueno' });
      try {
        localStorage.setItem('f123_owned', JSON.stringify({ instanceId: 'synthetic-mobile-device' }));
        await OCSecure.guardarSecreto('789', ['260'], '357', '');
        const r = await fetch('/api/productos', { method: 'POST', body: JSON.stringify({ nombre: 'Synthetic mobile count', barcode: 'SYN-MOBILE-641', stockInicial: 6, precio: 10, costo: 4 }) });
        if (!r.ok) throw Error(await r.text());
        return (await r.json()).id;
      } finally { window.OCAuth = original; }
    });
    for (const digit of ['7', '8', '9']) await page.locator('#oc-pad').getByRole('button', { name: digit, exact: true }).click();
    await page.waitForFunction(() => OCAuth.rolActual() === 'dueno');
    if (await page.locator('#am-welcome.abierto').isVisible()) await page.locator('#am-welcome-ok').click();
    await page.evaluate(async () => {
      await cargarInventario();
      class Viewport extends EventTarget {
        constructor() { super(); this.height = innerHeight; this.offsetTop = 0; this.listeners = new Map(); }
        addEventListener(t, fn, opts) { super.addEventListener(t, fn, opts); this.listeners.set(fn, t); }
        removeEventListener(t, fn, opts) { super.removeEventListener(t, fn, opts); this.listeners.delete(fn); }
      }
      const vv = new Viewport();
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
      window.__keyboard = (height, offsetTop = 0) => {
        vv.height = height; vv.offsetTop = offsetTop;
        let shield = document.getElementById('synthetic-keyboard');
        if (!shield) { shield = document.createElement('div'); shield.id = 'synthetic-keyboard'; document.body.append(shield); }
        shield.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${innerHeight-height-offsetTop}px;z-index:10050;background:#ddd;`;
        vv.dispatchEvent(new Event('resize')); vv.dispatchEvent(new Event('scroll'));
      };
    });
    await page.locator('button[data-vista="inventario"]').click();
    const button = page.locator(`[data-ajuste-cantidad="${id}"]`);
    await button.click();
    await page.locator('#oc-cant-n').fill('7');
    await page.evaluate(() => __keyboard(300, 50));
    for (const sel of ['[data-cant-sumar]', '[data-cant-fijar]', '[data-cant-cancel]']) {
      const target = page.locator('#oc-cantidad-modal ' + sel);
      await target.scrollIntoViewIfNeeded();
      const facts = await target.evaluate(el => {
        const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
        return { top: r.top, bottom: r.bottom, reachable: hit === el || el.contains(hit), horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      assert.ok(facts.top >= 50 && facts.bottom <= 350 && facts.reachable && !facts.horizontalOverflow, `${sel}: ${JSON.stringify(facts)}`);
    }
    await page.locator('[data-cant-fijar]').click();
    await page.waitForFunction(async id => {
      const rows = await (await fetch('/api/productos')).json(); return rows.find(p => p.id === id)?.stockActual === 7;
    }, id);
    const adjustments = await page.evaluate(async () => (await (await fetch('/api/actividad')).json())
      .filter(m => m.tipo === 'conteo-fisico' && m.detalle?.producto === 'Synthetic mobile count').length);
    assert.equal(adjustments, 1, 'one confirmed physical count creates exactly one adjustment');
    assert.equal(await page.evaluate(() => visualViewport.listeners.size), 0, 'closed dialog releases viewport listeners');
    await page.evaluate(() => { document.getElementById('synthetic-keyboard').remove(); visualViewport.height = innerHeight; visualViewport.offsetTop = 0; });
    await button.click();
    await page.locator('[data-cant-cancel]').click();
    assert.equal(await page.evaluate(() => visualViewport.listeners.size), 0);
    await ctx.close();
  } finally { if (web) await web.close(); await new Promise(resolve => srv.close(resolve)); }
});
