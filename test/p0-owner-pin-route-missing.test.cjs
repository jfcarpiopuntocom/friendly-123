'use strict';
// QA real 2026-11-01: the deployed licensing worker answered POST /pin/verify with a generic
// 404 {"error":"Not found"} (route not deployed). The app read it as a license identity mismatch
// and locked every Owner out on the next PIN entry. Only the PIN authority's explicit
// "license-instance-mismatch" may block the Owner.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const DOCS = path.resolve(__dirname, '../docs');
const HOST = 'https://f123-owner-pin.test/';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

async function activarYVolver(verify404Body) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.route('**/*', r => {
    const u = new URL(r.request().url());
    if (u.origin + '/' === HOST) {
      let p = u.pathname.slice(1) || 'index.html'; if (p.endsWith('/')) p += 'index.html';
      const f = path.join(DOCS, p);
      if (f.startsWith(DOCS) && fs.existsSync(f) && fs.statSync(f).isFile())
        return r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
      return r.fulfill({ status: 404, body: '' });
    }
    if (u.hostname === 'friendly123-licencias.jfcarpio.workers.dev') {
      if (u.pathname.startsWith('/pin/')) return r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify(verify404Body) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return r.abort();
  });
  await ctx.addInitScript(() => { window.WebSocket = class { constructor() { throw new Error('no network in test'); } }; });
  const page = await ctx.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));
  await page.goto(HOST, { waitUntil: 'domcontentloaded' });
  const teclear = async code => {
    const pad = page.locator('#oc-gate button[data-d]').first();
    if (!(await pad.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: /log out|cerrar sesi/i }).first().click();
      await pad.waitFor({ state: 'visible' });
    }
    for (const c of code) await page.locator(`#oc-gate button[data-d="${c}"]`).first().click();
    await page.waitForTimeout(2500);
  };
  await teclear('789');
  await page.click('#oc-act-nuevo');
  await page.fill('#oc-act-nombre', 'Synthetic owner');
  await page.fill('#oc-act-email', 'owner@example.com');
  await page.fill('#oc-act-tel', '0999999999');
  await page.click('#oc-act-confirmar');
  await page.waitForSelector('#oc-act-exito', { state: 'visible', timeout: 30000 });
  await page.click('#oc-act-entrar');
  await page.waitForTimeout(2000);
  await teclear('789'); // the Owner comes back after logging out
  const r = await page.evaluate(() => ({
    rol: (() => { try { return OCAuth.rolActual(); } catch (_) { return null; } })(),
    pad: !!document.querySelector('#oc-gate button[data-d]')?.offsetParent,
    msg: /no coincide con el registro central/.test(document.body.innerText)
  }));
  await ctx.close();
  return r;
}

test('Owner re-enters with 789 when the PIN authority route is not deployed (generic 404)', async () => {
  const r = await activarYVolver({ error: 'Not found' });
  assert.equal(r.msg, false, 'no identity-mismatch message for a missing route');
  assert.equal(r.pad, false, 'the PIN pad is gone: the Owner is inside');
  assert.equal(r.rol, 'dueno');
});

test('an explicit license-instance-mismatch from the PIN authority still blocks the Owner', async () => {
  const r = await activarYVolver({ ok: false, reason: 'license-instance-mismatch' });
  assert.equal(r.msg, true, 'the mismatch message is shown');
  assert.notEqual(r.rol, 'dueno');
});

test('after 789 opens the store chooser, the keypad is empty and the next PIN is accepted', async () => {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  await ctx.route('**/*', r => {
    const x = new URL(r.request().url());
    if (x.origin + '/' === HOST) {
      let p = x.pathname.slice(1) || 'index.html'; if (p.endsWith('/')) p += 'index.html';
      const f = path.join(DOCS, p);
      if (f.startsWith(DOCS) && fs.existsSync(f) && fs.statSync(f).isFile())
        return r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
      return r.fulfill({ status: 404, body: '' });
    }
    return r.abort();
  });
  const page = await ctx.newPage();
  await page.goto(HOST, { waitUntil: 'domcontentloaded' });
  const pad = page.locator('#oc-gate button[data-d]').first();
  if (!(await pad.isVisible().catch(() => false))) { await page.getByRole('button', { name: /log out|cerrar sesi/i }).first().click(); await pad.waitFor({ state: 'visible' }); }
  for (const c of '789') await page.locator(`#oc-gate button[data-d="${c}"]`).first().click();
  await page.waitForSelector('#oc-act-nada', { state: 'visible' });
  await page.click('#oc-act-nada'); // "not now": back to the PIN screen
  const filled = await page.evaluate(() => document.getElementById('oc-pad')._ocTeclado.entrada().length);
  await ctx.close();
  assert.equal(filled, 0, 'no stale digits after the chooser');
});
