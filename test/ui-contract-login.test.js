// Login REAL por PIN para cada rol, en Chromium y WebKit (iPhone de Belen).
// Nunca se fuerza OCAuth.rolActual: el rol sale del flujo real de auth-ui.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const { openApp, seedScenario } = require('./fixtures/ui-contract-scenario.cjs');
const { loginAs } = require('./helpers/ui-contract-login.cjs');

for (const [motor, tipo] of [['chromium', chromium], ['webkit', webkit]]) {
  for (const rol of ['dueno', 'admin', 'empleado', 'contador']) {
    test(`[${motor}] login real por PIN entra como ${rol}`, async () => {
      const web = await tipo.launch({ headless: true });
      try {
        const page = await openApp(web, { locale: 'en-US' });
        await seedScenario(page);
        await loginAs(page, rol);
        const visto = await page.evaluate(() => window.OCAuth.rolActual());
        assert.equal(visto, rol);
      } finally { await web.close(); }
    });
  }
}
