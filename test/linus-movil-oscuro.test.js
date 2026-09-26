// Revision nivel Linus, Bloque 5 (JFC 2026-09-26): telefono con modo OSCURO del sistema (lo que
// hace iOS/WhatsApp). Cada seccion del nav, como dueno: todo texto visible debe tener (1) al menos
// 12px, (2) opacidad efectiva 1 (ni el ni sus contenedores), (3) contraste >= 4.5 contra el fondo
// real que tiene detras (primer ancestro con fondo solido). Regla dura de JFC: nada de texto gris,
// chico u opaco. Lista de fallos con seccion, texto y medida, para arreglar uno por uno.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const URL_APP = pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href;

async function auditar(page) {
  return page.evaluate(() => {
    const rgb = (s) => { const m = String(s).match(/[\d.]+/g); return m ? m.map(Number) : null; };
    const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const fondo = (el) => {
      for (let e = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; // degradado/imagen: no medible aqui
        const c = rgb(cs.backgroundColor);
        if (c && (c.length < 4 || c[3] >= 0.99)) return c.slice(0, 3);
      }
      return [255, 255, 255];
    };
    const fallos = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const vistos = new Set();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const txt = n.textContent.trim();
      if (!txt || txt.length < 2) continue;
      const el = n.parentElement;
      if (!el || vistos.has(el)) continue;
      vistos.add(el);
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || el.closest('[hidden],[aria-hidden="true"],script,style,template,option')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      let visible = true, op = 1;
      for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e); if (c.display === 'none') { visible = false; break; } op *= Number(c.opacity); }
      if (!visible || op === 0) continue;
      const corto = txt.slice(0, 40);
      const fs = parseFloat(cs.fontSize);
      if (fs < 12) fallos.push(`chico ${fs}px: "${corto}"`);
      if (op < 0.99) fallos.push(`opacidad ${op.toFixed(2)}: "${corto}"`);
      const fg = rgb(cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color ? cs.webkitTextFillColor : cs.color);
      const bg = fondo(el);
      if (fg && bg) {
        const [a, b] = [lum(fg.slice(0, 3)), lum(bg)].sort((x, y) => y - x);
        const k = (a + 0.05) / (b + 0.05);
        if (k < 4.5) fallos.push(`contraste ${k.toFixed(2)} (${cs.color} sobre rgb(${bg})): "${corto}"`);
      }
    }
    return fallos;
  });
}

test('Bloque 5: telefono en modo oscuro, cada seccion legible (>=12px, sin opacidad, contraste >= 4.5)', async () => {
  const web = await chromium.launch({ headless: true });
  try {
    const ctx = await web.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(URL_APP, { waitUntil: 'networkidle' });
    await page.evaluate(() => { sessionStorage.setItem('f123_sesion', JSON.stringify({ rol: 'dueno' })); localStorage.setItem('f123_resumen_semanal_ofrecido', String(Date.now())); });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const vistas = await page.evaluate(() => [...new Set([...document.querySelectorAll('nav button[data-vista]')].map((b) => b.dataset.vista))]);
    const todos = [];
    for (const v of vistas) {
      await page.evaluate((v) => document.querySelector(`nav button[data-vista="${v}"]`).click(), v);
      await page.waitForTimeout(1200);
      for (const f of await auditar(page)) todos.push(v + ': ' + f);
    }
    const unicos = [...new Set(todos)];
    assert.deepEqual(unicos, [], unicos.length + ' fallos:\n' + unicos.join('\n'));
  } finally { await web.close(); }
});
