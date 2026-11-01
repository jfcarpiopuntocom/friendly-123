'use strict';
// JFC 2026-11-01 (contract change, explicit order): NO device is ever wiped. A reset can never be applied to
// customers, so the JFC licence must prove the same path they will use: keep the v636 room, keep local data
// and pending logs, and absorb/synchronise them. Previous S2 (one-shot wipe + new epoch room) is cancelled.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const sync=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const backend=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
// Published v636 (795635ea) uses this exact JFC room suffix (verified from its docs/sync-yjs.js); CI is a shallow clone.
const V636_SUFIJO='::limpio-2026-09-16';
const sufijo=s=>(s.match(/\? \(codigo \+ "(::[^"]+)"\) : codigo;/)||[])[1];
test('JFC licence stays in the SAME room as published v636 (its data lives there)',()=>{
  assert.equal(sufijo(sync),V636_SUFIJO);
  assert.doesNotMatch(sync,/jfc-test-epoch-2026-11-01"\) : codigo/);
});
test('S2 reset implementation is absent; compatibility hook is inert and local state still loads',()=>{
  assert.doesNotMatch(backend, /_prepararCorteJfcS2|S2_REINICIO_ACTIVO|_esLicenciaJfcParaS2|f123_jfc_s2_epoch_20261101|__f123JfcResetReady/);
  assert.match(backend, /window\.__f123PrepareJfcReset = function \(\) \{ return false; \};/);
  assert.match(backend, /let _demoRefrescado = false;\s*try \{ cargarEstadoLocal\(\); \} catch/);
  assert.doesNotMatch(backend, /OCEstadoIDB\.borrar\(\)/);
});
test('causal movement witnesses stay enabled for the JFC canary licence',()=>{
  assert.match(sync,/API\.esLicenciaPruebaJfc = _salaId !== codigo;/);
});
