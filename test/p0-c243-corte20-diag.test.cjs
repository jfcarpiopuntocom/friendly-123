'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SYNC_FILE = path.join(__dirname, '..', 'docs', 'sync-yjs.js');
const syncSrc = fs.readFileSync(SYNC_FILE, 'utf8');

function extractBlock(startMarker, endMarker) {
  const s = syncSrc.indexOf(startMarker);
  const e = syncSrc.indexOf(endMarker, s);
  assert.ok(s >= 0 && e > s, `missing block ${startMarker} -> ${endMarker}`);
  return syncSrc.slice(s, e);
}

test('C243: 2.0 cutover failure records non-empty diagnostic reason without silent swallow', async () => {
  const snippet = extractBlock('    function _intentarActivarCorte20SiElegible() {', '    function sincronizarVisibilidad() {');
  const API = {
    estado: 'activo',
    canal: { reanudar() {}, pausar() {} },
    fotosCanal: { reanudar() {}, pausar() {} },
    opsCanal: { reanudar() {}, pausar() {} },
    canalSombra: null,
    canalPiloto: { tipo: 'piloto' },
    catalogoPublicoLector: null,
    coordinadorCorte20: null,
    modoCorte20Activo: false,
    rollout: { yparty: true, frozenHead: 'fb-deadbeef' },
    idb: { synced: true },
    opsIdb: { synced: true },
    doc: { isDestroyed: false, store: null },
    codigoCuaderno: 'F123-TEST-1234',
    corte20QaHabilitado: () => true,
    async activarCorte20Runtime() {
      throw new Error('certified baseline mismatch');
    }
  };
  const fn = new Function(
    'API', 'document', 'window', 'localStorage', 'timerRetorno', 'retornoEnCurso',
    'canalesPiloto', 'programarRetorno', 'clearTimeout', 'setTimeout',
    snippet.replace(/\n    API\.canal\.conectar\(\);[\s\S]*?(?=\n    API\.corte20QaHabilitado =)/m, '') +
    '\nreturn { intentar: _intentarActivarCorte20SiElegible };'
  );
  const win = {
    addEventListener() {},
    OCAuth: { esDemo: () => false, rolActual: () => 'dueno' },
    OCSyncControl: {
      async pausarParaArquitectura20() { return { ok: true }; },
      reanudarDesdeArquitectura20() {}
    }
  };
  const res = fn(API, { hidden: false, addEventListener() {} }, win, { getItem: () => null }, null, false, [], () => {}, clearTimeout, setTimeout);
  await res.intentar();
  await new Promise(r => setTimeout(r, 30));

  assert.equal(API.modoCorte20Activo, false);
  assert.ok(API.__ultimoEstadoCorte20 && API.__ultimoEstadoCorte20.activo === false &&
    typeof API.__ultimoEstadoCorte20.motivo === 'string' && API.__ultimoEstadoCorte20.motivo.length > 0,
    'expected non-empty diagnostic reason when 2.0 cutover fails silently');
  assert.ok(syncSrc.includes('corte20: this.__ultimoEstadoCorte20 || null'), '_diag must expose corte20');
});
