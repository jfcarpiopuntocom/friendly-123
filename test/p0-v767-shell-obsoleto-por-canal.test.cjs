'use strict';
// v767 (revision de codigo 13 nov 2026), hallazgo 3.
// _soltarShellObsoleto (docs/estado-idb.js) libera espacio tras una cuota real
// borrando cachés de shell viejas. Antes borraba cualquier `f123-shell-vN` mas
// vieja que latest-3 SIN mirar el canal: desde la app estable podia borrar la
// caché del canal de rollback (/previo/) o de /next/, y un /next/ mas nuevo
// adelantaba "latest". Ahora solo toca el canal activo (igual que su hermana
// _soltarShellSecundarioVerificado y que esDeMiCanal() de sw.js).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname,'../docs/estado-idb.js'),'utf8');

// Same IDB double as p0-v680-quota-recovery: first CAS attempt aborts with a
// real QuotaExceededError, the retry after the cache cleanup commits.
function fixture(pathname, cacheNames) {
  let stored = {_rev:7, ventas:[]}, tries = 0;
  const left = new Set(cacheNames), removed = [];
  const caches = { keys: async () => Array.from(left),
    delete: async (n) => { removed.push(n); return left.delete(n); } };
  const db = { objectStoreNames:{contains:()=>true}, transaction() {
    const attempt = ++tries; let pending = null;
    const tx = { error:null, objectStore() { return {
      get() { const req = {result:stored};
        queueMicrotask(() => { req.onsuccess(); queueMicrotask(() => {
          if (attempt === 1 && pending) { const e = new Error('quota'); e.name = 'QuotaExceededError'; tx.error = e; tx.onabort(); }
          else { if (pending) stored = pending; tx.oncomplete(); }
        }); });
        return req; },
      put(s) { pending = structuredClone(s); } }; } };
    return tx; } };
  const indexedDB = { open() { const req = {result:db}; queueMicrotask(() => req.onsuccess()); return req; } };
  const window = { indexedDB, caches, location: { pathname } };
  vm.runInNewContext(src, {window, indexedDB, navigator:{storage:{}}, console, Promise, setTimeout, clearTimeout, queueMicrotask, structuredClone});
  return { idb: window.OCEstadoIDB, removed, get left() { return Array.from(left); } };
}

const TODAS = [
  'f123-shell-v760-golden300',          // stable, obsolete (767 - 3 = 764)
  'f123-shell-v767-golden306',          // stable, active
  'f123-shell-v700-golden250-previo',   // rollback channel: must survive a stable cleanup
  'f123-shell-v764-golden303-previo',   // rollback channel, its newest
  'f123-shell-v770-golden309-next',     // newer canary: must not move the stable cutoff
  'f123-shell-v766-golden305-next'
];

test('v767 RED: stable app quota cleanup never deletes the rollback (/previo/) or /next/ caches', async () => {
  const f = fixture('/friendly-123/', TODAS);
  assert.equal(await f.idb.guardarConRevision({_rev:8, ventas:[{id:'s'}]}, 7), true);
  assert.deepEqual(f.removed, ['f123-shell-v760-golden300'], 'only the obsolete STABLE shell is released');
  for (const n of TODAS.filter((x) => /-(previo|next)$/.test(x))) assert.ok(f.left.includes(n), n + ' must survive');
});

test('v767: /previo/ app releases only its own obsolete cache, using its own newest version', async () => {
  const f = fixture('/friendly-123/previo/', TODAS);
  assert.equal(await f.idb.guardarConRevision({_rev:8, ventas:[{id:'p'}]}, 7), true);
  assert.deepEqual(f.removed, ['f123-shell-v700-golden250-previo']);
  assert.ok(f.left.includes('f123-shell-v760-golden300'), 'stable caches are not the rollback page\'s to delete');
});

test('v767: without location (older harness) behaves as the stable channel', async () => {
  const f = fixture(undefined, ['f123-shell-v650-golden120', 'f123-shell-v679-golden223', 'f123-shell-v600-golden100-previo']);
  assert.equal(await f.idb.guardarConRevision({_rev:8}, 7), true);
  assert.deepEqual(f.removed, ['f123-shell-v650-golden120']);
});
