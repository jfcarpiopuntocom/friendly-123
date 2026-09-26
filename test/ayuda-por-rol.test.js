// Ayuda (?) por rol y en el orden del uso real (JFC 2026-09-26). Rojo en v415:
// el contador y el artista veian la guia del dueno, el ingles decia "2 years" (la licencia
// es de 5), el amarillo se llamaba "Gold", el manual salia dos veces en espanol y la marca
// decia "Made in Cuenca :apps y herramientas:".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');

async function textoAyuda(pares) {
  const web = await chromium.launch({ headless: true });
  try {
    const page = await web.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'networkidle' });
    const out = {};
    for (const [rol, lang] of pares) {
      out[rol + ':' + lang] = await page.evaluate(([rol, lang]) => {
        if (window.OCI18n && window.OCI18n.setLang) window.OCI18n.setLang(lang);
        window.OCAuth.rolActual = () => rol; window.OCHelp.abrir();
        const b = document.getElementById('oc-help-body');
        return { txt: b.textContent + '\n' + document.getElementById('oc-help-credito').textContent, html: b.innerHTML }; // textContent: incluye lo plegado en <details>
      }, [rol, lang]);
    }
    return out;
  } finally { await web.close(); }
}

test('each role gets its own guide, daily steps first', async () => {
  const r = await textoAyuda([['dueno', 'en'], ['empleado', 'es'], ['contador', 'en'], ['artista', 'es']]);
  assert.match(r['dueno:en'].txt, /Owner's guide[\s\S]*Every day, in this order[\s\S]*What the colors mean/);
  assert.match(r['empleado:es'].txt, /Guía del encargado\/a[\s\S]*Tu turno, en este orden/);
  assert.match(r['contador:en'].txt, /Bookkeeper guide/);
  assert.doesNotMatch(r['contador:en'].txt, /Every day, in this order/, 'the bookkeeper does not get the owner guide');
  assert.match(r['artista:es'].txt, /Guía del artista/);
});

test('true facts, app names and the exact brand', async () => {
  const r = await textoAyuda([['dueno', 'en'], ['dueno', 'es']]);
  for (const k of ['dueno:en', 'dueno:es']) {
    assert.doesNotMatch(r[k].txt, /2 years|Gold|Dorado/);
    assert.match(r[k].txt, /5 (years|años)/);
    assert.match(r[k].txt, /Made In Cuenca: intuitive business apps/);
    assert.equal((r[k].html.match(/manual\.html/g) || []).length, 1, 'one manual link');
  }
});

test('no light colored text in the guide (legibility)', () => {
  const s = fs.readFileSync(path.join(__dirname, '../docs/help-ui.js'), 'utf8');
  assert.doesNotMatch(s, /<b style="color:#(00C87A|E8A020|F97316|E8365D|5294AC)/);
  assert.doesNotMatch(s, /id="oc-help-tagline"[^>]*color:#E8A020/);
});
