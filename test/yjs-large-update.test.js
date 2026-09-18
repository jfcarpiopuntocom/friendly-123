const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('large Yjs updates are bounded before send and reassembled exactly once', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8');
  const block = source.slice(source.indexOf('  function _frame('), source.indexOf('  // Carga perezosa'));
  const sockets = [];
  class Socket {
    constructor() { this.readyState = 1; this.sent = []; sockets.push(this); }
    send(bytes) { this.sent.push(bytes); }
  }
  const applied = [];
  const c = {
    API: { clave: 'fixture', roomId: 'fixture' }, RELAY_URL: 'fixture:', WebSocket: Socket,
    Y: { applyUpdate(_doc, bytes) { applied.push(Array.from(bytes)); } },
    log() {}, setTimeout() {}, clearTimeout() {}, Date, Math, JSON, Uint8Array, ArrayBuffer,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    cifrarBin: async (_key, bytes) => bytes.slice().buffer,
    descifrarBin: async (_key, bytes) => new Uint8Array(bytes),
  };
  vm.createContext(c);
  vm.runInContext(block + '\nthis.makeChannel = crearCanal;', c);
  const sender = c.makeChannel(c.Y, {}, '-y', 'test', false);
  const receiver = c.makeChannel(c.Y, {}, '-y', 'test', false);
  sender.conectar(); receiver.conectar();
  const original = new Uint8Array(400 * 1024);
  for (let i = 0; i < original.length; i++) original[i] = i % 251;
  sender.enviarUpdate(original);
  await new Promise(resolve => setTimeout(resolve, 20));
  const sent = sockets[0].sent;
  assert.equal(sent.length, 6, 'three binary chunks and three persisted ops');
  for (const frame of sent) assert.ok((typeof frame === 'string' ? frame.length : frame.byteLength) < 256 * 1024);
  for (const frame of sent.filter(x => x instanceof ArrayBuffer).reverse()) sockets[1].onmessage({ data: frame });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0], Array.from(original));
  const lateReceiver = c.makeChannel(c.Y, {}, '-y', 'late', false);
  lateReceiver.conectar();
  for (const op of sent.filter(x => typeof x === 'string').reverse()) {
    const bytes = Buffer.from(JSON.parse(op).c, 'base64');
    const copy = Uint8Array.from(bytes);
    sockets[2].onmessage({ data: copy.buffer });
  }
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(applied.length, 2, 'offline pull can rebuild from persisted chunks');
  assert.deepEqual(applied[1], Array.from(original));
});
