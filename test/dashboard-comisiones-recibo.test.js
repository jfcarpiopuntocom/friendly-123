/* v423 (JFC 2026-09-29, "carinito" a Commissions). Bug real: el recibo imprimible de un MES PASADO
   copiaba las devoluciones del mes ACTUAL (la liquidacion viva), y ningun recibo descontaba esas
   devoluciones del total. Rojo contra el shell v422; verde con el arreglo. Tambien fija la barra
   "a donde va cada dolar" (asociado vs casa) y la barra por tarjeta. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const fx = require('./helpers/dashboard-comisiones-fixture.cjs');

async function recibo(page, mes) {
  return page.evaluate(({ d, mes }) => {
    let html = '';
    window.open = () => ({ document: { open() {}, write(h) { html += h; }, close() {} }, focus() {}, print() {} });
    window.OCDashComisiones.pintarConDatos(d);
    const sel = document.getElementById('cm-mes'); sel.value = mes; sel.dispatchEvent(new Event('change'));
    document.querySelector('[data-cm-vista="percha"]').click();
    const b = document.querySelector('[data-cm-recibo="u1"]'); if (!b) return null;
    b.click();
    return html;
  }, { d: fx.datos, mes });
}

test('commission receipt: a past month never carries this month\'s returns; this month shows the net', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/dashboard.html')).href, { waitUntil: 'load' });
    const pasado = await recibo(page, fx.prev);
    assert.ok(pasado, 'the past month has a receipt button for the rack');
    assert.doesNotMatch(pasado, /Returns of already-paid sales/, 'past-month receipt must not list the current month returns');
    assert.doesNotMatch(pasado, /broken frame/);
    assert.match(pasado, /Artist consignment/, 'header still names the rack');
    const actual = await recibo(page, fx.mes);
    assert.match(actual, /Returns of already-paid sales/);
    assert.match(actual, /Net after returns/, 'current receipt nets the returns');
    assert.match(actual, /\$42\.50/);
  } finally { await web.close(); }
});

test('commission share bar: associates vs house, by value, with text labels (not color alone)', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/dashboard.html')).href, { waitUntil: 'load' });
    const r = await page.evaluate((d) => {
      window.OCDashComisiones.pintarConDatos(d);
      const bar = document.querySelector('#cm .cm-reparto');
      const seg = bar ? [...bar.querySelectorAll('.cm-barra i')].map(i => i.style.width) : [];
      return { txt: bar ? bar.innerText : '', seg, cards: document.querySelectorAll('#cm .cm-card .cm-barra').length, over: document.documentElement.scrollWidth > innerWidth };
    }, fx.datos);
    assert.equal(r.seg.length, 2, 'two segments');
    assert.match(r.txt, /Associates/); assert.match(r.txt, /House/); assert.match(r.txt, /%/);
    assert.ok(r.cards >= 2, 'each commissioned card carries its own bar');
    assert.equal(r.over, false, 'no horizontal overflow on a phone');
  } finally { await web.close(); }
});

test('by product / SKU: each card says what percentage the associate actually took (products can have their own)', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/dashboard.html')).href, { waitUntil: 'load' });
    const txt = await page.evaluate((d) => { window.OCDashComisiones.pintarConDatos(d); return document.getElementById('cm').innerText; }, fx.datos);
    assert.match(txt, /85% to the associate/, 'Mountain print: 42.50 of 50 twice = 85%');
    assert.match(txt, /10% to the associate/, 'Tote bag: 2 of 20 = 10%');
  } finally { await web.close(); }
});
