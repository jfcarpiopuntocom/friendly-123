// Oct14fixes 6 (JFC 2026-10-14): "en la splash cambia la tipografia, A-B-A-B". Las letras viven
// en docs/fonts, sin Google, con font-display: optional (nunca cambian a mitad) y en el shell del SW.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const docs = (f) => fs.readFileSync(path.join(__dirname, '../docs', f));
for (const pagina of ['index.html', 'dashboard.html']) {
  test(`${pagina}: letras locales, sin Google y sin cambio a mitad`, () => {
    const src = docs(pagina).toString('utf8');
    assert.doesNotMatch(src, /fonts\.googleapis\.com\/css/);
    const caras = src.match(/@font-face\{[^}]*\}/g) || [];
    assert.ok(caras.length >= 3);
    for (const c of caras) { assert.match(c, /font-display:optional/); assert.match(c, /url\(\.\/fonts\/[a-z0-9-]+\.woff2\)/); }
  });
}
test('cada letra existe, es woff2 y la guarda el service worker', () => {
  const sw = docs('sw.js').toString('utf8');
  for (const f of ['space-grotesk-latin', 'source-sans-3-latin', 'jetbrains-mono-latin', 'inter-latin']) {
    assert.equal(docs(`fonts/${f}.woff2`).subarray(0, 4).toString('latin1'), 'wOF2');
    assert.ok(sw.includes(`"./fonts/${f}.woff2"`), f + ' no esta en el SHELL');
  }
});
