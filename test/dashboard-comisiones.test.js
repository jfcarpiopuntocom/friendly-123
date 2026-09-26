/* Bloque 6b (JFC 2026-09-24): Commissions es la estrella del dashboard. Se pinta
   desde la foto que manda la app, sin escribir dinero: pagar/corregir/devolver
   mandan a la app por deep-link. Rojo contra shell 382 (no existia #cm). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const fx = require('./helpers/dashboard-comisiones-fixture.cjs');

test('dashboard paints Commissions first: month bar, totals, cards, deep-links and ranking', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/dashboard.html')).href, { waitUntil: 'load' });
    const r = await page.evaluate((d) => {
      window.OCDashComisiones.pintarConDatos(d);
      const cm = document.getElementById('cm');
      const txt = cm.innerText;
      const orden = [...document.querySelectorAll('#tablero .wrap > *')].map(e => e.id);
      return {
        txt, orden,
        pagar: [...cm.querySelectorAll('a.pagar')].map(a => a.getAttribute('href')),
        keys: [...cm.querySelectorAll('.cm-key')].map(b => b.textContent.trim()),
        meses: window.OCDashComisiones.meses(),
      };
    }, fx.datos);
    assert.ok(r.orden.indexOf('cm') === r.orden.indexOf('kpis') + 1, 'Commissions sits right after the KPIs (star feature)');
    assert.ok(r.meses.includes(fx.mes) && r.meses.includes(fx.prev), 'months come from the sales');
    assert.match(r.txt, /Sales with commission/); assert.match(r.txt, /Still to pay/);
    assert.match(r.txt, /\$120\.00/, 'gross of this month: 50+50+20');
    assert.match(r.txt, /\$44\.50/, 'associates take 42.5+42.5+2 minus the 42.5 return');
    assert.ok(r.keys.some(k => /still to pay|\$42\.50/.test(k)) || r.keys.some(k => k.includes(fx.prev.slice(0, 4))), 'the unpaid earlier month is a red key');
    assert.match(r.txt, /Mountain print/); assert.match(r.txt, /House sale/);
    assert.match(r.txt, /Ranking/); assert.ok(r.txt.indexOf('Ranking') > r.txt.indexOf('Mountain print'), 'ranking at the bottom');
    // vista por percha: pagar en la app y devoluciones
    const r2 = await page.evaluate(() => {
      document.querySelector('[data-cm-vista="percha"]').click();
      const cm = document.getElementById('cm');
      return { txt: cm.innerText, pagar: [...cm.querySelectorAll('a.pagar')].map(a => a.getAttribute('href')), recibo: cm.querySelectorAll('[data-cm-recibo]').length };
    });
    assert.ok(r2.pagar.some(h => h === 'index.html#editar=comisiones:u1'), 'Pay in the app deep-links to the rack in the app');
    assert.match(r2.txt, /1 return\(s\) of already-paid sales/);
    assert.match(r2.txt, /Split between people/);
    assert.match(r2.txt, /on margin|Target \$800\.00/);
    assert.equal(r2.recibo, 2, 'one receipt per rack');
    // mes anterior: totales de ese mes
    const r3 = await page.evaluate((prev) => { const s = document.getElementById('cm-mes'); s.value = prev; s.dispatchEvent(new Event('change')); return document.getElementById('cm').innerText; }, fx.prev);
    assert.match(r3, /\$50\.00/); assert.match(r3, /\$42\.50/);
    await page.evaluate(() => { document.querySelector('[data-cm-vista="producto"]').click(); document.getElementById('puerta').style.display = 'none'; document.getElementById('cabecera').style.display = 'block'; document.getElementById('tablero').style.display = 'block'; window.scrollTo(0, 0); });
    await page.screenshot({ path: '/tmp/claude-0/shots/7-dash-commissions.png' });
  } finally { await web.close(); }
});
