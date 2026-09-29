// COLA DEL SYNC SIN ESPACIO (JFC 2026-09-29; portado de un archivo que Codex dejo sin subir).
// Bug: guardarCola() tragaba el error de localStorage lleno: la op de stock no
// quedaba en la cola y OCSyncEmit no lo decia. Ahora encolar() devuelve si guardo
// y OCSyncEmit devuelve false cuando la op no pudo quedar pendiente.
// Roja en v421 (OCSyncEmit devolvia undefined).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

test('queue full: OCSyncEmit reports false instead of losing the op silently', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage();
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'domcontentloaded' });
    const r = await page.evaluate(() => {
      localStorage.setItem('f123_sync_room', JSON.stringify({ codigo: ['F123', 'PRUEBA', 'COLA', 'LLENA'].join('-') }));
      const ok = window.OCSyncEmit('venta', { productoId: 'p-x', delta: -1 });
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (String(k).indexOf('cola') >= 0) throw new Error('QuotaExceededError'); return orig.call(this, k, v); };
      let lleno;
      try { lleno = window.OCSyncEmit('venta', { productoId: 'p-x', delta: -1 }); } finally { Storage.prototype.setItem = orig; }
      return { ok, lleno };
    });
    assert.equal(r.ok, true, 'a queued op reports true');
    assert.equal(r.lleno, false, 'an op that could not be queued reports false');
  } finally { await web.close(); }
});
