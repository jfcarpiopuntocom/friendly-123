// JUECES EXTERNOS DEL SONAR (JFC 2026-09-26: "quiero que uses librerias externas mundiales para
// que nunca vuelvan a pasar estancamientos ... la UI bloated ... todo va al Sonar").
// Recorre la app como dueno en telefono, tablet y PC, y en cada pantalla corre:
//   - axe-core (Deque): fallas de accesibilidad por gravedad;
//   - captura PNG;
//   - AIRE: % del alto de la pantalla gastado antes del primer dato con dinero ($).
// Ademas Lighthouse (Google) sobre la app si esta disponible (CI).
// Resultado: out-jueces/resultado.json + out-jueces/*.png. El Sonar del panel lo lee.
// Rojo: axe critical/serious > 0, aire en telefono > 45 %, accesibilidad Lighthouse < 90.
// Uso local: node scripts/jueces.mjs  (sin red de produccion: bloquea workers.dev).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

const DOCS = path.resolve('docs');
const OUT = path.resolve('out-jueces');
fs.mkdirSync(OUT, { recursive: true });
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/') u = '/index.html';
  const f = path.join(DOCS, u);
  if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${srv.address().port}/`;

const VISTAS = [['hoy', 'Today'], ['escanear', 'Sell · Sold'], ['inventario', 'Inventory'], ['perchas', 'Racks'], ['clientes', 'Customers'], ['comisiones', 'Commissions'], ['gastos', 'Expenses'], ['etiquetas', 'Labels'], ['avanzado', 'Advanced']];
const TAMANOS = [['telefono', 390, 844], ['tablet', 820, 1180], ['pc', 1366, 900]];
const res = { fecha: new Date().toISOString(), sha: process.env.GITHUB_SHA || '', axe: {}, aire: {}, capturas: [], lighthouse: null, motivos: [] };

const nav = await chromium.launch();
try {
  for (const [tam, w, h] of TAMANOS) {
    const ctx = await nav.newContext({ viewport: { width: w, height: h } });
    await ctx.route(/workers\.dev|jfcarpio\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => sessionStorage.setItem('f123_sesion', JSON.stringify({ rol: 'dueno' })));
    await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(2500);
    for (const [v, nombre] of VISTAS) {
      await page.evaluate((x) => { const b = document.querySelector(`nav button[data-vista="${x}"]`); if (b) b.click(); scrollTo(0, 0); }, v);
      await page.waitForTimeout(1500);
      if (v === 'escanear') { await page.evaluate(() => { const d = document.getElementById('ventasSold'); if (d) d.open = true; }); await page.waitForTimeout(1200); }
      const archivo = `${v}-${tam}.png`;
      await page.screenshot({ path: path.join(OUT, archivo) });
      res.capturas.push({ vista: v, nombre, tam, archivo });
      if (tam === 'telefono') {
        // AIRE: primer elemento visible dentro de la vista cuyo texto propio tenga dinero.
        res.aire[v] = await page.evaluate((x) => {
          const vista = document.getElementById('vista-' + x); if (!vista) return null;
          const tope = vista.getBoundingClientRect().top;
          let y = null;
          for (const el of vista.querySelectorAll('*')) {
            const propio = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
            if (!/\$\s?\d/.test(propio)) continue;
            const r = el.getBoundingClientRect(); if (r.height === 0 || r.width === 0) continue;
            y = r.top; break;
          }
          // Tambien cuenta como dato la primera tarjeta de una grilla de productos.
          const card = vista.querySelector('#gridVender > *, #gridInventario > *');
          if (card) { const rc = card.getBoundingClientRect(); if (rc.height > 0 && (y === null || rc.top < y)) y = rc.top; }
          return y === null ? null : Math.round(((y - Math.max(0, tope)) / innerHeight) * 100);
        }, v);
        const axe = await new AxeBuilder({ page }).include('#vista-' + v).analyze();
        const cuenta = { critical: 0, serious: 0, moderate: 0, minor: 0 };
        axe.violations.forEach((x) => { cuenta[x.impact] = (cuenta[x.impact] || 0) + x.nodes.length; });
        res.axe[v] = Object.assign(cuenta, { reglas: axe.violations.map((x) => x.id + ' (' + x.impact + ', ' + x.nodes.length + ')') });
      }
    }
    await ctx.close();
  }
} finally { await nav.close(); }

// Lighthouse (Google): solo si esta instalado (en CI se instala; local es opcional).
try {
  const chrome = chromium.executablePath();
  const lhOut = path.join(OUT, 'lighthouse.json');
  execSync(`npx --no-install lighthouse ${BASE} --quiet --output=json --output-path="${lhOut}" --only-categories=performance,accessibility,best-practices,seo --chrome-flags="--headless=new --no-sandbox"`, { stdio: 'ignore', env: Object.assign({}, process.env, { CHROME_PATH: chrome }), timeout: 180000 });
  const lh = JSON.parse(fs.readFileSync(lhOut, 'utf8'));
  res.lighthouse = Object.fromEntries(Object.entries(lh.categories).map(([k, c]) => [k, Math.round(c.score * 100)]));
  fs.unlinkSync(lhOut);
} catch (_) { res.lighthouse = null; }
srv.close();

for (const [v] of VISTAS) {
  const a = res.axe[v] || {};
  if ((a.critical || 0) + (a.serious || 0) > 0) res.motivos.push(`axe ${v}: ${a.critical || 0} criticas, ${a.serious || 0} graves`);
  // Advanced es configuracion, no datos del negocio: no entra en la regla de aire.
  if (v !== 'avanzado' && res.aire[v] !== null && res.aire[v] > 45) res.motivos.push(`aire ${v}: ${res.aire[v]}% de la pantalla antes del primer dato`);
}
if (res.lighthouse && res.lighthouse.accessibility < 90) res.motivos.push(`Lighthouse accesibilidad ${res.lighthouse.accessibility}`);
res.rojo = res.motivos.length > 0;
fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify({ rojo: res.rojo, motivos: res.motivos, aire: res.aire, lighthouse: res.lighthouse, axe: Object.fromEntries(Object.entries(res.axe).map(([k, x]) => [k, x.reglas])) }, null, 1));
