// JFC 2026-09-30 (v430): "que el scroll de dineros NO sea por centavos sino por dolares, es muy lento".
// Ningun campo de DINERO usa step="0.01" (flechas/rueda de a centavo). step="any" sube de a $1 y deja
// escribir centavos. Los % (pct-asociado) quedan fuera a proposito.
// Y "Sales log" va ENCIMA de "Day close" en Sold. Rojas contra el shell v429.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const leer = (f) => fs.readFileSync(path.resolve(__dirname, '../docs', f), 'utf8');

test('no money input steps by cents', () => {
  for (const f of ['index.html', 'dashboard.html', 'panel.html', 'plan-pagos-ui.js', 'artista.js']) {
    const malos = (leer(f).match(/<input[^>]*step="0\.01"[^>]*>/g) || []).filter((t) => !/pct/.test(t));
    assert.deepEqual(malos, [], f);
    assert.doesNotMatch(leer(f), /step: "0\.01"/, f);
  }
});

test('Sold: Sales log comes before Day close', () => {
  const h = leer('index.html');
  assert.ok(h.indexOf('id="ventasSold"') < h.indexOf('id="cierreDia"'));
});

test('Sold: Sales log is real markup, not swallowed by an unclosed comment', () => {
  const h = leer('index.html').replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(h.includes('id="ventasSold"') && h.includes('id="cierreDia"'));
});
