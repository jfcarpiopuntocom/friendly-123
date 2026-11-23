'use strict';
// C99 RED->GREEN: after C94 disarms API.modoCorte20Activo=false on Safari hide/pagehide,
// returning to visible foreground (visibilitychange/pageshow) must re-run the guarded
// activarCorte20Runtime({ cortarComercio: true }) path so Owner/Admin 2.0 commercial
// dispatch resumes cleanly without needing a hard page reload, and without bypassing C38.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const syncSrc = fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8');

function extractBlock(startMarker, endMarker) {
  const start = syncSrc.indexOf(startMarker);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  const end = syncSrc.indexOf(endMarker, start);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return syncSrc.slice(start, end);
}

test('C99 RED->GREEN: Safari foreground visibilitychange re-arms commercial 2.0 via full activarCorte20Runtime when eligible', async () => {
  const snippet = extractBlock('    function _intentarActivarCorte20SiElegible() {', '    API.estado = "activo";');
  let hidden = false;
  let activations = 0;
  const listeners = { doc: {}, win: {} };
  const API = {
    canal: { reanudar() {}, pausar() {} },
    fotosCanal: { reanudar() {}, pausar() {} },
    opsCanal: { reanudar() {}, pausar() {} },
    canalSombra: null,
    canalPiloto: { tipo: 'piloto' },
    catalogoPublicoLector: { intentar() {}, cerrar() {} },
    coordinadorCorte20: { mode: 'failback-legacy-1.0' },
    modoCorte20Activo: false,
    async activarCorte20Runtime(opc) {
      activations++;
      assert.equal(opc?.cortarComercio, true);
      API.modoCorte20Activo = true;
      return API.coordinadorCorte20;
    }
  };
  const fn = new Function(
    'API', 'document', 'window', 'localStorage', 'timerRetorno', 'retornoEnCurso',
    'canalesPiloto', 'programarRetorno', 'clearTimeout', 'setTimeout',
    snippet.replace(/\n    API\.canal\.conectar\(\);[\s\S]*?(?=\n    API\.corte20QaHabilitado =)/m, '') + '\nreturn { sincronizarVisibilidad };'
  );
  const fakeLocalStorage = {
    getItem(k) {
      return (k === 'f123_yparty_qa' || k === 'f123_corte20_qa') ? '1' : null;
    }
  };
  const fakeDoc = {
    get hidden() { return hidden; },
    addEventListener(name, cb) { listeners.doc[name] = cb; }
  };
  const fakeWin = {
    OCAuth: { esDemo: () => false, rolActual: () => 'dueno' },
    addEventListener(name, cb) { listeners.win[name] = cb; }
  };

  // Run block with explicit helper + startup disabled except bootstrap function evaluation
  const { sincronizarVisibilidad } = fn(
    API, fakeDoc, fakeWin, fakeLocalStorage, null, false, [], () => {}, clearTimeout, setTimeout
  );

  // Initial startup armed once; now simulate C94 hide/pagehide disarming modoCorte20Activo.
  await new Promise((r) => setTimeout(r, 10));
  const afterStart = activations;
  hidden = true;
  API.modoCorte20Activo = false;
  sincronizarVisibilidad();
  assert.equal(activations, afterStart);

  // User unlocks iPhone / returns to foreground -> must re-arm via activarCorte20Runtime.
  hidden = false;
  sincronizarVisibilidad();
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(activations, afterStart + 1, 'foreground return after C94 failback must call activarCorte20Runtime');
  assert.equal(API.modoCorte20Activo, true);

  // C213 (JFC 22 nov 2026: "TODOS PASAN A LO BUENO"): an employee session ALSO re-arms 2.0 on foreground.
  API.modoCorte20Activo = false;
  fakeWin.OCAuth.rolActual = () => 'empleado';
  sincronizarVisibilidad();
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(activations, afterStart + 2, 'employee session must re-arm 2.0 like owner/admin');
});
