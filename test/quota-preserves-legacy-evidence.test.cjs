"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {browser} = require('./helpers/browser.cjs');
const src = fs.readFileSync(path.join(__dirname, '../docs/mock-backend.js'), 'utf8');
const start = src.indexOf('  function _guardarEstadoLocalAhora(');
const end = src.indexOf('  function avisoEspacioJusto(', start);
const guard = src.slice(start, end);
const hold=app=>app.fetch('/api/config/retencion',{method:'PUT',body:JSON.stringify({dias:14})});

test('quota recovery retains historical photos, movements and every previous storage byte',async()=>{
  const app=browser();app.OCAuth={rolActual:()=> 'dueno'};
  const original=await app.request('/api/respaldo/exportar');
  original.ubicaciones[0].foto='data:image/jpeg;base64,SYNTHETIC-UNIQUE-PHOTO';
  original.movimientos.push({id:'synthetic-unique-history',tipo:'synthetic-history',fecha:'2026-01-01'});
  await app.request('/api/respaldo/importar','POST',original);
  app.localStorage.setItem('f123_foto_legacy_unique','SYNTHETIC-LEGACY-PHOTO');
  const stored=new Map(Array.from({length:app.localStorage.length},(_,i)=>app.localStorage.key(i)).map(k=>[k,app.localStorage.getItem(k)]));
  app.localStorage.setItem=()=>{throw new DOMException('synthetic quota','QuotaExceededError');};
  app.OCEstadoIDB={guardar:async()=>false};
  assert.equal((await hold(app)).status,507);
  for(const [key,value] of stored)assert.equal(app.localStorage.getItem(key),value,key+' remains byte-identical');
  const after=await app.request('/api/respaldo/exportar');
  assert.equal(after.ubicaciones[0].foto,original.ubicaciones[0].foto);
  assert.ok(after.movimientos.some(m=>m.id==='synthetic-unique-history'));
  assert.doesNotMatch(guard,/movimientos\.slice\(/,'never truncate forensic history to free quota');
  assert.doesNotMatch(guard,/archivarLote\(/,'never depend on an unacknowledged archive');
  assert.ok(app.__ocFallos.some(([,reason])=>reason==='memoria-llena'),'failed persistence is visible');
});

test('stale red warning clears only after an exact confirmed durable acknowledgement',async()=>{
  const app=browser();app.OCAuth={rolActual:()=> 'dueno'};
  let cleared=0;app.document.getElementById=id=>id==='oc-quota-aviso'?{remove(){cleared++;}}:null;
  app.localStorage.setItem=()=>{throw new DOMException('synthetic quota','QuotaExceededError');};
  let finish,started=false;
  app.OCEstadoIDB={guardar:()=>{started=true;return new Promise(resolve=>{finish=resolve;});}};
  const pending=hold(app);
  for(let i=0;i<12&&!started;i++)await Promise.resolve();
  assert.equal(started,true);assert.equal(cleared,0,'pending write cannot clear the warning');
  finish(false);assert.equal((await pending).status,507);assert.equal(cleared,0);
  app.OCEstadoIDB={guardar:async()=>true};
  assert.equal((await hold(app)).status,200);assert.equal(cleared,1);
});
