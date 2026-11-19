'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs', 'mock-backend.js'), 'utf8');

function extractFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start > -1, `could not find ${signature} in docs/mock-backend.js`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  let inSingle = false, inDouble = false, inTpl = false, escaped = false;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && (inSingle || inDouble || inTpl)) { escaped = true; continue; }
    if (!inDouble && !inTpl && ch === "'") { inSingle = !inSingle; continue; }
    if (!inSingle && !inTpl && ch === '"') { inDouble = !inDouble; continue; }
    if (!inSingle && !inDouble && ch === '`') { inTpl = !inTpl; continue; }
    if (inSingle || inDouble || inTpl) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function ${signature}`);
}

function buildHarness({ confirmedInIdb = () => true, liveState }) {
  const fnHuella = extractFunction(SRC, '  function _huellaPublicable(');
  const fnPuede = extractFunction(SRC, '  function _estadoPuedePublicarse(');
  const fnSinFotos = extractFunction(SRC, '  function _estadoParaGuardarSinFotos(');

  const ctx = {
    window: {
      OCFotos: {
        tieneFotoHashConfirmadoEnIdb: confirmedInIdb
      }
    },
    _estadoLecturaBloqueada: false,
    _guardadoCatalogoPendiente: Promise.resolve(true),
    _ultimoGuardadoPublicable: true,
    _estadoPublicableConfirmado: null,
    estadoActualExportable: () => liveState,
    JSON,
    Object,
    Array
  };

  vm.runInNewContext(`${fnSinFotos}\n${fnHuella}\n${fnPuede}`, ctx);
  return {
    ctx,
    commitCurrentSnapshot() {
      // Mirrors docs/mock-backend.js lines 1731-1732 & 1751:
      const crudo = JSON.stringify(ctx._estadoParaGuardarSinFotos(liveState));
      ctx._estadoPublicableConfirmado = JSON.parse(crudo);
    },
    setLiveState(next) {
      liveState = next;
    }
  };
}

const PHOTO_A = 'data:image/jpeg;base64,' + 'A'.repeat(64);
const PHOTO_B = 'data:image/jpeg;base64,' + 'B'.repeat(64);
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

test('1. confirmed IDB photo hydrated in RAM matches pruned committed snapshot while save is in flight', () => {
  const live = {
    _rev: 12,
    _abCommit: 'tok-1',
    productos: [{ id: 'p1', nombre: 'Aretes', stock: 5, fotoHash: HASH_A, fotoRev: 1, foto: PHOTO_A }],
    ubicaciones: [{ id: 'u1', nombre: 'Percha 1', fotoHash: HASH_A, fotoRev: 1, foto: PHOTO_A }]
  };
  const h = buildHarness({
    confirmedInIdb: (hash, data) => hash === HASH_A && data === PHOTO_A,
    liveState: live
  });
  h.commitCurrentSnapshot();
  assert.equal(h.ctx._estadoPublicableConfirmado.productos[0].foto, undefined, 'committed snapshot must have pruned photo');
  assert.equal(
    h.ctx._estadoPuedePublicarse(),
    true,
    'RAM identical to committed snapshot with IDB-confirmed hydrated photos must remain publishable during in-flight save'
  );
});

test('2. unconfirmed photo edit in RAM fails closed (_estadoPuedePublicarse === false)', () => {
  const live = {
    _rev: 12,
    productos: [{ id: 'p1', nombre: 'Aretes', stock: 5, fotoHash: HASH_A, fotoRev: 1, foto: PHOTO_A }],
    ubicaciones: []
  };
  const h = buildHarness({
    confirmedInIdb: (hash, data) => hash === HASH_A && data === PHOTO_A,
    liveState: live
  });
  h.commitCurrentSnapshot();

  // New photo bytes in RAM NOT confirmed in IDB yet
  h.setLiveState({
    _rev: 12,
    productos: [{ id: 'p1', nombre: 'Aretes', stock: 5, fotoHash: HASH_A, fotoRev: 1, foto: PHOTO_B }],
    ubicaciones: []
  });
  assert.equal(h.ctx._estadoPuedePublicarse(), false, 'unconfirmed photo bytes must never match confirmed snapshot');
});

test('3. business or pointer change (stock, fotoHash, fotoRev) fails closed (_estadoPuedePublicarse === false)', () => {
  const live = {
    _rev: 12,
    productos: [{ id: 'p1', nombre: 'Aretes', stock: 5, fotoHash: HASH_A, fotoRev: 1, foto: PHOTO_A }],
    ubicaciones: []
  };
  const h = buildHarness({
    confirmedInIdb: (hash, data) => (hash === HASH_A && data === PHOTO_A) || (hash === HASH_B && data === PHOTO_B),
    liveState: live
  });
  h.commitCurrentSnapshot();

  h.setLiveState({
    _rev: 12,
    productos: [{ id: 'p1', nombre: 'Aretes', stock: 4, fotoHash: HASH_A, fotoRev: 1, foto: PHOTO_A }],
    ubicaciones: []
  });
  assert.equal(h.ctx._estadoPuedePublicarse(), false, 'stock mutation must never match old snapshot');

  h.setLiveState({
    _rev: 12,
    productos: [{ id: 'p1', nombre: 'Aretes', stock: 5, fotoHash: HASH_B, fotoRev: 2, foto: PHOTO_B }],
    ubicaciones: []
  });
  assert.equal(h.ctx._estadoPuedePublicarse(), false, 'fotoHash/fotoRev pointer mutation must never match old snapshot');
});

test('4. OCFotos bridge throwing during in-flight check fails closed without crashing', () => {
  const live = {
    _rev: 12,
    productos: [{ id: 'p1', nombre: 'Aretes', stock: 5, fotoHash: HASH_A, fotoRev: 1, foto: PHOTO_A }],
    ubicaciones: []
  };
  let shouldThrow = false;
  const h = buildHarness({
    confirmedInIdb: (hash, data) => {
      if (shouldThrow) throw new Error('IDB bridge unavailable');
      return hash === HASH_A && data === PHOTO_A;
    },
    liveState: live
  });
  h.commitCurrentSnapshot();
  shouldThrow = true;
  assert.equal(h.ctx._estadoPuedePublicarse(), false, 'throwing IDB check must fail closed cleanly');
});
