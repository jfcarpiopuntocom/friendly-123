'use strict';
// C52 (TDD RED -> GREEN):
// When 2.0 cutover flags are active (API.modoCorte20Activo === true /
// API.corteFotosShaActivo === true), legacy Yjs transport senders
// (API.canalSombra, API.fotosCanal, API.opsCanal) must be retired and stop
// broadcasting updates; when OFF or after failbackToLegacy (false), they resume.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const syncSrc = fs.readFileSync(path.join(root, 'docs/sync-yjs.js'), 'utf8');

function extractSnippet(startMarker, endMarker) {
  const s = syncSrc.indexOf(startMarker);
  const e = syncSrc.indexOf(endMarker, s);
  assert.ok(s > 0 && e > s, `Missing snippet: ${startMarker}`);
  return syncSrc.slice(s, e);
}

test('C52: legacy Yjs senders retire when modoCorte20Activo/corteFotosShaActivo=true and resume on failback', () => {
  const docSnippet = extractSnippet(
    '    API.doc.on("update", function (update, origin) {',
    '    // B3 (JFC 2026-09-10):'
  );
  const fotosSnippet = extractSnippet(
    '    API.fotosDoc.on("update", function (update, origin) {',
    '    // SYNC DE VENTAS/OPS'
  );
  const opsSnippet = extractSnippet(
    '    API.opsDoc.on("update", function (update, origin) {',
    '    // Publicar al doc de ops cada venta/movimiento local'
  );

  const handlers = {};
  const makeDoc = (name) => ({
    on(ev, fn) {
      if (ev === 'update') handlers[name] = fn;
    }
  });

  const sent = { canal: 0, canalSombra: 0, fotosCanal: 0, opsCanal: 0 };
  const API = {
    doc: makeDoc('doc'),
    fotosDoc: makeDoc('fotosDoc'),
    opsDoc: makeDoc('opsDoc'),
    idb: {},
    fotosIdb: {},
    opsIdb: {},
    modoCorte20Activo: false,
    corteFotosShaActivo: false,
    canal: { enviarUpdate: () => { sent.canal += 1; } },
    canalSombra: { enviarUpdate: () => { sent.canalSombra += 1; } },
    fotosCanal: { enviarUpdate: () => { sent.fotosCanal += 1; } },
    opsCanal: { enviarUpdate: () => { sent.opsCanal += 1; } }
  };

  const ctx = vm.createContext({
    API,
    pedirVolcarFotos: () => {},
    pedirProcesarEventos: () => {}
  });
  vm.runInContext(`${docSnippet}\n${fotosSnippet}\n${opsSnippet}`, ctx);

  const fakeUpdate = new Uint8Array([1, 2, 3]);

  // 1. Cutover active -> legacy channels retired
  API.modoCorte20Activo = true;
  API.corteFotosShaActivo = true;
  handlers.doc(fakeUpdate, 'local');
  handlers.fotosDoc(fakeUpdate, 'local');
  handlers.opsDoc(fakeUpdate, 'local');

  assert.deepEqual(
    sent,
    { canal: 1, canalSombra: 0, fotosCanal: 0, opsCanal: 0 },
    'legacy canalSombra, fotosCanal, opsCanal must not send while 2.0 cutover is active'
  );

  // 2. Failback to legacy -> legacy channels resume
  API.modoCorte20Activo = false;
  API.corteFotosShaActivo = false;
  handlers.doc(fakeUpdate, 'local');
  handlers.fotosDoc(fakeUpdate, 'local');
  handlers.opsDoc(fakeUpdate, 'local');

  assert.deepEqual(
    sent,
    { canal: 2, canalSombra: 1, fotosCanal: 1, opsCanal: 1 },
    'legacy channels must resume after failbackToLegacy'
  );
});
