'use strict';
// JFC 2026-11-01 (contract change, explicit order): NO device is ever wiped. A reset can never be applied to
// customers, so the JFC licence must prove the same path they will use: keep the v636 room, keep local data
// and pending logs, and absorb/synchronise them. Previous S2 (one-shot wipe + new epoch room) is cancelled.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const sync=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const backend=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
const v636=cp.execFileSync('git',['show','795635ea0b0de262cd982d9a5dc828fd8cffcfba:docs/sync-yjs.js'],{encoding:'utf8',maxBuffer:64e6});
const sufijo=s=>(s.match(/\? \(codigo \+ "(::[^"]+)"\) : codigo;/)||[])[1];
test('JFC licence stays in the SAME room as published v636 (its data lives there)',()=>{
  assert.equal(sufijo(v636),'::limpio-2026-09-16');
  assert.equal(sufijo(sync),sufijo(v636));
  assert.doesNotMatch(sync,/jfc-test-epoch-2026-11-01"\) : codigo/);
});
test('the one-shot local wipe is disabled before any storage is touched',()=>{
  assert.match(backend,/const S2_REINICIO_ACTIVO = false;/);
  const i=backend.indexOf('function _prepararCorteJfcS2() {');
  assert.ok(i>0);
  assert.match(backend.slice(i,i+120),/if \(!S2_REINICIO_ACTIVO\) return false;/);
  assert.ok(backend.slice(i).indexOf('if (!S2_REINICIO_ACTIVO) return false;')<backend.slice(i).indexOf('_vaciarTiendaFresca()'));
});
test('causal movement witnesses stay enabled for the JFC canary licence',()=>{
  assert.match(sync,/API\.esLicenciaPruebaJfc = _salaId !== codigo;/);
});
