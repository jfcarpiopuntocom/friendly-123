'use strict';
// v670: immutable photo evidence must be seeded to BOTH durable relay layers.
// Reapplying a deterministic Yjs photo update to an already-hydrated document
// is a no-op; it still needs a new persistent op on the newly selected layer.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const file = fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8');
const block = file.slice(file.indexOf('  var _fotosSembradas ='),
  file.indexOf('  // OCFotos local -> Yjs(fotos).'));
const waitFor = async predicate => {
  const end = Date.now() + 2500;
  while (!predicate() && Date.now() < end) await new Promise(r => setTimeout(r, 5));
  assert.ok(predicate(), 'seed should complete without waiting indefinitely');
};
test('v670: an unchanged photo is durably republished once on each newly visited layer', async () => {
  const ctx = { crypto: webcrypto, TextEncoder, Uint8Array, ArrayBuffer, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname,
    '../docs/vendor/yjs-bundle.min.js'), 'utf8'), ctx);
  const Y = ctx.Y, doc = new Y.Doc();
  const hash = 'photo-cross-layer', data = 'data:image/png;base64,AQID';
  const sends = [];
  const ws = { relayLayer: 'f123_relay_cupo_fb_v1' };
  ctx.API = { fotosDoc: doc, fotosCanal: { ws,
    enviarUpdate: u => sends.push({ layer: ws.relayLayer, kind: 'reseed', bytes: Buffer.from(u) }) } };
  ctx.window = { Y,
    OCFotos: { leerTodosPorHash: async () => ({ [hash]: data }), leerPorHash: async () => data },
    OCSync: { catalogoPropio: () => ({ productos: [{ fotoHash: hash }] }) } };
  doc.on('update', (u, origin) => {
    if (origin === 'seed') sends.push({ layer: ws.relayLayer, kind: 'normal', bytes: Buffer.from(u) });
  });
  vm.runInContext(block, ctx);
  const seed = () => vm.runInContext('sembrarFotosAlRelay();', ctx);
  seed(); await waitFor(() => !!ctx._fotosSembradas[hash]?.[ws.relayLayer]);
  assert.equal(sends.length, 1, 'first layer gets its normal encrypted durable op');
  assert.equal(doc.getMap('blobs').get(hash), data);
  seed(); await new Promise(r => setTimeout(r, 30));
  assert.equal(sends.length, 1, 'same layer must not receive a duplicate on reconnect');
  ws.relayLayer = 'f123_relay_cupo_v1';
  seed(); await waitFor(() => !!ctx._fotosSembradas[hash]?.[ws.relayLayer]);
  assert.equal(sends.length, 2, 'second durable layer needs a new durable seed');
  assert.equal(sends[1].kind, 'reseed', 'Yjs no-op must send the same minimal update explicitly');
  assert.equal(Buffer.compare(sends[0].bytes, sends[1].bytes), 0,
    'identical deterministic Yjs bytes; no inventing a photo');
  seed(); await new Promise(r => setTimeout(r, 30));
  assert.equal(sends.length, 2, 'second layer also deduplicates');
  doc.destroy();
});

test('v670: best-effort peer recovery cannot be mistaken for a durable relay ACK', () => {
  assert.ok(file.includes('source = ev.relaySource === "peer-live" ? "live"'),
    'RTC copies get live-only classification during a durable pull');
  assert.ok(file.includes('ws.peerOnly || ev.relaySource === "peer-live"'),
    'peer-ready initiates a state-vector exchange with a durable socket open');
  assert.ok(!file.includes('source = ev.relaySource === "peer-live" ? "pull"'),
    'RTC frames cannot advance the durable pull cursor');
});
