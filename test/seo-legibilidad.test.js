/* Bloque 2 (JFC 2026-09-24): fijacion de SEO basico y de la regla de legibilidad.
   Test de FIJACION (comportamiento que debe seguir asi), no de un bug:
   robots + sitemap existen y apuntan bien; las tres paginas publicas llevan
   canonical y JSON-LD valido; ningun chip con texto blanco usa el verde
   #00C87A ni el naranja #F97316 (2.2:1 y 2.8:1); la alerta naranja de la app
   no lleva texto blanco sobre naranja. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const DOCS = path.join(__dirname, '../docs');
const leer = (f) => fs.readFileSync(path.join(DOCS, f), 'utf8');

test('robots.txt y sitemap.xml existen, se apuntan y no exponen el panel', () => {
  const robots = leer('robots.txt'), sitemap = leer('sitemap.xml');
  assert.match(robots, /Sitemap: https:\/\/jfcarpiopuntocom\.github\.io\/friendly-123\/sitemap\.xml/);
  assert.match(robots, /Disallow: \/panel\.html/);
  assert.match(robots, /Disallow: \/dashboard\.html/);
  for (const u of ['friendly-123/', 'save.html', 'visualize.html']) assert.ok(sitemap.includes(u), 'sitemap incluye ' + u);
  assert.ok(!sitemap.includes('panel.html'));
});

test('index, save y visualize llevan canonical y JSON-LD parseable con el precio real', () => {
  for (const [f, canon] of [['index.html', 'friendly-123/"'], ['save.html', 'save.html"'], ['visualize.html', 'visualize.html"']]) {
    const html = leer(f);
    assert.match(html, new RegExp('<link rel="canonical" href="https://jfcarpiopuntocom\\.github\\.io/friendly-123/' + canon.replace('friendly-123/', '').replace('.', '\\.')), f + ' canonical');
    const m = html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
    assert.ok(m, f + ' tiene JSON-LD');
    const ld = JSON.parse(m[1]);
    assert.equal(ld['@context'], 'https://schema.org');
    const offer = ld.offers || (ld.about && ld.about.offers);
    assert.equal(offer.price, '399');
    assert.equal(offer.priceCurrency, 'USD');
  }
});

test('legibilidad: ningun chip con texto blanco usa el verde o naranja claros; la alerta naranja va en tinta oscura', () => {
  for (const f of ['save.html', 'visualize.html']) {
    const css = leer(f);
    assert.match(css, /--verde-ink:#0B7A4B/);
    assert.doesNotMatch(css, /\.tchip-(verde|naranja)\{ background:var\(--(verde|naranja)\); color:#FFFFFF/, f + ': chip blanco sobre color claro');
    assert.match(css, /\.btn-primary\{\s*background:var\(--verde-ink\)/, f + ': boton principal con verde tinta');
  }
  const app = leer('index.html');
  assert.doesNotMatch(app, /li\.naranja\{background:var\(--sim-naranja\); color:#FFFFFF/);
  assert.match(app, /li\.naranja\{background:#FDD9BE; color:#7C2D12/);
});
