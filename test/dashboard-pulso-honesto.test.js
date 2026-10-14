// JFC 2026-10-14: "arriba dice 'al dia hace 100 segundos'... debemos sync en MILISEGUNDOS".
// El pulso dice lo medido: en vivo si un aparato respondio hace < 25 s; si no, que ningun
// aparato responde (con la hora del ultimo dato). Nunca "al dia" con 100 s de silencio.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../docs/dashboard.html'), 'utf8').replace(/\r\n/g, '\n');
const a = html.indexOf('  setInterval(function () {\n    if (!ultimoDato) return;');
const b = html.indexOf('}, 5000);', a);
function pulsoCon(edadMs, wsAbierto) {
  let cb, txt = '';
  const c = { Date, ultimoDato: Date.now() - edadMs, ws: wsAbierto ? { readyState: 1 } : null, modoLocal: false,
    pulso: (t) => { txt = t; }, setInterval: (f) => { cb = f; } };
  vm.createContext(c); vm.runInContext(html.slice(a, b + 9), c); cb(); return txt;
}
test('respuesta reciente = en vivo', () => { assert.match(pulsoCon(3000, true), /en vivo/); });
test('100 s sin respuesta NO dice "al dia"', () => {
  const t = pulsoCon(100000, true);
  assert.doesNotMatch(t, /al d[ií]a/); assert.match(t, /ningún aparato/);
});
test('sin conexion lo dice', () => { assert.match(pulsoCon(100000, false), /sin conexión/); });
