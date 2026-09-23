const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const docs = path.join(__dirname, '..', 'docs');
const read = name => fs.readFileSync(path.join(docs, name), 'utf8');

test('labels cannot route a product QR to another JFC app', () => {
  const backend = read('mock-backend.js');
  assert.doesNotMatch(backend, /github\.io\/AMIGABLE\/\?sku=/);
  assert.match(backend, /const qrPayload = String\(p\.barcode \|\| p\.sku \|\| ""\)/);
});

test('label printing keeps the Safari user gesture and has a barcode-only print mode', () => {
  const html = read('index.html');
  const full = html.match(/function imprimirEtiquetaCompleta\(\)[\s\S]*?\n}/)?.[0] || '';
  const barcode = html.match(/function imprimirSoloBarcode\([^)]*\)[\s\S]*?\n}/)?.[0] || '';
  assert.match(full, /window\.print\(\)/);
  assert.doesNotMatch(full, /iframe|contentWindow/);
  assert.match(barcode, /oc-print-barcode-only/);
  assert.match(barcode, /window\.print\(\)/);
});

test('manual describes the current shared notebook and all current core flows', () => {
  /* JFC 2026-09-23: manual.html es ahora el manual bilingüe (EN/ES). La
     estructura cambió (secciones con nombre en vez de sec-1..9); la GUARDA de
     contenido se mantiene: variantes, clientes, perchas, cuaderno compartido,
     AirPrint y la meta de 2 s tienen que estar en los DOS idiomas. */
  const manual = read('manual.html');
  for (const id of ['que-es','primeros-pasos','colores','vista-hoy','inventario','perchas','vender','etiquetas','clientes','seguridad']) {
    assert.equal((manual.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} must exist once (ES)`);
    assert.equal((manual.match(new RegExp(`id="${id}-en"`, 'g')) || []).length, 1, `${id}-en must exist once (EN)`);
  }
  for (const phrase of ['Crear variante', 'Create variant', 'Clientes', 'Perchas', 'Cuaderno compartido', 'Shared notebook', 'AirPrint', 'menos de 2 segundos', 'under 2 seconds']) {
    assert.match(manual, new RegExp(phrase));
  }
  assert.doesNotMatch(manual, /Toca el producto en la cuadrícula y listo/);
  assert.doesNotMatch(manual, /QR que abre la app directamente/, 'el QR no abre la app');
});

test('help does not claim synchronized business data never leaves one device', () => {
  const help = read('help-ui.js');
  assert.doesNotMatch(help, /your business data never does|tus datos de negocio nunca salen/);
  assert.match(help, /travels encrypted|viaja cifrado/);
  assert.match(help, /manual\.html/);
});

test('manual describes QR payload truthfully in both languages and caches one shared image', () => {
  const manual = fs.readFileSync(process.env.F123_MANUAL_TEST_SOURCE || path.join(docs, 'manual.html'), 'utf8');
  assert.doesNotMatch(manual, /QR opcional que abre la ficha completa|QR that opens the full card/);
  assert.doesNotMatch(manual, /leer la sinopsis completa en su celular|read the full synopsis on their phone/);
  assert.equal((manual.match(/src="manual-logo\.png"/g) || []).length, 3);
  assert.doesNotMatch(manual, /data:image\/png;base64/);
  assert.ok(fs.statSync(path.join(docs, 'manual-logo.png')).size > 0);
  assert.match(read('sw.js'), /"\.\/manual-logo\.png"/);
});
