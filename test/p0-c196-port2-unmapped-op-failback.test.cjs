'use strict';
// C196: execute the actual published sync-yjs.js event dispatcher, not a reimplementation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8');
const begin = source.indexOf('  function publicarOpLocal(op) {');
const end = source.indexOf('\n  var _tOps = null', begin);
assert.ok(begin >= 0 && end > begin, 'real op-local dispatcher must exist');
const real = source.slice(begin, end);
async function tick() { await new Promise(resolve => setImmediate(resolve)); }
function fixture({ translated = true, fallback = false, allowed = true, rejectFailback = false } = {}) {
  const observations = { delivered: 0, attempts: 0, failbacks: [], broadcastsWhile20: 0 };
  const entries = new Map();
  const api = {
    modoCorte20Activo: true,
    opsMap: {
      get: id => entries.get(id),
      set(id, op) {
        observations.attempts++;
        if (api.modoCorte20Activo) observations.broadcastsWhile20++;
        else observations.delivered++;
        entries.set(id, op);
      }
    },
    traducirOpLegadoAComando20: op => translated ? { opId: op.opId } : null,
    despacharOpComercialCertificada: () => Promise.resolve(fallback
      ? { committed: false, fallbackLegacy: true, stage: 'safe-rejection' }
      : { committed: true, fallbackLegacy: false, receipt: { stage: 'business-committed' } }),
    puedeDespacharOpEnLegado: () => Promise.resolve(allowed)
  };
  api.coordinadorCorte20 = {
    submitCommercial() {},
    async failbackToLegacy(reason) {
      observations.failbacks.push(reason);
      if (rejectFailback) throw Error('failed to close writer');
      api.modoCorte20Activo = false; // models real onModeChange after closing the writer
      return { mode: 'failback-legacy-1.0', reason };
    },
    canDispatchOnLegacy: () => Promise.resolve(allowed)
  };
  const publish = vm.runInNewContext(real + '\npublicarOpLocal', { API: api, Promise });
  return { api, publish, observations, entries };
}
const event = { opId: 'C196opid_12345', tipo: 'venta', payload: {} };
test('C196 unmapped op leaves 2.0 BEFORE entering the legacy Yjs bridge', async () => {
  const f = fixture({translated:false});
  f.publish(event); await tick(); await tick();
  assert.equal(f.observations.failbacks.length, 1);
  assert.equal(f.api.modoCorte20Activo, false);
  assert.equal(f.observations.broadcastsWhile20, 0);
  assert.equal(f.observations.delivered, 1);
});
test('C196 typed fallback closes -cat BEFORE original op enters old transport', async () => {
  const f = fixture({fallback:true});
  f.publish(event); await tick(); await tick();
  assert.equal(f.observations.failbacks.length, 1);
  assert.equal(f.observations.broadcastsWhile20, 0);
  assert.equal(f.observations.delivered, 1);
});
test('C196 durable same-DO fence refuses old-transport duplicate', async () => {
  const f = fixture({fallback:true,allowed:false});
  f.publish(event); await tick(); await tick();
  assert.equal(f.observations.failbacks.length, 1);
  assert.equal(f.observations.attempts, 0);
});
test('C196 failed writer closure NEVER publishes onto paused old relay', async () => {
  const f = fixture({translated:false,rejectFailback:true});
  f.publish(event); await tick(); await tick();
  assert.equal(f.api.modoCorte20Activo, true);
  assert.equal(f.observations.attempts, 0);
});
test('C196 committed typed sale stays on 2.0; no duplicate legacy delivery', async () => {
  const f = fixture({translated:true,fallback:false});
  f.publish(event); await tick(); await tick();
  assert.equal(f.observations.failbacks.length, 0);
  assert.equal(f.observations.attempts, 0);
  assert.equal(f.api.modoCorte20Activo, true);
});
