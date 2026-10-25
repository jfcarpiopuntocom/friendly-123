'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../docs/sync-realtime.js'), 'utf8');

function block(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `source anchors found: ${start}`);
  return source.slice(a, b);
}

const responder = block('  async function responderCatalogo(pedido) {', '  /* DIFUNDIR EL EQUIPO EN CUANTO CAMBIA');
const team = block('  async function difundirEquipo() {', '  /* La capa de datos (');
const catalog = block('  async function difundirCatalogo() {', '  var _difCatT = null;');

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}

function bridge(snapshot) {
  let socket = { readyState: 1, sent: [], send(data) { this.sent.push(data); } };
  let catalogReads = 0, getterReads = 0, seq = 0;
  const gate = deferred();
  const window = { OCSync: {
    catalogoPropio() { getterReads++; return null; },
    catalogoConfirmado() { catalogReads++; return gate.promise; }
  }};
  const trocear = (tabla, filas) => [{ tabla, filas: Array.isArray(filas) ? filas : [] }];
  const fns = new Function('window', 'initialSocket', 'WebSocket', 'setTimeout', 'Math', 'trocear', 'uuidCorto', 'deviceId', 'rolActual', 'cifrar', 'TIPO_CATALOGO_TROZO',
    `let ws=initialSocket, claveActual='fixture-key';\n${responder}\n${team}\n${catalog}\nreturn { responderCatalogo, difundirEquipo, difundirCatalogo, setSocket(value) { ws=value; } };`)(
      window,
      socket,
      { OPEN: 1 },
      callback => { callback(); return 1; },
      { random: () => 0 },
      trocear,
      () => `op-${++seq}`,
      () => 'device-fixture',
      () => 'dueno',
      async (_key, op) => JSON.stringify(op),
      'catalog-chunk'
    );
  return {
    gate,
    fns,
    originalSocket: socket,
    get catalogReads() { return catalogReads; },
    get getterReads() { return getterReads; }
  };
}

const fixtureCatalog = {
  ubicaciones: [{ id: 'shelf-committed' }],
  productos: [{ id: 'product-committed', stockBase: 10, stockPN: { device: { sub: 2 } } }],
  usuarios: [{ id: 'owner' }],
  clientes: [],
  huella: { corta: 'confirmed' },
  nombreNegocio: 'fixture'
};

async function flushUntil(predicate) {
  for (let i = 0; i < 30 && !predicate(); i++) await Promise.resolve();
  assert.ok(predicate(), 'all consumers reached the durable catalog barrier');
}

test('realtime catalog consumers wait for confirmed state and answer after ACK', async () => {
  const b = bridge(fixtureCatalog);
  const results = [
    b.fns.responderCatalogo({ deviceId: 'peer' }),
    b.fns.difundirEquipo(),
    b.fns.difundirCatalogo()
  ];
  await flushUntil(() => b.catalogReads === 3);
  assert.equal(b.originalSocket.sent.length, 0, 'no provisional catalog leaves during durable save');
  assert.equal(b.getterReads, 0, 'consumers use the shared confirmed snapshot helper');
  b.gate.resolve(fixtureCatalog);
  assert.equal((await Promise.all(results)).every(result => result !== false), true);
  assert.ok(b.originalSocket.sent.length >= 3, 'requested and broadcast catalog responses are retained');
  const messages = b.originalSocket.sent.map(JSON.parse);
  assert.ok(messages.some(message => JSON.stringify(message).includes('product-committed')));
  assert.ok(messages.some(message => message.para === 'peer'), 'the pending catalog request receives its response');
  assert.ok(messages.every(message => !JSON.stringify(message).includes('provisional')));
});

test('realtime consumers do not send an awaited snapshot on a replaced socket', async () => {
  const b = bridge(fixtureCatalog);
  const results = [
    b.fns.responderCatalogo({ deviceId: 'peer' }),
    b.fns.difundirEquipo(),
    b.fns.difundirCatalogo()
  ];
  await flushUntil(() => b.catalogReads === 3);
  const replacement = { readyState: 1, sent: [], send(data) { this.sent.push(data); } };
  b.fns.setSocket(replacement);
  b.gate.resolve(fixtureCatalog);
  const settled = await Promise.all(results);
  assert.equal(settled[1], false);
  assert.equal(settled[2], false);
  assert.equal(b.originalSocket.sent.length, 0);
  assert.equal(replacement.sent.length, 0, 'snapshot from the old request is not sent to a new session');
});
