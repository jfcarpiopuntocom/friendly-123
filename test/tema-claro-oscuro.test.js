// Tema claro/oscuro (JFC 2026-09-26): boton sol/luna en el header (en el espacio que
// ocupaba la palabra del estado de sync en el telefono) y fila "Appearance" en Advanced.
// Por defecto CLARO (como antes). La eleccion es por aparato y se aplica antes de pintar.
// Escritas antes del codigo: rojas en v412.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const URL = pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href;

async function conPagina(fn, viewport = { width: 390, height: 844 }) {
  const web = await chromium.launch({ headless: true });
  try {
    const ctx = await web.newContext({ viewport });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'networkidle' });
    return await fn(page);
  } finally { await web.close(); }
}

test('1. default is light; the header toggle switches to dark and back', async () => {
  const r = await conPagina(async (page) => {
    // El header (Ayuda, estado, sol/luna) se monta junto al boton de salir al iniciar sesion: se simulan los dos.
    await page.evaluate(() => (() => { if (!document.getElementById('oc-logout')) { const b = document.createElement('button'); b.id = 'oc-logout'; (document.querySelector('header') || document.body).appendChild(b); } window.dispatchEvent(new Event('oc-login')); })());
    const antes = await page.evaluate(() => document.documentElement.getAttribute('data-tema'));
    const hay = await page.evaluate(() => !!document.getElementById('oc-tema-toggle'));
    await page.evaluate(() => document.getElementById('oc-tema-toggle').click());
    const oscuro = await page.evaluate(() => [document.documentElement.getAttribute('data-tema'), document.getElementById('oc-tema-toggle').getAttribute('aria-pressed')]);
    await page.evaluate(() => document.getElementById('oc-tema-toggle').click());
    const claro = await page.evaluate(() => document.documentElement.getAttribute('data-tema'));
    return { antes, hay, oscuro, claro };
  });
  assert.equal(r.antes, null, 'light by default, as before');
  assert.ok(r.hay, 'header has the sun/moon toggle');
  assert.deepEqual(r.oscuro, ['oscuro', 'true']);
  assert.equal(r.claro, null);
});

test('2. the choice survives a reload and is applied before first paint', async () => {
  const r = await conPagina(async (page) => {
    await page.evaluate(() => window.OCTema.poner('oscuro'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    return page.evaluate(() => document.documentElement.getAttribute('data-tema'));
  });
  assert.equal(r, 'oscuro');
});

test('3. Advanced has an Appearance control with Light and Dark', async () => {
  const r = await conPagina(async (page) => page.evaluate(() => {
    const sel = document.getElementById('selectTema');
    if (!sel) return null;
    sel.value = 'oscuro'; sel.dispatchEvent(new Event('change'));
    return { opciones: [...sel.options].map((o) => o.value), tema: document.documentElement.getAttribute('data-tema') };
  }));
  assert.ok(r, 'Advanced has #selectTema');
  assert.deepEqual(r.opciones, ['claro', 'oscuro']);
  assert.equal(r.tema, 'oscuro');
});

test('4. phone header: sync status keeps its dot and its words for screen readers', async () => {
  const r = await conPagina(async (page) => page.evaluate(() => {
    (() => { if (!document.getElementById('oc-logout')) { const b = document.createElement('button'); b.id = 'oc-logout'; (document.querySelector('header') || document.body).appendChild(b); } window.dispatchEvent(new Event('oc-login')); })();
    const m = document.getElementById('oc-sync-mini');
    const txt = m && m.querySelector('.oc-sync-txt');
    return { hay: !!m, label: m && m.getAttribute('aria-label'), txtVisible: txt ? getComputedStyle(txt).display !== 'none' : null };
  }));
  assert.ok(r.hay);
  assert.ok(r.label && r.label.length > 2, 'status still announced');
  assert.equal(r.txtVisible, false, 'the word no longer takes header space on a phone');
});
