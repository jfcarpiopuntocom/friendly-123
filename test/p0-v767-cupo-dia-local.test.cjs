'use strict';
// v767 (revision de codigo 13 nov 2026), hallazgo 4.
// El cupo diario por aparato de cada capa durable (docs/relay-selector.js) se
// reiniciaba por fecha UTC (toISOString().slice(0,10)): en Ecuador eso es a las
// 7 pm, no a medianoche. Ahora el dia es la fecha LOCAL del aparato.
// La zona se fija aqui para que la prueba diga lo mismo en cualquier maquina/CI.
process.env.TZ = 'America/Guayaquil';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const SRC = fs.readFileSync(path.join(__dirname, '../docs/relay-selector.js'), 'utf8');
const URL1 = 'wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/' + 'b'.repeat(40) + '-y';
const sub = (h) => h.capaPrincipal || h;

class FakeSocket extends EventTarget {
  constructor(kind) { super(); this.kind = kind; this.readyState = 0; this.sent = []; this.closed = null; }
  send(v) { this.sent.push(v); }
  close(code, reason) { this.closed = { code, reason }; this.readyState = 3; this.dispatchEvent(new Event('close')); }
}
// Same minimal harness as test/relay-selector.test.cjs (no network, fixed clock).
function app(now, store) {
  const fake = (kind) => ({ ckptFrameBytes: 786432, connect: () => new FakeSocket(kind) });
  const w = {
    localStorage: { getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
    F123Relay: fake('supabase'), F123FirebaseRelay: fake('firebase'),
    F123Peer: { create: () => fake('peer') }, F123_VIVO: false,
    EventTarget, Event, DOMException, JSON, Number, String,
    setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {}
  };
  w.Date = class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } };
  w.window = w;
  vm.runInNewContext(SRC, w);
  return w.F123Relay;
}
const lleno = (dia) => new Map([['f123_relay_cupo_v1', JSON.stringify({ dia, up: 0, down: 20 * 1024 * 1024, pausaHasta: 0 })]]);

test('v767 RED: at 8 pm Ecuador (01:00 UTC next day) the budget spent today is still spent', () => {
  assert.equal(new Date(Date.parse('2026-11-14T01:00:00Z')).getDate(), 13, 'TZ fixture really is Ecuador');
  const R = app(Date.parse('2026-11-14T01:00:00Z'), lleno('2026-11-13'));
  assert.equal(sub(R.connect(URL1)).kind, 'firebase', 'Supabase daily budget must not reset at 7 pm local');
});

test('v767: after local midnight the Supabase budget is fresh again', () => {
  const R = app(Date.parse('2026-11-14T05:30:00Z'), lleno('2026-11-13')); // 00:30 Nov 14 in Ecuador
  assert.equal(sub(R.connect(URL1)).kind, 'supabase');
});
