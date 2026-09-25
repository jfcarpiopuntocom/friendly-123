/* Aviso al comisionista por WhatsApp (JFC 2026-09-24, feature nueva).
   Fija las reglas de diseno: se ofrece solo desde el flujo de venta (nunca desde
   el merge del sync, asi otro aparato no lo repite), nunca abre WhatsApp solo
   (es un enlace que la persona toca), y no aparece en COUNTER SALE ni sin
   comision. La prueba de comportamiento en Chromium real se corrio aparte. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8').replace(/\r\n/g, '\n'); // CRLF local (autocrlf); Pages sirve LF
const mock = fs.readFileSync(path.join(__dirname, '../docs/mock-backend.js'), 'utf8').replace(/\r\n/g, '\n'); // CRLF local (autocrlf); Pages sirve LF

test('se ofrece solo desde el flujo de venta, nunca desde el sync', () => {
  const llamadas = html.split('ofrecerAvisoComisionista(').length - 1;
  assert.equal(llamadas, 2, 'la definicion + UNA llamada (tras la venta)');
  assert.match(html, /mostrarToastAnular\(data\.ventaId, id\);\n\s*if \(data\.ventaId\) ofrecerAvisoComisionista\(/);
  assert.ok(!mock.includes('ofrecerAvisoComisionista'), 'el merge del sync no lo dispara');
});

test('nunca envia solo: es un enlace wa.me que la persona toca; sale en counter y sin comision', () => {
  const f = html.slice(html.indexOf('async function ofrecerAvisoComisionista'), html.indexOf('function mostrarToastAnular'));
  assert.ok(!/window\.open\(/.test(f), 'no abre WhatsApp por su cuenta');
  assert.match(f, /a\.href = url/);
  assert.match(f, /v\.modoComision === "counter"\) return/);
  assert.match(f, /!\(Number\(v\.comisionAsociado\) > 0\)/);
  assert.match(f, /setTimeout\(quitar, 20000\)/, 'se retira sola');
});
