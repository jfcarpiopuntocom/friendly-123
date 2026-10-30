#!/usr/bin/env node
// recorrido-vivo.cjs (Oct14fixes 4, JFC 2026-10-14: "dejemos de sentir que Belen encuentra
// los problemas por nosotros"). Recorre la app VIVA como un cliente nuevo, SOLO LECTURA:
// no entra con PIN, no crea licencias, no toca cuadernos. Falla (exit 1) si:
//  - la app o el tablero lanzan errores de JavaScript al abrir (Chromium y WebKit/iPhone);
//  - el tablero no muestra la version publicada (caso "Dashboard v498" del 14 oct);
//  - algun archivo del shell servido no cuadra con su SHA-256 del manifiesto.
// Uso: node scripts/recorrido-vivo.cjs [baseUrl]   (por defecto https://jfcarpiopuntocom.github.io/friendly-123/)
const { chromium, webkit, devices } = require('playwright');
const crypto = require('node:crypto');
const BASE = (process.argv[2] || 'https://jfcarpiopuntocom.github.io/friendly-123/').replace(/\/?$/, '/');
const fallas = [];
const mal = (m) => { fallas.push(m); console.log('FALLA ' + m); };

// Distinguish an intermittent Pages CDN 502/503/504 from a persistent outage.
// NEVER retry a bad SHA-256, 404, or JavaScript error; each file still must match.
const intermitentes = [];
async function bajar(rel) {
  for (let intento = 0; intento < 3; intento++) {
    const r = await fetch(BASE + rel + (rel.includes('?') ? '&' : '?') + 'r=' + Date.now() + '-' + intento, { cache: 'no-store' });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    if (![502, 503, 504].includes(r.status) || intento === 2)
      throw new Error(rel + ' HTTP ' + r.status + ' (intentos ' + (intento + 1) + ')');
    intermitentes.push({ rel, status: r.status });
    console.log('AVISO transitorio ' + rel + ' HTTP ' + r.status + '; reintentando solo este recurso');
    await new Promise(resolve => setTimeout(resolve, 200 * (intento + 1)));
  }
  throw new Error(rel + ' no se pudo descargar');
}

async function recorrer(nombre, engine, opciones) {
  const browser = await engine.launch({ headless: true });
  try {
    const ctx = await browser.newContext(opciones);
    for (const pagina of ['', 'dashboard.html']) {
      const page = await ctx.newPage();
      const errores = [];
      page.on('pageerror', (e) => errores.push(String(e && e.message || e)));
      await page.goto(BASE + pagina, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(4000);
      // ResizeObserver es ruido conocido del navegador, no un fallo de la app.
      const reales = errores.filter((e) => !/ResizeObserver loop/.test(e));
      if (reales.length) mal(`${nombre} ${pagina || 'app'}: ${reales.length} error(es) JS: ${reales.slice(0, 3).join(' | ')}`);
      if (pagina === 'dashboard.html') {
        const etiqueta = await page.locator('#dashboard-version').textContent().catch(() => '');
        recorrer.etiquetas.push(`${nombre}: ${etiqueta}`);
        if (!etiqueta.includes(recorrer.release)) mal(`${nombre} tablero dice "${etiqueta}" y la version publicada es ${recorrer.release}`);
      }
      await page.close();
    }
  } finally { await browser.close(); }
}
recorrer.etiquetas = [];

(async () => {
  const version = JSON.parse((await bajar('version.json')).toString('utf8'));
  recorrer.release = String(version.releaseName || version.shell.replace(/^f123-shell-/, ''));
  console.log(`Publicado: ${version.shell} (${version.releaseName}) en ${BASE}`);
  const manifiesto = JSON.parse((await bajar('version-manifest.json')).toString('utf8'));
  const archivos = manifiesto.archivos || manifiesto.files || {};
  let ok = 0;
  for (const [rel, esperado] of Object.entries(archivos)) {
    const hash = String(typeof esperado === 'object' ? (esperado.sha256 || esperado.hash) : esperado).replace(/^sha256-/, '');
    try {
      const real = crypto.createHash('sha256').update(await bajar(rel.replace(/^\.\//, ''))).digest('hex');
      if (real !== hash) mal(`archivo ${rel}: SHA-256 servido no cuadra con el manifiesto`); else ok++;
    } catch (e) { mal(`archivo ${rel}: ${e.message}`); }
  }
  console.log(`Manifiesto: ${ok}/${Object.keys(archivos).length} archivos cuadran`);
  if (intermitentes.length) console.log(`AVISO: ${intermitentes.length} respuesta(s) 502/503/504 transitoria(s), con reintentos limitados; no se ocultan errores persistentes.`);
  await recorrer('Chromium escritorio', chromium, { viewport: { width: 1280, height: 800 } });
  await recorrer('Safari iPhone', webkit, { ...devices['iPhone 13'] });
  console.log(recorrer.etiquetas.join('\n'));
  if (fallas.length) { console.log(`\n${fallas.length} falla(s). La app viva tiene un problema que un cliente veria.`); process.exit(1); }
  console.log('\nRecorrido limpio.');
})().catch((e) => { console.log('FALLA del recorrido: ' + e.message); process.exit(1); });
