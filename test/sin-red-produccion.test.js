// Guarda: ningun navegador de prueba puede hablar con el Worker de produccion (ver
// test/helpers/sin-red-produccion.cjs). Si esta prueba falla, las pruebas estan
// escribiendo en el panel privado de JFC.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
test('los navegadores de prueba no llegan al Worker de produccion', async () => {
  const b = await chromium.launch({ headless: true });
  try {
    const p = await b.newPage();
    await p.goto('about:blank');
    const r = await p.evaluate(async () => { try { await fetch('https://friendly123-licencias.jfcarpio.workers.dev/canario/orden'); return 'LLEGO'; } catch (_) { return 'bloqueado'; } });
    assert.equal(r, 'bloqueado');
  } finally { await b.close(); }
});
