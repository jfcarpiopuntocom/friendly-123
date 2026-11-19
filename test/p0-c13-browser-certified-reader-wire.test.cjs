'use strict';
// PORT2 C13: RED->GREEN against REAL docs/sync-yjs.js + REAL Yjs bundle.
// Verifies wiring of C12 certified read-only public catalog reader into the
// live browser sync lifecycle, strictly behind the double QA switch (OFF by default).
// Synthetic licences/data only; no network, no PIN persistence, no real store.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const syncPath = path.join(__dirname, '../docs/sync-yjs.js');
const source = fs.readFileSync(syncPath, 'utf8').replace(/\r\n/g, '\n');

function cargarY() {
  const w = {}; w.window = w; w.self = w; w.globalThis = w;
  new Function('window', 'self', 'globalThis',
    fs.readFileSync(path.join(__dirname, '../docs/vendor/yjs-bundle.min.js'), 'utf8'))(w, w, w);
  return w.Y;
}
const Y = cargarY();

function sliceReaderFactory() {
  const start = source.indexOf('  function _crearLectorCatalogoPublicoCertificado(');
  const end = source.indexOf('\n  function _cabezaCongeladaQa(', start);
  assert.ok(start >= 0 && end > start, 'C13 real certified reader controller must exist in docs/sync-yjs.js');
  const headEnd = source.indexOf('\n  function origenCatalogoRemoto(', end);
  assert.ok(headEnd > end, 'C13 frozen head helper must exist in docs/sync-yjs.js');
  return source.slice(start, headEnd);
}

function makeController({
  head = 'certified-qa-head-c13',
  hidden = false,
  idbSynced = true,
  legadoListo = true,
  pendingStructs = null,
  pendingDs = null,
  sessionImpl
} = {}) {
  const code = sliceReaderFactory();
  const doc = new Y.Doc();
  doc.getMap('productos').set('p1', {id: 'p1', nombre: 'Libro QA', precio: 15, stockActual: 4});
  doc.getMap('ubicaciones').set('u1', {id: 'u1', nombre: 'Percha 1', activa: true});
  doc.getMap('_meta').set('pinsRol', {owner: 'NEVER_LEAK'});
  doc.getMap('ventas').set('v1', {id: 'v1', importe: 999});
  if (pendingStructs) doc.store.pendingStructs = pendingStructs;
  if (pendingDs) doc.store.pendingDs = pendingDs;

  let isHidden = hidden;
  let now = 100000;
  const calls = [];
  const closed = [];
  const defaultSession = async (passedDoc, passedHead) => {
    calls.push({doc: passedDoc, head: passedHead});
    let open = true;
    return Object.freeze({
      frozenHead: passedHead,
      readOnly: true,
      display() {
        if (!open) return null;
        return Object.freeze({
          productos: {p1: {id: 'p1', nombre: 'Libro QA', precio: 15, stockActual: 4}},
          ubicaciones: {u1: {id: 'u1', nombre: 'Percha 1', activa: true}}
        });
      },
      close() {
        if (!open) return;
        open = false;
        closed.push(passedHead);
      }
    });
  };
  const piloto = {
    leerCatalogoPublicoCertificado: sessionImpl
      ? (d, h) => { calls.push({doc: d, head: h}); return sessionImpl(d, h); }
      : defaultSession
  };
  const ctx = vm.createContext({
    document: {get hidden() { return isHidden; }},
    localStorage: {getItem: k => k === 'f123_yparty_qa_frozen_head' ? head : null},
    Date: {now: () => now},
    Object, Number, String, RegExp, Promise, Math, structuredClone
  });
  vm.runInContext(code, ctx);
  const ctrl = ctx._crearLectorCatalogoPublicoCertificado({
    piloto,
    doc,
    idb: {get synced() { return idbSynced; }},
    legadoListo: () => legadoListo,
    obtenerHead: () => ctx._cabezaCongeladaQa({yparty: true, frozenHead: null}),
    log: () => {}
  });
  return {
    ctrl, doc, calls, closed,
    setHidden: v => { isHidden = v; },
    setIdbSynced: v => { idbSynced = v; },
    setLegadoListo: v => { legadoListo = v; },
    advanceMs: ms => { now += ms; }
  };
}

test('C13 wires certified reader into docs/sync-yjs.js lifecycle while keeping rollout OFF', () => {
  assert.match(source, /_crearLectorCatalogoPublicoCertificado\(/, 'sync-yjs.js must construct the C13 reader');
  assert.match(source, /API\.leerCatalogoPublicoCertificado\s*=/, 'sync-yjs.js must expose read-only display accessor');
  assert.match(source, /API\.estadoCatalogoPublicoCertificado\s*=/, 'sync-yjs.js must expose safe diagnostic status');
  assert.match(source, /API\.catalogoPublicoLector\.cerrar\(\)/, 'visibility/BFCache/destroy must tear down certified reader');
  const rollout = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/sync-rollout.json'), 'utf8'));
  assert.equal(Object.values(rollout.licenses).filter(x => 'yparty' in x).length, 0, 'rollout remains OFF');
});

test('C13 blocks certified reader until legacy shadow recovery, IDB and Yjs causal completeness pass', async () => {
  const h = makeController({legadoListo: false, idbSynced: false});
  try {
    assert.equal(await h.ctrl.intentar(), false);
    assert.equal(h.calls.length, 0, 'never call C12 before legacy shadow + IDB are ready');
    assert.equal(h.ctrl.leer(), null);

    h.setIdbSynced(true);
    assert.equal(await h.ctrl.intentar(), false);
    assert.equal(h.calls.length, 0, 'Ultrareview #2: IDB alone never unlocks before legacy shadow');

    h.setLegadoListo(true);
    h.doc.store.pendingStructs = {client: 1};
    assert.equal(await h.ctrl.intentar(), false);
    assert.equal(h.calls.length, 0, 'causal debt (pendingStructs) blocks certified reader');
    h.doc.store.pendingStructs = null;

    h.doc.store.pendingDs = {client: 2};
    assert.equal(await h.ctrl.intentar(), false);
    assert.equal(h.calls.length, 0, 'causal debt (pendingDs) blocks certified reader');
    h.doc.store.pendingDs = null;

    assert.equal(await h.ctrl.intentar(), true);
    assert.equal(h.calls.length, 1);
    const snap = h.ctrl.leer();
    assert.equal(snap.readOnly, true);
    assert.equal(snap.frozenHead, 'certified-qa-head-c13');
    assert.equal(snap.productos.p1.stockActual, 4);
    assert.equal('_meta' in snap, false);
    assert.equal('ventas' in snap, false);
    assert.equal(h.doc.getMap('_meta').get('pinsRol').owner, 'NEVER_LEAK', 'private Sync3 doc untouched');
  } finally { h.doc.destroy(); }
});

test('C13 single-flight prevents duplicate certified readers and never spawns a second writer', async () => {
  let resolveSession;
  let openCount = 0;
  const h = makeController({
    sessionImpl: () => new Promise(res => {
      resolveSession = res;
      openCount++;
    })
  });
  try {
    const p1 = h.ctrl.intentar();
    const p2 = h.ctrl.intentar();
    assert.equal(openCount, 1, 'concurrent intentar() must be single-flight');
    resolveSession(Object.freeze({
      frozenHead: 'certified-qa-head-c13',
      readOnly: true,
      display: () => Object.freeze({productos: {p1: {id: 'p1', precio: 15}}, ubicaciones: {}}),
      close() {}
    }));
    assert.equal(await p1, true);
    assert.equal(await p2, true);
    assert.equal(await h.ctrl.intentar(), true, 'already certified same head reuses active session');
    assert.equal(h.calls.length, 1);
  } finally { h.doc.destroy(); }
});

test('C13 hidden tab, BFCache teardown and in-flight cancellation close public session cleanly', async () => {
  let resolveLate;
  let lateClosed = 0;
  const h = makeController({
    sessionImpl: () => new Promise(res => { resolveLate = res; })
  });
  try {
    const inflight = h.ctrl.intentar();
    h.setHidden(true);
    h.ctrl.cerrar();
    resolveLate(Object.freeze({
      frozenHead: 'certified-qa-head-c13',
      readOnly: true,
      display: () => Object.freeze({productos: {}, ubicaciones: {}}),
      close() { lateClosed++; }
    }));
    assert.equal(await inflight, false, 'stale async resolution after hidden/cerrar must NOT attach');
    assert.equal(lateClosed, 1, 'stale resolved session must be closed immediately');
    assert.equal(h.ctrl.leer(), null);
    assert.equal(await h.ctrl.intentar(), false, 'hidden browser must never request a ticket');
    assert.equal(h.calls.length, 1);
  } finally { h.doc.destroy(); }
});

test('C13 fail-closed on C12 rejection enforces cooldown and caps retries without touching legacy', async () => {
  const h = makeController({
    sessionImpl: async () => { throw new Error('certified read-only catalog unavailable'); }
  });
  try {
    assert.equal(await h.ctrl.intentar(), false);
    assert.equal(h.ctrl.estado().estado, 'error');
    assert.equal(h.ctrl.leer(), null);
    assert.equal(h.calls.length, 1);

    // Immediate retry must be suppressed by cooldown (no ticket storm)
    assert.equal(await h.ctrl.intentar(), false);
    assert.equal(h.calls.length, 1);

    // After backoff passes, retries up to cap then stops for same head
    h.advanceMs(31000);
    assert.equal(await h.ctrl.intentar(), false);
    assert.equal(h.calls.length, 2);

    h.advanceMs(120000);
    assert.equal(await h.ctrl.intentar(), false);
    assert.equal(h.calls.length, 3);

    h.advanceMs(600000);
    assert.equal(await h.ctrl.intentar(), false);
    assert.equal(h.calls.length, 3, 'retry cap prevents infinite /ws/ticket loop for a failing head');
  } finally { h.doc.destroy(); }
});

test('C13 rejects missing/malformed frozenHead before touching C12 or network', async () => {
  for (const bad of [null, '', 'x', '../etc/passwd', 'has spaces']) {
    const h = makeController({head: bad});
    try {
      assert.equal(await h.ctrl.intentar(), false);
      assert.equal(h.calls.length, 0);
      assert.equal(h.ctrl.estado().estado, 'sin-head');
    } finally { h.doc.destroy(); }
  }
});

test('C13 _politicaRollout exposes validated frozenHead ONLY for approved yparty per-license entry', async () => {
  const ps = source.indexOf('  async function _politicaRollout(codigo) {');
  const pe = source.indexOf('\n  function _compactarYjsSinCambiarCausalidad(', ps);
  assert.ok(ps >= 0 && pe > ps);
  const QA = 'F123-SYNT-C130-STORE';
  const key = crypto.createHash('sha256').update('friendly123-rollout-v1:' + QA).digest('hex');
  async function evalPolicy(cfg) {
    const ctx = vm.createContext({
      crypto: crypto.webcrypto, TextEncoder, Uint8Array, Array, Number, Promise, setTimeout,
      fetch: async () => ({ok: true, json: async () => cfg})
    });
    vm.runInContext(source.slice(ps, pe), ctx);
    ctx.__c = QA;
    return vm.runInContext('_politicaRollout(__c)', ctx);
  }
  const ok = await evalPolicy({
    schema: 1, stage: 'owner-canary',
    licenses: {[key]: {stage: 'owner-canary', approved: true, yparty: true, frozenHead: 'head-qa-01'}}
  });
  assert.equal(ok.yparty, true);
  assert.equal(ok.frozenHead, 'head-qa-01');

  const noYparty = await evalPolicy({
    schema: 1, stage: 'owner-canary',
    licenses: {[key]: {stage: 'owner-canary', approved: true, yparty: false, frozenHead: 'head-qa-01'}}
  });
  assert.equal(noYparty.frozenHead, null, 'frozenHead must be ignored when yparty is OFF');

  const badHead = await evalPolicy({
    schema: 1, stage: 'owner-canary',
    licenses: {[key]: {stage: 'owner-canary', approved: true, yparty: true, frozenHead: 'bad head!'}}
  });
  assert.equal(badHead.frozenHead, null, 'malformed frozenHead must fail closed');
});
