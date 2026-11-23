'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('RED->GREEN C244-1: slow Firebase recovery >3 min without markRecovered MUST NOT be aborted by reprobarH; returns to CF immediately once markRecovered fires', async () => {
  const rsPath = path.join(__dirname, '../docs/relay-selector.js');
  const rsSrc = fs.readFileSync(rsPath, 'utf8');
  const url = 'wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/' + 'a'.repeat(40) + '-ops';

  let now = 1_730_000_000_000;
  const timers = [];
  const made = [];
  const lsMap = new Map();
  const fakeWindow = {
    localStorage: {
      getItem: k => (lsMap.has(k) ? lsMap.get(k) : null),
      setItem: (k, v) => lsMap.set(k, String(v)),
      removeItem: k => lsMap.delete(k)
    },
    addEventListener() {}
  };
  function makeSub(kind) {
    const ls = {};
    const ws = {
      kind,
      readyState: 0,
      bufferedAmount: 0,
      binaryType: 'blob',
      closed: null,
      addEventListener(t, f) { (ls[t] = ls[t] || []).push(f); },
      removeEventListener(t, f) { ls[t] = (ls[t] || []).filter(x => x !== f); },
      send(raw) {
        if (typeof raw === 'string' && raw.indexOf('"k":"head"') !== -1 && ws.autoHead) {
          queueMicrotask(() => ws.recv(JSON.stringify({ k: 'head-result', rev: 1, seq: 1 })));
        }
      },
      open() { ws.readyState = 1; (ls.open || []).slice().forEach(f => f({})); },
      recv(data) { (ls.message || []).slice().forEach(f => f({ data })); },
      close(code = 1000, reason = '') {
        if (ws.readyState >= 2) return;
        ws.readyState = 3;
        ws.closed = { code, reason };
        (ls.close || []).slice().forEach(f => f({ code, reason, wasClean: code === 1000 }));
      }
    };
    made.push(ws);
    return ws;
  }
  let autoOpenCfProbe = false;
  fakeWindow.F123CloudflareRelay = { ckptFrameBytes: 1536 * 1024, connect: () => { const s = makeSub('cf'); s.autoHead = true; if (autoOpenCfProbe) queueMicrotask(() => s.open()); return s; } };
  fakeWindow.F123FirebaseRelay = { ckptFrameBytes: 768 * 1024, connect: () => makeSub('fb'), leerHead: async () => ({ rev: 2, seq: 99 }) };

  class FakeEventTarget {
    constructor() { this._l = {}; }
    addEventListener(t, f) { (this._l[t] = this._l[t] || []).push(f); }
    dispatchEvent(e) { (this._l[e.type] || []).slice().forEach(f => f(e)); }
  }
  const FakeDate = function (...a) { return a.length ? new Date(...a) : new Date(now); };
  FakeDate.now = () => now;
  const ctx = {
    window: fakeWindow,
    document: { hidden: false },
    localStorage: fakeWindow.localStorage,
    EventTarget: FakeEventTarget,
    Event: function (t) { this.type = t; },
    DOMException,
    Date: FakeDate,
    setTimeout(fn, ms) { const e = { fn, at: now + ms, repeat: null, on: true }; timers.push(e); return e; },
    clearTimeout(e) { if (e) e.on = false; },
    setInterval(fn, ms) { const e = { fn, at: now + ms, repeat: ms, on: true }; timers.push(e); return e; },
    clearInterval(e) { if (e) e.on = false; }
  };
  vm.createContext(ctx);
  vm.runInContext(rsSrc, ctx);
  const tick = () => {
    for (const e of timers.slice()) {
      if (e.on && now >= e.at) {
        if (e.repeat) e.at = now + e.repeat; else e.on = false;
        e.fn();
      }
    }
  };

  // Step 1: Connect CF (head 1:1), probe sees FB 2:99 -> switches to FB
  const h1 = fakeWindow.F123Relay.connect(url);
  made[0].open();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(made[0].closed?.code, 1012, 'CF must close to switch to FB archive');

  // Step 2: Connect FB for slow download (>3 min = 185s) BEFORE markRecovered()
  const h2 = fakeWindow.F123Relay.connect(url);
  const fbSock = made.find(s => s.kind === 'fb');
  assert.ok(fbSock);
  fbSock.open();
  autoOpenCfProbe = true;

  now += 185_000; // past OTRA_CAPA_LEER_MS (180_000 ms), slow connection still downloading!
  tick();
  await new Promise(r => setImmediate(r));

  assert.equal(fbSock.closed, null, 'reprobarH must NOT abort active slow Firebase recovery before markRecovered()');
  assert.notEqual(h2.readyState, 3, 'wrapper socket must remain open until recovery completes');

  // Step 3: Once markRecovered() finishes, recovery unlocks CF pause and reprobarH upgrades cleanly
  h2.markRecovered();
  now += 35_000;
  tick();
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(h2.readyState, 3, 'after markRecovered(), returning to CF upgrades cleanly');
});

test('RED->GREEN C244-2: idb-archivo resets cached handle on BFCache pageshow and rejects hung indexedDB.open() via watchdog', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../docs/idb-archivo.js'), 'utf8');
  const winListeners = {};
  let opens = 0;
  const fakeWindow = {
    addEventListener(t, f) { (winListeners[t] = winListeners[t] || []).push(f); },
    navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }
  };
  const timeouts = [];
  const fakeIDB = {
    open() {
      opens++;
      const req = { result: { objectStoreNames: { contains: () => true }, transaction: () => ({ objectStore: () => ({ getAll: () => ({}) }) }) } };
      if (opens === 1) {
        // First open succeeds cleanly
        queueMicrotask(() => req.onsuccess && req.onsuccess());
      }
      // Second open (after BFCache persisted reset) hangs forever in Safari!
      return req;
    }
  };
  const ctx = {
    window: fakeWindow,
    indexedDB: fakeIDB,
    console,
    setTimeout(fn, ms) { timeouts.push({ fn, ms }); return timeouts.length; },
    clearTimeout() {}
  };
  ctx.window.indexedDB = fakeIDB;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);

  // Trigger initial open & BFCache pageshow(persisted: true)
  const p1 = fakeWindow.OCArchivo.leerTodos();
  await new Promise(r => setImmediate(r));
  assert.ok(Array.isArray(winListeners.pageshow) && winListeners.pageshow.length > 0, 'idb-archivo must listen to pageshow for BFCache');
  winListeners.pageshow.forEach(fn => fn({ persisted: true }));

  const p2 = fakeWindow.OCArchivo.leerTodos();
  assert.equal(opens, 2, 'pageshow(persisted) must drop stale handle so next read reopens DB');
  assert.ok(timeouts.some(t => t.ms >= 5000 && t.ms <= 15000), 'idb-archivo open must install a bounded watchdog');
  timeouts.forEach(t => t.fn());
  const res2 = await p2;
  assert.deepEqual(Array.from(res2), [], 'watchdog timeout must fail open cleanly with [] instead of hanging');
  void p1;
});