'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SYNC_YJS_PATH = path.join(ROOT, 'docs', 'sync-yjs.js');
const MOCK_BACKEND_PATH = path.join(ROOT, 'docs', 'mock-backend.js');

function extractC42SyncDispatch(syncSrc) {
  const sRec = syncSrc.indexOf('    API.recibosComerciales20 = new Map();');
  const eRec = syncSrc.indexOf('    if (piloto && typeof piloto.crearCoordinadorCorte20 === "function") {', sRec);
  const sDisp = syncSrc.indexOf('      API.despacharOpComercialCertificada = function (comando) {', eRec);
  const eDisp = syncSrc.indexOf('      // C29:', sDisp);
  assert.ok(sRec > 0 && eRec > sRec, 'C40 recibosComerciales20 block not found');
  assert.ok(sDisp > 0 && eDisp > sDisp, 'despacharOpComercialCertificada block not found');
  return { rec: syncSrc.slice(sRec, eRec), disp: syncSrc.slice(sDisp, eDisp) };
}

function extractC42MockHandler(mockSrc) {
  const s = mockSrc.indexOf('  function _aplicarEstadoReciboDo20(detail) {');
  assert.ok(s > 0, 'C42 _aplicarEstadoReciboDo20 not found in docs/mock-backend.js');
  const e = mockSrc.indexOf('  // C42_END', s);
  assert.ok(e > s, 'C42_END marker not found in docs/mock-backend.js');
  return mockSrc.slice(s, e);
}

test('C42: exact-source checkout receipt status handles 200 committed, 202 stored-for-application, 409 quarantine, fallbackLegacy, and Promise reject without false ACK', async () => {
  const syncSrc = fs.readFileSync(SYNC_YJS_PATH, 'utf8');
  const mockSrc = fs.readFileSync(MOCK_BACKEND_PATH, 'utf8');

  const { rec, disp } = extractC42SyncDispatch(syncSrc);
  const mockHandler = extractC42MockHandler(mockSrc);

  const emitted = [];
  const ventas = [
    { id: 'v1', opId: 'op_c42_ok_0001' },
    { id: 'v2', opId: 'op_c42_202_0002' },
    { id: 'v3', opId: 'op_c42_409_0003' },
    { id: 'v4', opId: 'op_c42_rej_0004' },
    { id: 'v5', opId: 'op_c42_fb_0005' }
  ];
  let saves = 0;

  let nextSubmit = async () => { throw new Error('unset'); };
  const listeners = new Map();
  const window = {
    addEventListener(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev).add(fn);
    },
    dispatchEvent(ev) {
      if (ev?.type === 'oc-op-20-recibo') emitted.push(ev.detail);
      for (const fn of listeners.get(ev?.type) || []) fn(ev);
    }
  };

  const ctx = vm.createContext({
    window,
    CustomEvent: class CustomEvent { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    ventas,
    _mergeSucio: false,
    _guardarMergePendienteYa() { saves++; },
    __submitMock: cmd => nextSubmit(cmd)
  });

  const rt = vm.runInContext(`
    (function () {
      var API = {
        coordinadorCorte20: { submitCommercial: __submitMock }
      };
      ${rec}
      ${disp}
      ${mockHandler}
      return { API: API };
    })()
  `, ctx);

  // 1) 200 business-committed
  nextSubmit = async cmd => ({
    committed: true,
    receipt: { opId: cmd.opId, receiptId: 'a'.repeat(24), stage: 'business-committed', acceptedAt: 1700000001000 }
  });
  await rt.API.despacharOpComercialCertificada({ opId: 'op_c42_ok_0001' });
  assert.equal(ventas[0].reciboDo20.estado, 'confirmado-do');
  assert.equal(ventas[0].reciboDo20.committed, true);
  assert.equal(ventas[0].reciboDo20.receiptId, 'a'.repeat(24));

  // 2) 202 stored-for-application / reconcileRequired -> NEVER committed: true
  nextSubmit = async cmd => ({
    committed: false,
    reconcileRequired: true,
    receipt: { opId: cmd.opId, receiptId: 'b'.repeat(24), stage: 'stored-for-application', acceptedAt: 1700000002000 }
  });
  await rt.API.despacharOpComercialCertificada({ opId: 'op_c42_202_0002' });
  assert.equal(ventas[1].reciboDo20.estado, 'pendiente-reconciliacion-do');
  assert.equal(ventas[1].reciboDo20.committed, false);
  assert.equal(ventas[1].reciboDo20.reconcileRequired, true);

  // 3) 409 conflict-quarantine
  nextSubmit = async () => ({ committed: false, quarantine: true, stage: 'conflict-quarantine' });
  await rt.API.despacharOpComercialCertificada({ opId: 'op_c42_409_0003' });
  assert.equal(ventas[2].reciboDo20.estado, 'cuarentena-do');
  assert.equal(ventas[2].reciboDo20.committed, false);
  assert.equal(ventas[2].reciboDo20.quarantine, true);

  // 4) Promise reject -> emits dispatch-rejected, NEVER claims remote commit
  nextSubmit = async () => { throw new Error('network down'); };
  await assert.rejects(() => rt.API.despacharOpComercialCertificada({ opId: 'op_c42_rej_0004' }), /network down/);
  const rejRecibo = rt.API.obtenerReciboComercial20('op_c42_rej_0004');
  assert.equal(rejRecibo.committed, false);
  assert.equal(rejRecibo.reconcileRequired, true);
  assert.equal(rejRecibo.stage, 'dispatch-rejected');
  assert.equal(ventas[3].reciboDo20.estado, 'rechazado-sin-confirmar');
  assert.equal(ventas[3].reciboDo20.committed, false);

  // 5) fallbackLegacy
  nextSubmit = async () => ({ committed: false, fallbackLegacy: true, stage: 'fallback-legacy' });
  await rt.API.despacharOpComercialCertificada({ opId: 'op_c42_fb_0005' });
  assert.equal(ventas[4].reciboDo20.estado, 'respaldo-local');
  assert.equal(ventas[4].reciboDo20.committed, false);
  assert.equal(ventas[4].reciboDo20.fallbackLegacy, true);

  assert.equal(emitted.length, 5);
  assert.equal(saves, 5);
});
