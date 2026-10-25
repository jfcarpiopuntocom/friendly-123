'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8');
function block(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `source anchors found: ${start}`);
  return source.slice(a, b);
}

const barrierSource = block('    function barreraYjsConfirmada() {', '    function guardarPruebaCausal(');
const proofSource = block('    function guardarPruebaCausal(cursor, pendientes) {', '    function cursorValido(');
const pullSource = block('    function guardarPullCursor(cursor) {', '    function clavePendientes()');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness({ set, get } = {}) {
  const io = { writes: [], gets: 0, transactions: [] };
  const db = {
    objectStoreNames: { contains: name => name === 'updates' },
    transaction(names, mode) {
      assert.deepEqual(names, ['updates']);
      assert.equal(mode, 'readonly');
      const tx = {};
      io.transactions.push(tx);
      return tx;
    }
  };
  const persistencia = {
    db,
    set(key, value) {
      const snapshot = JSON.parse(JSON.stringify(value));
      io.writes.push({ key, value: snapshot });
      return set ? set(key, snapshot) : Promise.resolve();
    },
    get(key) {
      io.gets++;
      return get ? get(key, io.writes[io.writes.length - 1]?.value) : Promise.resolve(io.writes[io.writes.length - 1]?.value);
    }
  };
  const h = new Function('persistencia', `
    let _soloMemoria = false;
    let _pullCursor = { rev: 2, seq: 4 };
    let _appliedPullCursor = { rev: 2, seq: 4 };
    let _pendingProofPages = 0;
    let _cursorContainsPending = false;
    let _ultimoCursorLimpio = { rev: 2, seq: 4 };
    const MAX_PENDING_PROOF_BYTES = 2 * 1024 * 1024;
    const _pullCursorKey = 'synthetic-pull-cursor';
    const partesEntrantes = Object.create(null);
    const doc = { store: null };
    const Y = {};
    ${barrierSource}
    ${proofSource}
    ${pullSource}
    return {
      guardarPullCursor,
      state: () => ({ pull: { ..._pullCursor }, applied: { ..._appliedPullCursor } })
    };
  `)(persistencia);
  return { ...h, io };
}

async function until(predicate, message) {
  for (let i = 0; i < 30 && !predicate(); i++) await Promise.resolve();
  assert.ok(predicate(), message);
}

function cursorTx(h) {
  assert.equal(h.io.transactions.length, 1, 'ordinary cursor write waits for the updates-store transaction');
  return h.io.transactions[0];
}

test('fully-applied cut waits for journal ACK, cursor write and exact readback', async () => {
  const write = deferred(), readback = deferred();
  const h = harness({ set: () => write.promise, get: () => readback.promise });
  const pending = h.guardarPullCursor({ rev: 3, seq: 9 });

  assert.deepEqual(h.state(), { pull: { rev: 3, seq: 9 }, applied: { rev: 2, seq: 4 } });
  assert.equal(h.io.writes.length, 0, 'cursor is not written before the Yjs journal barrier');
  const tx = cursorTx(h);
  tx.oncomplete();
  await until(() => h.io.writes.length === 1, 'cursor write starts after journal ACK');
  assert.deepEqual(h.io.writes[0].value, { rev: 3, seq: 9, cursorLimpio: { rev: 3, seq: 9 } });
  assert.deepEqual(h.state().applied, { rev: 2, seq: 4 }, 'set ACK alone does not advance before readback');

  write.resolve();
  await until(() => h.io.gets === 1, 'cursor readback starts after set ACK');
  assert.deepEqual(h.state().applied, { rev: 2, seq: 4 });
  readback.resolve(h.io.writes[0].value);
  await pending;
  assert.deepEqual(h.state().applied, { rev: 3, seq: 9 });
});

test('journal failure never writes or advances the fully-applied cut', async () => {
  const h = harness();
  const pending = h.guardarPullCursor({ rev: 3, seq: 9 });
  cursorTx(h).onabort();
  await pending;
  assert.equal(h.io.writes.length, 0);
  assert.deepEqual(h.state(), { pull: { rev: 3, seq: 9 }, applied: { rev: 2, seq: 4 } });
});

test('cursor set failure never advances the fully-applied cut', async () => {
  const write = deferred();
  const h = harness({ set: () => write.promise });
  const pending = h.guardarPullCursor({ rev: 3, seq: 9 });
  cursorTx(h).oncomplete();
  await until(() => h.io.writes.length === 1, 'cursor set starts');
  write.reject(new Error('synthetic cursor IDB write failure'));
  await pending;
  assert.equal(h.io.gets, 0);
  assert.deepEqual(h.state(), { pull: { rev: 3, seq: 9 }, applied: { rev: 2, seq: 4 } });
});

test('mismatched cursor readback never advances the fully-applied cut', async () => {
  const write = deferred();
  const h = harness({
    set: () => write.promise,
    get: () => Promise.resolve({ rev: 3, seq: 8, cursorLimpio: { rev: 3, seq: 8 } })
  });
  const pending = h.guardarPullCursor({ rev: 3, seq: 9 });
  cursorTx(h).oncomplete();
  await until(() => h.io.writes.length === 1, 'cursor set starts');
  write.resolve();
  await pending;
  assert.equal(h.io.gets, 1);
  assert.deepEqual(h.state(), { pull: { rev: 3, seq: 9 }, applied: { rev: 2, seq: 4 } });
});

test('journal, set and readback acknowledgements advance the fully-applied cut', async () => {
  const h = harness();
  const pending = h.guardarPullCursor({ rev: 3, seq: 9 });
  cursorTx(h).oncomplete();
  await pending;
  assert.equal(h.io.writes.length, 1);
  assert.equal(h.io.gets, 1);
  assert.deepEqual(h.state(), { pull: { rev: 3, seq: 9 }, applied: { rev: 3, seq: 9 } });
});
