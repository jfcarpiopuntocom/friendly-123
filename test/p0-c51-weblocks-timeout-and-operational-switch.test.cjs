'use strict';
// C51 (TDD RED -> GREEN):
// 1. Bounded AbortController timeout on navigator.locks.request in mutarOutboxAtomico
//    so a frozen/BFCache tab holding the Web Lock cannot deadlock outbox commits.
// 2. Double-QA-gated operational-switch bootstrap (f123_yparty_qa === "1" &&
//    f123_corte20_qa === "1", both OFF by default, fail-closed for demo/non-commercial).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const syncSrc = fs.readFileSync(path.join(root, 'docs/sync-yjs.js'), 'utf8');

function mountOutboxLockHarness({ navigatorLocks, runImpl }) {
  const s = syncSrc.indexOf('    function mutarOutbox(change) {');
  const e = syncSrc.indexOf('    var _durableQueue =', s);
  assert.ok(s > 0 && e > s, 'mutarOutbox block must exist in docs/sync-yjs.js');
  const fnSrc = syncSrc.slice(s, e);

  let fallbackCalls = 0;
  const API = { roomId: 'room-c51-test', __outboxLockTimeoutMs: 30 };
  const _groupAcks = new Set();
  const ctx = vm.createContext({
    API,
    suffix: '',
    _outbox: { pending: [], checkpoint: '', confirmed: [] },
    _unsaved: [],
    _groupAcks,
    AbortController,
    setTimeout,
    clearTimeout,
    Promise,
    navigator: navigatorLocks ? { locks: navigatorLocks } : undefined,
    leerOutbox: () => Promise.resolve({ pending: [], checkpoint: '', confirmed: [] }),
    guardarOutbox: () => (runImpl ? runImpl() : Promise.resolve()),
    avisarDurable: () => {},
    mutarOutboxAtomicoSinLocks: (change, run) => {
      fallbackCalls += 1;
      change();
      return Promise.resolve({ fallback: true });
    }
  });
  vm.runInContext(fnSrc, ctx);
  return {
    mutarOutbox: ctx.mutarOutbox,
    getFallbackCalls: () => fallbackCalls
  };
}

test('C51.1: hung navigator.locks.request aborts after bounded timeout and falls back to mutarOutboxAtomicoSinLocks', async () => {
  let receivedSignal = null;
  let aborted = false;
  const { mutarOutbox, getFallbackCalls } = mountOutboxLockHarness({
    navigatorLocks: {
      request(_name, optsOrRun, maybeRun) {
        const opts = typeof optsOrRun === 'function' ? null : optsOrRun;
        receivedSignal = opts && opts.signal ? opts.signal : null;
        return new Promise((_resolve, reject) => {
          if (receivedSignal) {
            receivedSignal.addEventListener('abort', () => {
              aborted = true;
              const err = new Error('The lock request was aborted');
              err.name = 'AbortError';
              reject(err);
            }, { once: true });
          }
        });
      }
    }
  });

  let changed = false;
  const res = await Promise.race([
    mutarOutbox(() => { changed = true; }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('OUTBOX_DEADLOCK')), 250))
  ]);

  assert.ok(receivedSignal, 'navigator.locks.request must receive AbortSignal');
  assert.equal(aborted, true, 'hung Web Lock must be aborted after timeout');
  assert.equal(getFallbackCalls(), 1, 'must fall back once to mutarOutboxAtomicoSinLocks');
  assert.equal(changed, true);
  assert.deepEqual(res, { fallback: true });
});

test('C51.2: real error inside lock callback is rethrown without falling back to unlocked path', async () => {
  const { mutarOutbox, getFallbackCalls } = mountOutboxLockHarness({
    navigatorLocks: {
      request(_name, optsOrRun, maybeRun) {
        const run = typeof optsOrRun === 'function' ? optsOrRun : maybeRun;
        return Promise.resolve().then(() => run());
      }
    },
    runImpl: () => Promise.reject(new Error('REAL_IDB_WRITE_FAILURE'))
  });

  await assert.rejects(() => mutarOutbox(() => {}), /REAL_IDB_WRITE_FAILURE/);
  assert.equal(getFallbackCalls(), 0, 'real business/IDB error must not bypass lock');
});

test('C51.3: uncontended navigator.locks.request succeeds without unlocked fallback', async () => {
  const { mutarOutbox, getFallbackCalls } = mountOutboxLockHarness({
    navigatorLocks: {
      request(_name, optsOrRun, maybeRun) {
        const run = typeof optsOrRun === 'function' ? optsOrRun : maybeRun;
        return Promise.resolve().then(() => run());
      }
    }
  });

  let changed = false;
  await mutarOutbox(() => { changed = true; });
  assert.equal(changed, true);
  assert.equal(getFallbackCalls(), 0);
});

function evalQaSwitch({ storageMap, hasPiloto = true, role = 'dueno', demo = false }) {
  const helper = syncSrc.indexOf('    function _intentarActivarCorte20SiElegible() {');
  const s = helper >= 0 ? helper : syncSrc.indexOf('    API.corte20QaHabilitado = function () {');
  const e = syncSrc.indexOf('    API.estado = "activo";', s);
  assert.ok(s > 0 && e > s, 'C51 double-QA switch block must exist in docs/sync-yjs.js');
  const block = syncSrc.slice(s, e);

  const activarCalls = [];
  const API = {
    canalPiloto: hasPiloto ? { proveedor: 'https://qa.example' } : null,
    activarCorte20Runtime: (opts) => {
      activarCalls.push(opts);
      return Promise.resolve({ mode: '2.0' });
    }
  };
  const ctx = vm.createContext({
    API,
    Promise,
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(storageMap, k) ? storageMap[k] : null)
    },
    window: {
      OCAuth: {
        rolActual: () => role,
        esDemo: () => demo
      }
    }
  });
  vm.runInContext(block, ctx);
  return { enabled: API.corte20QaHabilitado(), activarCalls: JSON.parse(JSON.stringify(activarCalls)) };
}

test('C51.4: double-QA operational switch stays OFF by default and requires both QA flags + live non-demo Owner/Admin', () => {
  assert.deepEqual(evalQaSwitch({ storageMap: {} }), { enabled: false, activarCalls: [] });
  assert.deepEqual(evalQaSwitch({ storageMap: { f123_yparty_qa: '1' } }), { enabled: false, activarCalls: [] });
  assert.deepEqual(evalQaSwitch({ storageMap: { f123_corte20_qa: '1' } }), { enabled: false, activarCalls: [] });
  assert.deepEqual(
    evalQaSwitch({ storageMap: { f123_yparty_qa: '1', f123_corte20_qa: '1' }, demo: true }),
    { enabled: true, activarCalls: [] }
  );
  assert.deepEqual(
    evalQaSwitch({ storageMap: { f123_yparty_qa: '1', f123_corte20_qa: '1' }, role: 'empleado' }),
    { enabled: true, activarCalls: [] }
  );
  assert.deepEqual(
    evalQaSwitch({ storageMap: { f123_yparty_qa: '1', f123_corte20_qa: '1' }, role: 'dueno', demo: false }),
    { enabled: true, activarCalls: [{ cortarComercio: true }] }
  );
});
