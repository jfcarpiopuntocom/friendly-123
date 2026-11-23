'use strict';
// C200 regression executes the real source initializer, including the first
// unconditional call that used to load Today's DOM/JSON behind the PIN.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/app/app-inline-01.js'), 'utf8');
const from = source.lastIndexOf('// --- Init ---');
const to = source.indexOf('// Splash de arranque', from);
assert.ok(from >= 0 && to > from, 'real dashboard initialization boundary');
const executedSource = source.slice(from, to);

function fixture({ initialGate = null, initialRole = null, hold = false } = {}) {
  let gate = initialGate;
  let role = initialRole;
  let locations = 0, today = 0;
  const listeners = new Map();
  let release = null;
  const waiting = hold ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  const win = {
    OCAuth: initialRole === null ? undefined : { rolActual: () => role },
    addEventListener(name, fn) {
      const arr = listeners.get(name) || [];
      arr.push(fn);
      listeners.set(name, arr);
    },
    emit(name) {
      for (const fn of listeners.get(name) || []) fn({ detail: { rol: role } });
    }
  };
  const context = {
    window: win,
    document: {
      getElementById(id) { return id === 'oc-gate' ? gate : null; }
    },
    console,
    queueMicrotask,
    setTimeout,
    cargarUbicaciones: async () => { locations++; await waiting; },
    cargarHoy: async () => { today++; },
    t: x => x
  };
  vm.runInNewContext(executedSource, context);
  return {
    win,
    setGate: x => { gate = x; },
    setRole: x => { role = x; win.OCAuth = { rolActual: () => role }; },
    emitLogin: () => win.emit('oc-login'),
    release: () => { if (release) release(); },
    counts: () => ({ locations, today }),
    flush: async () => { await new Promise(resolve => setImmediate(resolve)); }
  };
}

test('C200: initial shell and sync hydration never load Today while PIN is absent/visible', async () => {
  const f = fixture();
  await f.flush();
  assert.deepEqual(f.counts(), { locations: 0, today: 0 },
    'RED old source started full dashboard while auth-ui gate not even created');
  f.setGate({ style: { display: 'flex' } });
  f.setRole('dueno');
  f.emitLogin();
  await f.flush();
  assert.deepEqual(f.counts(), { locations: 0, today: 0 },
    'an event alone cannot pretend the PIN gate has closed');
  f.setGate({ style: { display: 'none' } });
  f.emitLogin();
  await f.flush();
  assert.deepEqual(f.counts(), { locations: 1, today: 1 });
});

test('C200: a genuine Owner PIN and an auto-restored Owner session initialize the same dashboard', async () => {
  const cold = fixture({initialGate:{style:{display:'flex'}},initialRole:'dueno'});
  await cold.flush();
  assert.equal(cold.counts().today, 0);
  cold.setGate({style:{display:'none'}});
  cold.emitLogin();
  await cold.flush();
  assert.equal(cold.counts().today, 1);
  const warm = fixture({initialGate:{style:{display:'none'}},initialRole:'dueno'});
  await warm.flush();
  assert.deepEqual(warm.counts(), { locations: 1, today: 1 });
});

test('C200: logout blocks rendering, subsequent Team login triggers fresh dashboard in chosen namespace', async () => {
  const f = fixture({initialGate:{style:{display:'none'}},initialRole:'dueno'});
  await f.flush();
  f.setGate({style:{display:'flex'}});
  f.setRole(null);
  f.emitLogin();
  await f.flush();
  assert.equal(f.counts().today, 1);
  f.setGate({style:{display:'none'}});
  f.setRole('admin');
  f.emitLogin();
  await f.flush();
  assert.equal(f.counts().today, 2, 'second authenticated session refreshes new business');
});

test('C200: consecutive oc-login while an old read runs are coalesced, not concurrent duplicate dashboards', async () => {
  const f = fixture({ initialGate:{style:{display:'flex'}}, initialRole:'dueno', hold:true });
  f.setGate({style:{display:'none'}});
  f.emitLogin();
  f.emitLogin();
  await f.flush();
  assert.deepEqual(f.counts(), { locations:1, today:0 }, 'one fetch in flight');
  f.release();
  await f.flush();
  assert.deepEqual(f.counts(), { locations:2, today:2 }, 'one rerun after previous read');
});

test('C200: authenticated initial dashboard uses the existing coalesced Sync3 renderer once', async () => {
  let locations = 0, directToday = 0, sharedRenders = 0;
  const listeners = new Map();
  const win = {
    OCAuth: { rolActual: () => 'dueno' },
    OCSyncRender: { solicitar: async () => { sharedRenders++; return true; } },
    addEventListener: (name, fn) => listeners.set(name, fn)
  };
  const doc = { getElementById: id => id === 'oc-gate' ? { style: { display: 'none' } } : null };
  vm.runInNewContext(executedSource, {
    window: win, document: doc, console, queueMicrotask, setTimeout,
    cargarUbicaciones: async () => { locations++; },
    cargarHoy: async () => { directToday++; },
    t: x => x
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(locations, 1);
  assert.equal(sharedRenders, 1, 'one coalesced render even if Sync3 also requested it');
  assert.equal(directToday, 0, 'no competing direct Today DOM construction');
});
