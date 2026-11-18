'use strict';
// Contract test of the ACTUAL legacy OCSync.reproducir body, not a reimplementation.
// No app, network, user PIN, production data, or commercial writes are executed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const original = fs.readFileSync(path.join(__dirname, '../docs/avanzado-extra.js'), 'utf8');
const start = original.indexOf('    function idsAplicados() {');
const end = original.indexOf('    async function activar(pin) {', start);
assert.ok(start >= 0 && end > start, 'fixture must select the real legacy replay and applied-ID helpers');
const source = original.slice(start, end);

function fixture(replies = []) {
  const rows = new Map([['f123_device_id', 'receiver-fixture']]);
  const calls = [];
  const storage = {
    getItem(key) { return rows.has(key) ? rows.get(key) : null; },
    setItem(key, value) { rows.set(key, String(value)); },
    removeItem(key) { rows.delete(key); }
  };
  const context = {
    localStorage: storage,
    deviceId: () => 'receiver-fixture',
    fetchOriginal: async (url, opts) => {
      calls.push({ url, method: opts.method, body: opts.body });
      assert.ok(replies.length > 0, 'every attempted replay must have an explicit synthetic response');
      const response = replies.shift();
      if (response instanceof Error) throw response;
      return response;
    },
    JSON, Set, Promise
  };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.actualReplay = reproducir;', context, {
    filename: 'avanzado-extra.js/reproducir (actual code)'
  });
  const ids = key => JSON.parse(storage.getItem(key) || '[]').sort();
  return {
    calls,
    reply(...items) { replies.push(...items); },
    run(ops) { return context.actualReplay(ops); },
    applied() { return ids('f123_sync_ids_aplicados'); },
    relayApplied() { return ids('f123_sync_ops_aplicadas'); }
  };
}

const operation = (id, dev = 'sender-fixture', ts = 1) => ({
  id, opId: 'same-commercial-' + id, dev, ts,
  method: 'POST', url: '/api/productos/synthetic/venta', body: '{"cantidad":1}'
});

for (const [status, name] of [[403, 'forbidden'], [500, 'server-failure']]) {
  test('P0 HTTP ' + status + ' (' + name + ') never marks the opId as applied, preserves order and retries original IDs', async () => {
    const f = fixture([{ ok: false, status }]);
    const originalOps = [operation('sale-a', 'other-device', 1), operation('sale-b', 'other-device', 2)];
    await f.run(originalOps);
    assert.deepEqual(f.calls.map(c => c.url).length, 1,
      'rejected first operation MUST stop the same sender until recovery');
    assert.deepEqual(f.applied(), [], 'HTTP rejection must not consume local applied IDs');
    assert.deepEqual(f.relayApplied(), [], 'HTTP rejection must not consume shared relay dedup IDs');

    f.reply({ ok: true, status: 200 }, { ok: true, status: 200 });
    await f.run(originalOps);
    assert.equal(f.calls.length, 3);
    assert.deepEqual(f.applied(), ['sale-a', 'sale-b'], 'same IDs eventually applied after genuine HTTP success');
    assert.deepEqual(f.relayApplied(), ['same-commercial-sale-a', 'same-commercial-sale-b']);
    await f.run(originalOps);
    assert.equal(f.calls.length, 3, 'a successful retry cannot duplicate the same commercial intents');
  });
}

test('network exception preserves the original pending operation and its cross-layer opId', async () => {
  const f = fixture([new Error('synthetic network offline')]);
  const ops = [operation('sale-offline')];
  await f.run(ops);
  assert.deepEqual(f.applied(), []);
  assert.deepEqual(f.relayApplied(), []);
  f.reply({ ok: true, status: 201 });
  await f.run(ops);
  assert.deepEqual(f.applied(), ['sale-offline']);
  assert.deepEqual(f.relayApplied(), ['same-commercial-sale-offline']);
});

test('a rejected sender does not block another sender or borrow that sender\'s ACK', async () => {
  const f = fixture([{ ok: false, status: 403 }, { ok: true, status: 200 }]);
  const ops = [operation('a', 'sender-A'), operation('b', 'sender-B')];
  await f.run(ops);
  assert.deepEqual(f.applied(), ['b']);
  assert.deepEqual(f.relayApplied(), ['same-commercial-b']);
  f.reply({ ok: true, status: 200 });
  await f.run(ops);
  assert.deepEqual(f.applied(), ['a', 'b']);
  assert.equal(f.calls.length, 3);
});

test('missing or malformed HTTP response is not an ACK; valid 2xx response remains accepted', async () => {
  const f = fixture([null]);
  const ops = [operation('synthetic-null')];
  await f.run(ops);
  assert.deepEqual(f.applied(), []);
  f.reply({ ok: true, status: 204 });
  await f.run(ops);
  assert.deepEqual(f.applied(), ['synthetic-null']);
});
