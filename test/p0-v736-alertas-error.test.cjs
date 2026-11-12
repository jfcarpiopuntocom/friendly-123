'use strict';
// P0 v736 (JFC 2026-11-11): error alerts of selling / credit / payments appear INSIDE the UI,
// never as a blocking native alert(). Synthetic data only. Backup, marketing and status bars untouched.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium, webkit } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const INDEX = pathToFileURL(path.join(ROOT, 'docs/index.html')).href;
const count = (file) => (fs.readFileSync(path.join(ROOT, file), 'utf8').match(/(^|[^\w.])alert\(/gm) || []).length;

async function abrir(engine, lang) {
  const web = await engine.launch({ headless: true });
  const page = await web.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => { window.WebSocket = class { constructor() { this.readyState = 3; } addEventListener() {} send() {} close() {} }; });
  await page.goto(INDEX, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AMG && AMG.Hechos && window.OCAuth && window.OCI18n && typeof cargarGridVender === 'function' && window.fiarCliente);
  // Any blocking native dialog is recorded (and dismissed so the test never hangs).
  await page.evaluate(() => { window.__alerts = []; window.alert = (m) => { window.__alerts.push(String(m)); }; });
  page.on('dialog', async (d) => { await page.evaluate((m) => window.__alerts.push('DIALOG:' + m), d.message()); await d.dismiss(); });
  await page.evaluate((l) => { OCAuth.rolActual = () => 'dueno'; if (window.OCTabSession) OCTabSession.isCurrent = () => true; OCI18n.setLang(l); document.querySelectorAll('[id*="gate"]').forEach((e) => { e.style.display = 'none'; }); }, lang);
  return { web, page };
}

for (const [name, engine] of [['Chromium', chromium], ['WebKit', webkit]]) for (const lang of ['en', 'es']) {
  test(`fiado: failed debt posting shows its message inside the UI, no alert (${name}, ${lang})`, async () => {
    const { web, page } = await abrir(engine, lang);
    try {
      const fx = await page.evaluate(async () => {
        const j = async (u, b) => (await fetch(u, { method: 'POST', body: JSON.stringify(b) })).json();
        const c = await j('/api/clientes', { nombre: 'Synthetic customer' });
        const p = await j('/api/productos', { nombre: 'Synthetic item', barcode: 'SYNTH-736-A', precio: 10, costo: 2, stockInicial: 20 });
        document.querySelectorAll('.vista').forEach((e) => e.classList.remove('activa'));
        document.getElementById('gridVender').closest('.vista').classList.add('activa');
        await cargarGridVender();
        const orig = window.fetch;
        window.fetch = async (u, o) => (String(u).endsWith('/fiar') && o && o.method === 'POST')
          ? new Response(JSON.stringify({ error: 'x' }), { status: 500 }) : orig(u, o);
        return { c: c.id, p: p.id };
      });
      await page.locator('[data-vender-tile="' + fx.p + '"]').click();
      await page.locator('#vi-cliente').selectOption(fx.c);
      await page.locator('#vi-fiado').check();
      await page.locator('[onclick*="confirmarVentaConInfo"]').click();
      await page.waitForFunction(() => !document.getElementById('vi-cliente'));
      // The app picks the Spanish text only when OCI18n.locale() is exactly 'es' (headless Chromium reports 'es-US').
      const esES = await page.evaluate(() => OCI18n.locale() === 'es');
      const esperado = esES ? 'La venta quedó registrada, pero no se pudo confirmar el fiado' : 'The sale was recorded, but the debt could not be confirmed';
      await page.waitForFunction((t) => document.body.innerText.includes(t), esperado, { timeout: 5000 });
      assert.deepEqual(await page.evaluate(() => window.__alerts), [], 'no native alert');
    } finally { await web.close(); }
  });

  test(`servings: failed save shows its message inside the row, no alert (${name}, ${lang})`, async () => {
    const { web, page } = await abrir(engine, lang);
    try {
      await page.evaluate(async () => {
        const p = await (await fetch('/api/productos', { method: 'POST', body: JSON.stringify({ nombre: 'Synthetic bottle', barcode: 'SYNTH-736-B', precio: 10, costo: 2, stockInicial: 5, tipoProducto: 'bar', botellaMl: 750, servingMl: 50 }) })).json();
        document.querySelectorAll('.vista').forEach((e) => e.classList.remove('activa'));
        document.getElementById('fichaResultado').closest('.vista').classList.add('activa');
        await pintarFicha(p);
        const orig = window.fetch;
        window.fetch = async (u, o) => (o && o.method === 'PATCH' && String(u).includes('/productos/'))
          ? new Response(JSON.stringify({ error: 'Synthetic save error' }), { status: 400 }) : orig(u, o);
        await editarServings(p.id);
      });
      await page.locator('#bs-guardar').click();
      await page.waitForFunction(() => document.getElementById('bar-servings-line').innerText.includes('Synthetic save error'), null, { timeout: 5000 });
      assert.deepEqual(await page.evaluate(() => window.__alerts), []);
      // Network failure: same row, same text as before the change.
      await page.evaluate(() => { window.fetch = async () => { throw new Error('offline'); }; });
      await page.locator('#bs-guardar').click();
      await page.waitForFunction(() => document.getElementById('bar-servings-line').innerText.includes('Could not reach the server. Check your connection and try again.'), null, { timeout: 5000 });
      assert.deepEqual(await page.evaluate(() => window.__alerts), []);
    } finally { await web.close(); }
  });

  test(`payment plan: failure after the credit is shown inside the modal, no alert (${name}, ${lang})`, async () => {
    const { web, page } = await abrir(engine, lang);
    try {
      await page.evaluate(async () => {
        const c = await (await fetch('/api/clientes', { method: 'POST', body: JSON.stringify({ nombre: 'Synthetic plan customer' }) })).json();
        AMG.PlanPagos.crearPlan = () => Promise.reject(new Error('synthetic plan failure'));
        fiarCliente(c.id, 'Synthetic plan customer');
      });
      await page.locator('#pp-monto').fill('30');
      await page.locator('#pp-conplan').check();
      await page.locator('#pp-ok').click();
      await page.waitForFunction(() => { const m = document.getElementById('pp-msg'); return m && m.textContent.includes('The credit was recorded, but the payment plan could not be saved.') && m.textContent.includes('synthetic plan failure'); }, null, { timeout: 5000 });
      assert.deepEqual(await page.evaluate(() => window.__alerts), []);
      // The charge already went through: the button must stay locked so nobody records it twice.
      await new Promise((r) => setTimeout(r, 1300));
      assert.equal(await page.locator('#pp-ok').isDisabled(), true);
      const cargos = await page.evaluate(async () => (await AMG.Hechos.todos()).filter((h) => h.tipo === 'cartera_cargo').length);
      assert.equal(cargos, 1);
    } finally { await web.close(); }
  });
}

test('scope guard: only the three listed error alerts went away; backup, Advanced, perchas, marketing and bars untouched', () => {
  // src/app/app-inline-01.js had 9 alert() lines; 5412, 6513 and 6515 are gone, the other 6 stay (listed in the PR).
  assert.equal(count('src/app/app-inline-01.js'), 6);
  assert.equal(count('docs/plan-pagos-ui.js'), 0);
  assert.equal(count('docs/backup-scheduler.js'), 4);
  assert.equal(count('docs/avanzado-extra.js'), 17);
  assert.equal(count('docs/vista-perchas.js'), 9);
  const pp = fs.readFileSync(path.join(ROOT, 'docs/plan-pagos-ui.js'), 'utf8');
  assert.doesNotMatch(pp, /global\.alert\(/);
  const a = fs.readFileSync(path.join(ROOT, 'src/app/app-inline-01.js'), 'utf8');
  assert.match(a, /alert\(r\.error \|\| "Could not save the contact\."\)/);
  assert.match(a, /else alert\(_msgVarFail\)/);
});
