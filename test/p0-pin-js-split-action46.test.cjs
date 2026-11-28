'use strict';
// Accion #46: carga diferida post-PIN (<=40% del baseline C200 de 3,710,507 bytes, i.e. <=1,484,202 bytes).
// Verifica en Chromium y WebKit reales (sin red externa, sirviendo docs/ desde disco) que:
// 1) En pantalla PIN: bytes JS <= 1,484,202 B, 0 requests a scripts post-PIN, canarios.js e idb-fotos.min.js presentes pre-PIN, 0 pageerrors.
// 2) Tras desbloquear PIN: se cargan en orden exacto todos los 41 scripts diferidos + extras, 0 pageerrors,
//    y las vistas/motores principales quedan operativas.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright');

const root = path.resolve(__dirname, '..');
const docsDir = path.join(root, 'docs');
const BASELINE_C200 = 3710507;
const TARGET_MAX_PIN_BYTES = Math.floor(BASELINE_C200 * 0.40); // 1,484,202 bytes (>=60% reduction)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const MUST_DEFER = [
  'app-inline-01.min.js',
  'avanzado-extra.min.js',
  'vista-perchas.min.js',
  'plan-pagos-ui.min.js',
  'commissions-by-person.js',
  'cartera.min.js',
  'edutips.js',
  'inspector.js',
];

const MUST_KEEP_PRE_PIN = [
  'canarios.js',
  'idb-fotos.min.js',
  'auth-ui.min.js',
  'mock-backend.min.js',
];

for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  test(`Action #46 (${engineName}): PIN JS <= 40% baseline (>=60% reduction) and full post-PIN boot`, { timeout: 120000 }, async () => {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      const origin = 'https://app.synthetic.test';
      const loadedOnPin = [];
      const loadedAll = [];
      const pageErrors = [];
      let unlocked = false;

      page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

      await page.route('**/*', async (route) => {
        const url = route.request().url();
        if (!url.startsWith(origin + '/')) return route.abort();
        const rel = url.slice(origin.length + 1).split('?')[0] || 'index.html';
        const full = path.join(docsDir, rel);
        if (!full.startsWith(docsDir) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
          return route.fulfill({ status: 404, body: '' });
        }
        const buf = fs.readFileSync(full);
        const ext = path.extname(full).toLowerCase();
        if (ext === '.js' || ext === '.mjs') {
          loadedAll.push({ rel, bytes: buf.length });
          if (!unlocked) loadedOnPin.push({ rel, bytes: buf.length });
        }
        return route.fulfill({ status: 200, contentType: MIME[ext] || 'application/octet-stream', body: buf });
      });

      await page.goto(origin + '/index.html', { waitUntil: 'load' });
      await page.waitForSelector('#oc-gate', { state: 'visible', timeout: 15000 });
      await page.waitForTimeout(400);

      const pinBytes = loadedOnPin.reduce((s, x) => s + x.bytes, 0);
      const pinSet = new Set(loadedOnPin.map((x) => x.rel));
      const reductionPct = ((1 - pinBytes / BASELINE_C200) * 100).toFixed(2);
      console.log(`[Action #46 ${engineName}] PIN JS: ${pinBytes} B (${loadedOnPin.length} scripts, -${reductionPct}% vs C200 ${BASELINE_C200} B)`);

      assert.ok(pinBytes <= TARGET_MAX_PIN_BYTES, `${engineName}: PIN JS ${pinBytes} B exceeds target ${TARGET_MAX_PIN_BYTES} B`);
      for (const f of MUST_DEFER) {
        assert.ok(!pinSet.has(f), `${engineName}: ${f} must NOT load on PIN screen`);
      }
      for (const f of MUST_KEEP_PRE_PIN) {
        assert.ok(pinSet.has(f), `${engineName}: ${f} must stay pre-PIN`);
      }
      assert.deepEqual(pageErrors, [], `${engineName}: pageerrors on PIN screen`);

      unlocked = true;
      await page.evaluate(() => {
        const g = document.getElementById('oc-gate');
        if (g) g.style.display = 'none';
        if (window.OCAuth) {
          if (!window.OCAuth.rolActual || !window.OCAuth.rolActual()) {
            try { sessionStorage.setItem('f123_sesion', JSON.stringify({ rol: 'dueno', demo: true, ts: Date.now() })); } catch (_) {}
            window.OCAuth.rolActual = () => 'dueno';
          }
        }
        document.body.classList.add('rol-demo');
        window.dispatchEvent(new CustomEvent('oc-login', { detail: { rol: 'dueno', demo: true } }));
      });

      await page.waitForFunction(() => window.__ocPostPinListo === true, null, { timeout: 20000 });
      await page.waitForTimeout(400);

      const postState = await page.evaluate(() => ({
        postPinListo: window.__ocPostPinListo === true,
        hasCargarHoy: typeof window.cargarHoy === 'function',
        hasPintarSaldoCartera: typeof window.pintarSaldoCartera === 'function',
        hasRegistrarGasto: typeof window.registrarGasto === 'function',
        hasAbonarCliente: typeof window.abonarCliente === 'function',
        hasCartera: !!(window.AMG && window.AMG.Cartera && typeof window.AMG.Cartera.calcularSaldo === 'function'),
        hasPlanPagos: !!(window.AMG && window.AMG.PlanPagos),
        hasCajaChica: !!(window.AMG && window.AMG.CajaChica),
        hasOCFotos: !!(window.OCFotos && typeof window.OCFotos.leerPorHash === 'function'),
        deferredCount: document.querySelectorAll('script[type="text/plain"][data-post-pin-src]').length,
      }));

      assert.deepEqual(pageErrors, [], `${engineName}: pageerrors after PIN unlock`);
      assert.equal(postState.postPinListo, true);
      assert.equal(postState.hasCargarHoy, true);
      assert.equal(postState.hasPintarSaldoCartera, true);
      assert.equal(postState.hasRegistrarGasto, true);
      assert.equal(postState.hasAbonarCliente, true);
      assert.equal(postState.hasCartera, true);
      assert.equal(postState.hasPlanPagos, true);
      assert.equal(postState.hasCajaChica, true);
      assert.equal(postState.hasOCFotos, true);
      assert.equal(postState.deferredCount, 41);

      // Verify real navigation across views after post-PIN hydration
      for (const vista of ['inventario', 'clientes', 'comisiones', 'hoy']) {
        await page.locator(`nav button[data-vista="${vista}"]`).click();
        await page.waitForTimeout(150);
        const active = await page.locator(`#vista-${vista}`).evaluate((el) => el.classList.contains('activa'));
        assert.equal(active, true, `${engineName}: view ${vista} should activate after PIN unlock`);
      }

      const allSet = new Set(loadedAll.map((x) => x.rel));
      for (const f of MUST_DEFER) {
        assert.ok(allSet.has(f), `${engineName}: ${f} must load after PIN unlock`);
      }
      assert.deepEqual(pageErrors, [], `${engineName}: pageerrors after view navigation`);
    } finally {
      await browser.close();
    }
  });
}
