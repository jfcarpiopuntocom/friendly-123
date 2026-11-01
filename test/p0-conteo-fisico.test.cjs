'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const crypto = webcrypto;
function awaitImport() { return import('../docs/physical-count.mjs'); }
const gen = () => crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const base = { productId:'synthetic-product', deviceId:'PC', epochId:'epoch-1', cantidad:7, ts:1, frontierOpIds:['a'] };
test('a verified causal successor is proposed; never automatically applied', async () => {
  const { snapshotFirmado, ultimoConteoManda } = await awaitImport();
  const A=await gen(), B=await gen(), first=await snapshotFirmado(base,A.privateKey,crypto.subtle);
  const second=await snapshotFirmado({...base, deviceId:'PWA', cantidad:5, ts:2, prevHash:first.hash,
    frontierOpIds:['a','b']},B.privateKey,crypto.subtle);
  const keys=new Map([['PC',A.publicKey],['PWA',B.publicKey]]);
  const result=await ultimoConteoManda(first,second,{keys,causalProof:async(child,ancestor)=>
    child.frontierOpIds.includes('b') && ancestor.frontierOpIds.includes('a'),subtle:crypto.subtle});
  assert.equal(result.status,'sucesor-causal-verificado');
  assert.equal(result.winner.hash,second.hash);assert.equal(result.applied,false);
  assert.equal(result.preserved.length,2);
});
test('concurrent or merely newer wall-clock count never wins', async()=>{
  const {snapshotFirmado,ultimoConteoManda}=await awaitImport();
  const A=await gen(),B=await gen();
  const a=await snapshotFirmado(base,A.privateKey,crypto.subtle);
  const b=await snapshotFirmado({...base,deviceId:'PWA',ts:999999,cantidad:18,frontierOpIds:['x']},B.privateKey,crypto.subtle);
  const keys=new Map([['PC',A.publicKey],['PWA',B.publicKey]]);
  const r=await ultimoConteoManda(a,b,{keys,causalProof:()=>false,subtle:crypto.subtle});
  assert.equal(r.status,'conflicto-sin-prueba');assert.equal(r.winner,null);
});
test('hash alone is not a signature: tampering/unknown device fail closed',async()=>{
  const {snapshotFirmado,verificarConteo,ultimoConteoManda}=await awaitImport();
  const A=await gen(),b=await snapshotFirmado(base,A.privateKey,crypto.subtle);
  assert.equal(await verificarConteo(b,A.publicKey,crypto.subtle),true);
  const fake={...b,cantidad:18};
  assert.equal(await verificarConteo(fake,A.publicKey,crypto.subtle),false);
  const result=await ultimoConteoManda(b,fake,{keys:new Map([['PC',A.publicKey]]),
    causalProof:()=>true,subtle:crypto.subtle});
  assert.equal(result.status,'firma-o-dispositivo-no-validado');assert.equal(result.winner,null);
  const unknown=await ultimoConteoManda(b,b,{keys:new Map(),causalProof:()=>true,subtle:crypto.subtle});
  assert.equal(unknown.status,'firma-o-dispositivo-no-validado');
});
