const { test } = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../docs/core/shelf-photo-policy.js');

test('hex photo policy: current pointer is authoritative and never reattached from fallback', () => {
  const p = policy.planear({
    currentHash: 'hash-current',
    yjsHash: 'hash-yjs-old',
    historyHashes: ['hash-history'],
    perIdHash: 'hash-local'
  });
  assert.equal(p.modo, 'pointer-vigente');
  assert.equal(p.pointerActual, 'hash-current');
  assert.equal(p.puedeReatachar, false);
  assert.deepEqual(p.candidatosReatachar, []);
  assert.deepEqual(p.destruir, []);

  const d = policy.decidirPointerVigente(p, { hashDisponible:false, perIdDisponible:true });
  assert.equal(d.usarFallbackPorId, true);
  assert.equal(d.reatacharHash, null);
  assert.deepEqual(d.destruir, []);
});

test('hex photo policy: missing pointer orders exact evidence deterministically', () => {
  const p = policy.planear({
    currentHash: null,
    yjsHash: 'hash-yjs',
    historyHashes: ['hash-new', 'hash-old', 'hash-yjs'],
    perIdHash: 'hash-local'
  });
  assert.equal(p.modo, 'pointer-perdido');
  assert.deepEqual(p.candidatosReatachar, [
    { hash:'hash-yjs', fuente:'yjs-actual' },
    { hash:'hash-new', fuente:'yjs-historial' },
    { hash:'hash-old', fuente:'yjs-historial' },
    { hash:'hash-local', fuente:'bytes-por-id' }
  ]);
  assert.deepEqual(policy.primerCandidatoDisponible(p, ['hash-old','hash-local']), { hash:'hash-old', fuente:'yjs-historial' });
});

test('Prime Directive 1AAA: domain does not expose destructive photo evidence action', () => {
  assert.equal(policy.permiteDestruirEvidencia('render'), false);
  assert.equal(policy.permiteDestruirEvidencia('sync'), false);
  assert.equal(policy.permiteDestruirEvidencia('repair'), false);
  assert.equal(policy.permiteDestruirEvidencia('anything'), false);
});
