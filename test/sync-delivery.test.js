// Exercise actual channel framing and the measurement model without provider traffic.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8');
const channelCode = source.slice(source.indexOf('  function _frame('), source.indexOf('  // Carga perezosa'));
const meterCode = fs.readFileSync(path.join(__dirname, '../docs/sync-latencia.js'), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 2));

async function fixture() {
  const sent = [], applied = [], saved = new Map();
  let now = 0, render = Promise.resolve(true), failApply = false, duplicate = false;
  const key = await webcrypto.subtle.importKey('raw', new Uint8Array(32).fill(19), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const socket = { readyState: 1, send(value) { sent.push(value); } };
  const api = { clave: key, roomId: 'synthetic', _catalogoRevision: 0, confirmarCatalogoVisible: () => render };
  const context = {
    API: api, RELAY_URL: 'fixture:', crypto: webcrypto, performance: { now: () => now },
    Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, Date, Math, JSON, Map, Promise,
    navigator: {}, log() {}, CustomEvent: class {},
    setTimeout() { return 1; }, clearTimeout() {},
    btoa: x => Buffer.from(x, 'binary').toString('base64'),
    async cifrarBin(_, bytes) {
      const iv = webcrypto.getRandomValues(new Uint8Array(12));
      const cipher = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
      const out = new Uint8Array(iv.length + cipher.length); out.set(iv); out.set(cipher, 12); return out.buffer;
    },
    async descifrarBin(_, buffer) {
      const bytes = new Uint8Array(buffer);
      return new Uint8Array(await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12)));
    }
  };
  context.window = context;
  context.F123Relay = { connect: () => socket };
  context.dispatchEvent = () => {};
  vm.createContext(context); vm.runInContext(meterCode + '\n' + channelCode + '\nthis.make=crearCanal;', context);
  const doc = { store: {} };
  const Y = {
    encodeStateVector: () => new Uint8Array([0]), encodeStateAsUpdate: () => new Uint8Array([0, 0]),
    applyUpdate(_, bytes) {
      if (failApply) throw Error('synthetic apply failure');
      applied.push(Array.from(bytes)); if (!duplicate) api._catalogoRevision++;
    }
  };
  const persistence = { get: async key => saved.get(key), set: async (key, value) => saved.set(key, structuredClone(value)) };
  const channel = context.make(Y, doc, '-y', 'catalogo', false, null, persistence);
  channel.conectar(); socket.onopen(); socket.onmessage({ data: JSON.stringify({ k: 'peer-count', n: 2 }) });
  return { context, api, channel, socket, sent, applied, doc, saved,
    time(value) { now = value; }, render(value) { render = value; }, fail(value) { failApply = value; }, duplicate(value) { duplicate = value; } };
}
async function pump(a, b, rounds = 12, filter = () => true) {
  for (let n = 0; n < rounds; n++) {
    for (const [from, to] of [[a, b], [b, a]]) {
      for (const frame of from.sent.splice(0)) {
        if (!(frame instanceof ArrayBuffer)) continue; // durability is tested separately
        const clear = await from.context.descifrarBin(null, frame);
        if (filter(clear, from)) to.socket.onmessage({ data: frame });
      }
    }
    await tick();
  }
}
async function pair() { const a = await fixture(), b = await fixture(); await pump(a, b); return [a, b]; }

test('correlated encrypted update cannot acknowledge until its application/render receipt resolves', async () => {
  const [a, b] = await pair();
  let complete; b.render(new Promise(resolve => { complete = resolve; }));
  a.channel.enviarUpdate(new Uint8Array([7, 8, 9]));
  await pump(a, b);
  assert.ok(b.applied.some(x => x.join(',') === '7,8,9'));
  assert.equal(a.context.OCLatencia.resumen().n, 0);
  assert.equal(a.context.OCLatencia.resumen().pendientes, 1);
  a.time(350); complete(true); await pump(a, b);
  const result = a.context.OCLatencia.resumen();
  assert.equal(result.n, 1); assert.equal(result.max, 350); assert.equal(result.cumpleSLA, false);
});

test('control request arriving before its bytes cannot acknowledge unrelated prior data', async () => {
  const [a, b] = await pair();
  const held = [];
  a.channel.enviarUpdate(new Uint8Array([42]));
  await pump(a, b, 12, (bytes, sender) => {
    if (sender === a && bytes[0] === 0) { held.push(bytes); return false; } return true;
  });
  assert.equal(a.context.OCLatencia.resumen().n, 0);
  for (const bytes of held) b.socket.onmessage({ data: await a.context.cifrarBin(null, bytes) });
  a.time(120); await pump(a, b);
  assert.equal(a.context.OCLatencia.resumen().n, 1);
});

for (const mode of ['failed apply', 'failed render', 'duplicate update', 'missing dependencies']) {
  test(mode + ' never borrows an earlier successful visible receipt', async () => {
    const [a, b] = await pair();
    a.channel.enviarUpdate(new Uint8Array([1])); await pump(a, b);
    assert.equal(a.context.OCLatencia.resumen().n, 1);
    if (mode === 'failed apply') b.fail(true);
    if (mode === 'failed render') b.render(Promise.resolve(false));
    if (mode === 'duplicate update') b.duplicate(true);
    if (mode === 'missing dependencies') b.doc.store.pendingStructs = {};
    a.channel.enviarUpdate(new Uint8Array([2])); await pump(a, b);
    assert.equal(a.context.OCLatencia.resumen().n, 1);
    assert.equal(a.context.OCLatencia.resumen().cumpleSLA, null);
  });
}

test('unknown recipient coverage and optional diagnostic failure never block data or certify it', async () => {
  const [a, b] = await pair();
  a.socket.onmessage({ data: JSON.stringify({ k: 'peer-count', n: 3 }) });
  a.channel.enviarUpdate(new Uint8Array([12])); await pump(a, b);
  assert.ok(b.applied.some(x => x[0] === 12));
  assert.equal(a.context.OCLatencia.resumen().n, 0);
  assert.equal(a.context.OCLatencia.resumen().cumpleSLA, null);
  a.context.OCLatencia.iniciarEntrega = () => { throw Error('diagnostic unavailable'); };
  a.context.OCLatencia.hayReloj = () => { throw Error('optional clock unavailable'); };
  b.context.crypto = { subtle: { digest() { throw Error('hash unavailable'); } } };
  a.channel.enviarUpdate(new Uint8Array([13])); await pump(a, b);
  assert.ok(b.applied.some(x => x[0] === 13));
  b.socket.onmessage({ data: JSON.stringify({ k: 'pull-page', rev: 0, seq: 9, more: false }) });
  await tick();
  assert.equal(b.saved.get('f123_yjs_pull_cursor_v2-y').seq, 9, 'optional telemetry failure cannot reject an applied recovery page');
});


test('fragmented update cannot obtain a visible receipt until every encrypted chunk applies', async () => {
  const [a, b] = await pair();
  const held = [];
  a.channel.enviarUpdate(new Uint8Array(350000).fill(27));
  await pump(a, b, 16, (bytes, sender) => {
    if (sender === a && bytes[0] === 3 && bytes[19] === 1) { held.push(bytes); return false; }
    return true;
  });
  assert.ok(held.length);
  assert.equal(a.context.OCLatencia.resumen().n, 0);
  assert.ok(!b.applied.some(x => x.length === 350000));
  for (const bytes of held) b.socket.onmessage({ data: await a.context.cifrarBin(null, bytes) });
  a.time(140); await pump(a, b);
  assert.equal(b.applied.filter(x => x.length === 350000).length, 1);
  assert.equal(a.context.OCLatencia.resumen().n, 1);
});
