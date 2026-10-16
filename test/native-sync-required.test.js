const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = name => fs.readFileSync(path.join(__dirname, '..', 'docs', name), 'utf8');
const base = 'a'.repeat(40);
function forbiddenSocket() { throw Error('Cloudflare data connection attempted'); }

// Execute the real connection functions with synthetic crypto/room and timers.
// The pending queue and displayed data are sentinels: unavailable transport must
// not flush/remove them, and no raw WebSocket can be constructed.
test('app retains queued data and schedules retry when native adapter is missing or broken', async () => {
  const source = read('sync-realtime.js');
  const start = source.indexOf('  async function conectar() {');
  const end = source.indexOf('\n  function ', start + 1);
  for (const adapter of [undefined, {}, { connect() { throw Error('unavailable'); } }]) {
    let retry = 0;
    const queue = [{ opId: 'synthetic-unsent', ciphertext: 'AQID' }], states = [];
    const c = {
      window: { F123Relay: adapter }, WebSocket: forbiddenSocket,
      leerSala: () => ({ codigo: 'SYNTHETIC' }), cerrarWsExistente() {},
      notificarEstado: value => states.push(value), estadoActual: 'apagado',
      normalizarCodigo: value => value, derivarClave: async () => 'synthetic-key',
      idDeSala: async () => base, RELAY_URL: 'wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/',
      programarReintento() { retry++; }, ws: null,
      vaciarCola() { queue.length = 0; },
    };
    vm.createContext(c); vm.runInContext(source.slice(start, end), c);
    await c.conectar();
    assert.equal(retry, 1); assert.equal(states.at(-1), 'reconectando');
    assert.equal(queue.length, 1); assert.equal(c.ws, null);
  }
});

test('dashboard adapter failures retry with backoff, preserve data and never open a raw socket', async () => {
  const source = read('dashboard.html');
  const start = source.indexOf('  function programarReconexion(codigo) {');
  const end = source.indexOf('\n  async function pedirFoto()', start);
  for (const adapter of [undefined, {}, { connect() { throw Error('unavailable'); } }]) {
    const timers = [], states = [];
    const c = {
      window: { F123Relay: adapter }, WebSocket: forbiddenSocket,
      derivarClave: async () => 'synthetic-key', idDeSala: async () => base,
      salaCompatible: value => value, RELAY_URL: 'wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/',
      ws: null, reconexionTimer: null, reconexionMs: 1500, autorizado: true,
      setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
      pulso: value => states.push(value), datos: { ventas: [{ id: 'synthetic' }] },
    };
    vm.createContext(c); vm.runInContext(source.slice(start, end), c);
    await assert.rejects(c.conectar('synthetic'));
    assert.equal(timers.length, 1); assert.ok(timers[0].ms >= 750 && timers[0].ms <= 1500);
    timers[0].fn(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(timers.length, 2); assert.ok(timers[1].ms >= 1500 && timers[1].ms <= 3000);
    assert.equal(states.at(-1), 'reconectando…'); assert.equal(c.datos.ventas.length, 1);
    assert.equal(c.ws, null);
  }
});

test('dashboard pending migration closes immediately and retries instead of waiting for handshake timeout', async () => {
  const { createRelayGateway } = await import('../supabase-relay/gateway.mjs');
  const source = read('dashboard.html'), start = source.indexOf('  function programarReconexion(codigo) {');
  const timers = [], cleared = [];
  const c = {
    window: { F123Relay: createRelayGateway({ resolveRoute: async () => ({ mode: 'legacy' }), native() { throw Error('must not activate'); } }) },
    derivarClave: async () => 'synthetic-key', idDeSala: async () => base, salaCompatible: value => value,
    RELAY_URL: 'wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/', ws: null,
    reconexionTimer: null, reconexionMs: 1500, autorizado: false, pulso() {},
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; }, clearTimeout(id) { cleared.push(id); },
  };
  vm.createContext(c); vm.runInContext(source.slice(start, source.indexOf('\n  async function pedirFoto()', start)), c);
  await assert.rejects(c.conectar('synthetic'), /native migration pending/);
  assert.equal(c.ws.readyState, 3); assert.ok(cleared.includes(1)); assert.equal(timers.length, 2);
});
