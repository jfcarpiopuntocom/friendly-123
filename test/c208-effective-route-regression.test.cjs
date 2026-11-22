'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const s=fs.readFileSync(path.join(__dirname,'../src/yparty-piloto.js'),'utf8');
test('private catalog does not claim YParty when privacy guard selects encrypted legacy',()=>{
  const guard=s.indexOf('// #765 fail-closed');
  const fallback=s.indexOf("rutaEfectiva = 'relay-cifrado-legado'",guard);
  const unreachable=s.indexOf('const getCredentials',guard);
  assert.ok(guard>=0 && fallback>guard && unreachable>fallback);
  assert.match(s,/get rutaEfectiva\(\) \{ return rutaEfectiva; \}/);
});
test('route state changes only with provider selection and failback',()=>{
  assert.match(s,/rutaEfectiva = 'yparty-autorizado';\s*enRespaldo = false;/);
  assert.match(s,/enRespaldo = true;\s*rutaEfectiva = 'relay-cifrado-legado';\s*cancelarPlazo\(\)/);
});
