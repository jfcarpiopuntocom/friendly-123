'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('IndexedDB transient open failure retries without deleting data', async () => {
  let opens = 0;
  const indexedDB = { open() {
    const req = {}, attempt = ++opens;
    queueMicrotask(() => {
      if (attempt === 1) { req.error = Error('temporarily blocked'); req.onerror(); return; }
      req.result = { transaction() { return { objectStore() { return { get() {
        const getReq = { result: { _rev: 42 } };
        queueMicrotask(() => getReq.onsuccess());
        return getReq;
      } }; } }; } };
      req.onsuccess();
    });
    return req;
  } };
  const window = { indexedDB };
  const ctx = { window, indexedDB, navigator: {}, console: { error() {} }, setTimeout, clearTimeout };
  const source = fs.readFileSync(path.join(__dirname, '../docs/estado-idb.js'), 'utf8');
  vm.runInNewContext(source, ctx);
  assert.equal(await window.OCEstadoIDB.leer(), null);
  assert.deepEqual(JSON.parse(JSON.stringify(await window.OCEstadoIDB.leer())), { _rev: 42 });
  assert.equal(opens, 2);
});
