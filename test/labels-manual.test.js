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
  const manual = read('manual.html');
  for (const id of ['sec-1','sec-2','sec-3','sec-4','sec-5','sec-6','sec-7','sec-8','sec-9']) {
    assert.equal((manual.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} must exist once`);
  }
  for (const phrase of ['Crear variante', 'CLIENTES Y PERCHAS', 'CUADERNO COMPARTIDO', 'AirPrint', 'menos de 2 segundos']) {
    assert.match(manual, new RegExp(phrase));
  }
  assert.doesNotMatch(manual, /Toca el producto en la cuadrícula y listo/);
});

test('help does not claim synchronized business data never leaves one device', () => {
  const help = read('help-ui.js');
  assert.doesNotMatch(help, /your business data never does|tus datos de negocio nunca salen/);
  assert.match(help, /travels encrypted|viaja cifrado/);
  assert.match(help, /manual\.html/);
});
