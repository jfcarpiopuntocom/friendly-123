'use strict';
// C68 (TDD RED -> GREEN): Real browser UI photo 2.0 cutover gaps:
// 1. docs/vista-perchas.js readSyncByHash recovers from OCYjs.fotoSha + fotosRefs
//    with SHA-256 integrity verification when legacy OCYjs.fotosMap is empty, and
//    rejects tampered bytes.
// 2. docs/sync-yjs.js oc-catalogo-cambiado triggers API.sembrarFotos() when
//    API.corteFotosShaActivo === true && API.fotoSha (no trigger when QA/cutover OFF).
// 3. docs/sync-yjs.js _instalarLectorFotoShaBajoDemanda resets remote read budget
//    when a new API.fotoSha bridge is installed across login sessions.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const vistaSrc = fs.readFileSync(path.join(root, 'docs/vista-perchas.js'), 'utf8');
const syncSrc = fs.readFileSync(path.join(root, 'docs/sync-yjs.js'), 'utf8');

function sha256DataUrl(dataUrl) {
  const b64 = String(dataUrl).split(',')[1] || '';
  return createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex');
}

function extractVistaReadSyncByHash() {
  const s = vistaSrc.indexOf('          readSyncByHash: async (hash) => {');
  const e = vistaSrc.indexOf('          preserveByHash: async (hash, bytes) => {', s);
  assert.ok(s > 0 && e > s, 'readSyncByHash block must exist in docs/vista-perchas.js');
  const propSrc = vistaSrc.slice(s, e).replace(/,\s*$/, '');
  return propSrc;
}

test('C68.1: vista-perchas readSyncByHash recovers SHA-verified bytes from OCYjs.fotoSha when fotosMap is empty and rejects tampered bytes', async () => {
  const propSrc = extractVistaReadSyncByHash();
  const goodUrl = 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71, 1, 2, 3, 4]).toString('base64');
  const goodHash = sha256DataUrl(goodUrl);
  const badUrl = 'data:image/png;base64,' + Buffer.from([9, 9, 9, 9]).toString('base64');

  let served = goodUrl;
  const ctx = vm.createContext({
    window: {
      OCFotos: { hashDeDataUrl: async (d) => sha256DataUrl(d) },
      OCYjs: {
        fotosMap: new Map(),
        fotosRefs: new Map([[goodHash, { sha: goodHash, bytes: 8, tipo: 'image/png' }]]),
        fotoSha: {
          get: async (h) => (h === goodHash ? served : null)
        }
      }
    }
  });
  const ports = vm.runInContext(`({ ${propSrc} })`, ctx);

  // Valid bytes from -fotos DO -> recovered
  assert.equal(await ports.readSyncByHash(goodHash), goodUrl);

  // Tampered bytes from -fotos DO -> fail-closed null
  served = badUrl;
  assert.equal(await ports.readSyncByHash(goodHash), null);

  // Missing fotosRefs metadata -> fail-closed null
  ctx.window.OCYjs.fotosRefs.clear();
  served = goodUrl;
  assert.equal(await ports.readSyncByHash(goodHash), null);
});

test('C68.2: oc-catalogo-cambiado triggers sembrarFotos only when corteFotosShaActivo=true and fotoSha is active', () => {
  const s = syncSrc.indexOf('    window.addEventListener("oc-catalogo-cambiado", pedirSeed);');
  const e = syncSrc.indexOf('    window.addEventListener("oc-equipo-cambiado", pedirSeed);', s);
  assert.ok(s > 0 && e > s, 'oc-catalogo-cambiado seed block must exist in docs/sync-yjs.js');
  const snippet = syncSrc.slice(s, e);

  const listeners = new Map();
  let sembrarFotosCalls = 0;
  const API = {
    corteFotosShaActivo: false,
    fotoSha: { put: async () => {} },
    sembrarFotos: () => { sembrarFotosCalls += 1; }
  };
  const ctx = vm.createContext({
    API,
    pedirSeed: () => {},
    window: {
      addEventListener(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
      },
      dispatchEvent(ev) {
        for (const fn of listeners.get(ev.type) || []) fn(ev);
      }
    }
  });
  vm.runInContext(snippet, ctx);

  // OFF by default -> does not call sembrarFotos
  ctx.window.dispatchEvent({ type: 'oc-catalogo-cambiado' });
  assert.equal(sembrarFotosCalls, 0);

  // Active 2.0 photo cutover -> immediately schedules sembrarFotos on UI catalog/shelf save
  API.corteFotosShaActivo = true;
  ctx.window.dispatchEvent({ type: 'oc-catalogo-cambiado' });
  assert.equal(sembrarFotosCalls, 1);
});

test('C68.3: _instalarLectorFotoShaBajoDemanda resets remote read budget when a new API.fotoSha bridge is installed', async () => {
  const s = syncSrc.indexOf('    function _instalarLectorFotoShaBajoDemanda() {');
  const e = syncSrc.indexOf('    _instalarLectorFotoShaBajoDemanda();', s);
  assert.ok(s > 0 && e > s, '_instalarLectorFotoShaBajoDemanda must exist in docs/sync-yjs.js');
  const fnSrc = syncSrc.slice(s, e);

  const photos = [];
  for (let i = 0; i < 18; i++) {
    const url = 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71, i]).toString('base64');
    photos.push({ hash: sha256DataUrl(url), url });
  }
  const refs = new Map(photos.map((p) => [p.hash, { sha: p.hash, bytes: 5, tipo: 'image/png' }]));
  const localSaved = new Map();

  const makeBridge = () => ({
    get: async (h) => photos.find((p) => p.hash === h)?.url || null
  });

  const API = {
    doc: {},
    fotosRefs: refs,
    fotoSha: makeBridge()
  };
  const window = {
    OCFotos: {
      leerPorHash: async (h) => localSaved.get(h) || null,
      guardarPorHash: async (h, b) => { localSaved.set(h, b); return true; },
      hashDeDataUrl: async (d) => sha256DataUrl(d)
    },
    dispatchEvent: () => true
  };
  const ctx = vm.createContext({
    API,
    window,
    CustomEvent: class CustomEvent { constructor(t, o) { this.type = t; this.detail = o?.detail; } }
  });
  vm.runInContext(fnSrc, ctx);

  // Install session 1 and exhaust all 16 remote reads
  ctx._instalarLectorFotoShaBajoDemanda();
  for (let i = 0; i < 16; i++) {
    assert.equal(await window.OCFotos.leerPorHash(photos[i].hash), photos[i].url);
  }
  // 17th read in same session still respects per-session cap
  assert.equal(await window.OCFotos.leerPorHash(photos[16].hash), null);

  // Install NEW authenticated session bridge (e.g. oc-login) -> budget resets
  API.fotoSha = makeBridge();
  ctx._instalarLectorFotoShaBajoDemanda();
  assert.equal(await window.OCFotos.leerPorHash(photos[16].hash), photos[16].url);
});
