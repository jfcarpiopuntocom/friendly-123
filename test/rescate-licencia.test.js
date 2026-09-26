// Rescate automatico de licencia (JFC 2026-09-25, caso Belen). JFC le pone la licencia a un
// aparato SIN licencia desde su panel; el Worker la devuelve en el latido y el aparato la
// adopta solo (se recarga una vez). Antes la app la ignoraba: rojo en v406. El Worker se
// simula con una URL de prueba; ningun pedido sale a produccion.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

async function latidoCon(licLocal) {
  const b = await chromium.launch();
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  try {
    await p.route('https://licencias.prueba.invalid/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"estado":"full","licenseCode":"F123-RESC-ATEX-PRUE-BA000"}' }));
    await p.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'networkidle' });
    await p.evaluate((lic) => {
      localStorage.setItem('f123_cf_worker_url', 'https://licencias.prueba.invalid');
      localStorage.setItem('f123_owned', JSON.stringify({ instanceId: 'inst-rescate-1', licenseCode: lic }));
      window.OCAuth.heartbeat({ instanceId: 'inst-rescate-1', licenseCode: '', accion: 'login' }).catch(() => {});
    }, licLocal);
    await new Promise((r) => setTimeout(r, 5000)); // incluye la recarga unica del rescate
    return await p.evaluate(() => JSON.parse(localStorage.getItem('f123_owned') || '{}').licenseCode || '');
  } finally { await b.close(); }
}

test('aparato SIN licencia adopta la que JFC le puso desde el panel', async () => {
  assert.equal(await latidoCon(''), 'F123-RESC-ATEX-PRUE-BA000');
});

test('aparato CON licencia nunca la cambia por lo que diga el latido (FIJACION)', async () => {
  assert.equal(await latidoCon('F123-PROP-IAXX-XXXX-XXXXX'), 'F123-PROP-IAXX-XXXX-XXXXX');
});
