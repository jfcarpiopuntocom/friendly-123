// Inventario REAL de controles visibles por rol e idioma (contrato de UI, Tarea 2).
// Uso: node scripts/ui-inventory.cjs  -> release/ui-inventory/<rol>.<lang>.json
// Datos ficticios (fixture), login real por PIN, idioma por el boton EN/ES real
// (.oc-lang-btn -> OCI18n.setLang; no recarga la pagina, el login se conserva).
// Una pestana que el rol no ve (boton de nav oculto) queda con controls: [].
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { openApp, seedScenario } = require('../test/fixtures/ui-contract-scenario.cjs');
const { loginAs } = require('../test/helpers/ui-contract-login.cjs');

const ROLES = ['dueno', 'admin', 'empleado', 'contador'];
const LANGS = ['en', 'es'];
const OUT = path.resolve(__dirname, '../release/ui-inventory');
const commit = execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim();

// Dentro de la pagina: lista de controles visibles de la vista activa.
const leer = () => {
  const vis = (e) => { const s = getComputedStyle(e); const q = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && q.width > 0 && q.height > 0; };
  const v = [...document.querySelectorAll('[id^="vista-"]')].find(vis);
  if (!v) return [];
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 90);
  return [...v.querySelectorAll('button,a[href],input,select,textarea,summary,[onclick],[role=button]')].filter(vis).map((e) => {
    const cs = getComputedStyle(e);
    return {
      tag: e.tagName.toLowerCase(), id: e.id || '',
      dataAttrs: [...e.attributes].filter((a) => a.name.startsWith('data-')).map((a) => a.name),
      text: clean(e.innerText || e.getAttribute('aria-label') || e.placeholder || e.value || e.title),
      fontSize: cs.fontSize, color: cs.color,
    };
  });
};
// Montos de dinero -> $X para que los archivos sean estables entre corridas.
// Ids con uid aleatorio (u + 32 hex) -> uX, por la misma razon.
const norm = (c) => ({ ...c, id: c.id.replace(/u[0-9a-f]{32}/g, 'uX'), text: c.text.replace(/-?\$\s?[\d.,]+/g, '$X').replace(/u[0-9a-f]{32}/g, 'uX') });

async function crawl(page) {
  const navs = await page.$$eval('nav button', (bs) => bs.map((b, i) => ({ i, vista: b.dataset.vista || '', text: (b.textContent || '').replace(/\s+/g, ' ').trim(),
    visible: (() => { const s = getComputedStyle(b); const q = b.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && q.width > 0 && q.height > 0; })() })));
  const screens = [];
  for (const n of navs) {
    const screen = n.text || n.vista;
    if (!screen) continue;
    if (!n.visible) { screens.push({ screen, view: null, controls: [] }); continue; }
    await page.evaluate((i) => document.querySelectorAll('nav button')[i].click(), n.i);
    await page.waitForTimeout(900);
    screens.push({ screen, view: null, controls: (await page.evaluate(leer)).map(norm) });
    const views = await page.$$eval('[data-commissions-view]', (bs) => bs.filter((b) => { const q = b.getBoundingClientRect(); return q.width > 0 && q.height > 0; }).map((b) => b.dataset.commissionsView));
    for (const v of [...new Set(views)]) {
      await page.evaluate((x) => { const b = document.querySelector('[data-commissions-view="' + x + '"]'); b && b.click(); }, v);
      await page.waitForTimeout(700);
      screens.push({ screen, view: v, controls: (await page.evaluate(leer)).map(norm) });
    }
  }
  return screens;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  for (const lang of LANGS) {
    for (const rol of ROLES) {
      const page = await openApp(browser, { locale: lang === 'es' ? 'es-EC' : 'en-US' });
      await seedScenario(page);
      await loginAs(page, rol);
      // Idioma por el boton real del encabezado (o de la pantalla de PIN).
      await page.evaluate((l) => { const b = document.querySelector('.oc-lang-btn[data-lang="' + l + '"]'); if (b) b.click(); else window.OCI18n.setLang(l); }, lang);
      await page.waitForFunction((l) => window.OCI18n.getLang() === l, lang);
      await page.waitForTimeout(800);
      const screens = await crawl(page);
      fs.writeFileSync(path.join(OUT, rol + '.' + lang + '.json'), JSON.stringify({ rol, lang, commit, screens }, null, 2) + '\n');
      const tot = screens.reduce((a, s) => a + s.controls.length, 0);
      console.log(rol, lang, 'total', tot, screens.map((s) => s.screen + (s.view ? '/' + s.view : '') + '=' + s.controls.length).join(' | '));
      await page.close();
    }
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
