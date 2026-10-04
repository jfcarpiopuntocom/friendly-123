const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recoverShelfPhoto } = require('../docs/application/recover-shelf-photo.js');

function memoryPorts(seed = {}) {
  const state = {
    perId: { ...(seed.perId || {}) },
    byHash: { ...(seed.byHash || {}) },
    syncByHash: { ...(seed.syncByHash || {}) },
    currentMap: { ...(seed.currentMap || {}) },
    history: { ...(seed.history || {}) },
    pointerWrites: [],
    warnings: []
  };
  const hashOf = seed.hashOf || ((bytes) => {
    const map = seed.byteHashes || {};
    return map[bytes] || null;
  });
  return {
    state,
    ports: {
      currentMappedHash: async (id) => state.currentMap[id] || null,
      historyHashes: async (id) => (state.history[id] || []).slice(),
      readPerId: async (id) => state.perId[id] || null,
      hashBytes: async (bytes) => hashOf(bytes),
      readByHash: async (h) => state.byHash[h] || null,
      readSyncByHash: async (h) => state.syncByHash[h] || null,
      preserveByHash: async (h,b) => { state.byHash[h] = b; },
      preserveById: async (id,b) => { state.perId[id] = b; },
      setPointer: async (id,h) => { state.pointerWrites.push({id,hash:h}); return true; },
      warn: (c) => state.warnings.push(c)
    }
  };
}

test('use case: current pointer bytes win and refresh per-id mirror without pointer write', async () => {
  const m = memoryPorts({ byHash:{'hash-current':'BYTES-CURRENT'}, perId:{u1:'OLD'} });
  const r = await recoverShelfPhoto({id:'u1',fotoHash:'hash-current'}, m.ports);
  assert.equal(r.displayBytes, 'BYTES-CURRENT');
  assert.equal(r.pointerChanged, false);
  assert.equal(m.state.pointerWrites.length, 0);
  assert.equal(m.state.perId.u1, 'BYTES-CURRENT');
});

test('use case: missing current blob shows same-shelf local fallback but never rewrites current pointer', async () => {
  const m = memoryPorts({ perId:{u1:'LOCAL'}, byteHashes:{LOCAL:'hash-local'} });
  const r = await recoverShelfPhoto({id:'u1',fotoHash:'hash-current-not-arrived'}, m.ports);
  assert.equal(r.estado, 'fallback-local');
  assert.equal(r.displayBytes, 'LOCAL');
  assert.equal(r.pointerHash, 'hash-current-not-arrived');
  assert.equal(r.pointerChanged, false);
  assert.deepEqual(m.state.pointerWrites, []);
  assert.deepEqual(m.state.warnings, ['foto-hash-pendiente']);
});

test('use case: lost pointer repairs from exact Yjs mapping when bytes survive', async () => {
  const m = memoryPorts({
    currentMap:{u1:'hash-yjs'},
    byHash:{'hash-yjs':'YJS-BYTES'}
  });
  const r = await recoverShelfPhoto({id:'u1',fotoHash:null}, m.ports);
  assert.equal(r.estado, 'recuperada');
  assert.equal(r.fuente, 'yjs-actual');
  assert.equal(r.displayBytes, 'YJS-BYTES');
  assert.deepEqual(m.state.pointerWrites, [{id:'u1',hash:'hash-yjs'}]);
});

test('use case: lost pointer falls through exact history newest->oldest, then same-shelf per-id', async () => {
  const m = memoryPorts({
    history:{u1:['hash-new','hash-old']},
    byHash:{'hash-old':'OLD-HISTORY'},
    perId:{u1:'LOCAL'},
    byteHashes:{LOCAL:'hash-local'}
  });
  const r = await recoverShelfPhoto({id:'u1',fotoHash:null}, m.ports);
  assert.equal(r.pointerHash, 'hash-old');
  assert.equal(r.fuente, 'yjs-historial');
  assert.equal(r.displayBytes, 'OLD-HISTORY');
  assert.deepEqual(m.state.pointerWrites, [{id:'u1',hash:'hash-old'}]);
});

test('use case: if no Yjs/history survives, exact per-id bytes self-heal their own shelf only', async () => {
  const m = memoryPorts({
    perId:{u1:'LOCAL-U1'},
    byteHashes:{'LOCAL-U1':'hash-u1'}
  });
  const r = await recoverShelfPhoto({id:'u1',fotoHash:null}, m.ports);
  assert.equal(r.pointerHash, 'hash-u1');
  assert.equal(r.fuente, 'bytes-por-id');
  assert.equal(r.displayBytes, 'LOCAL-U1');
  assert.deepEqual(m.state.pointerWrites, [{id:'u1',hash:'hash-u1'}]);
});
