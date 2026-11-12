'use strict';
// The owner approved removing the 10-second cross-tab Web Locks queue in v620.
// These tests run the EXACT current _fetchConCandado closure, with a synthetic
// local backend. The global writer fence is the atomic IDB CAS contract, tested
// separately in p0-sales-atomic-idb-webkit-browser.test.cjs.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
const a=src.indexOf('  let _colaEscriturasLocal = Promise.resolve();');
const b=src.indexOf('  const _fetchInterno = async function',a);
assert.ok(a>0 && b>a,'extract real production local FIFO, not old Web Locks');
function fixture() {
  let writes=0,lockAttempts=0;
  const ctx={Response,URL,Promise,AbortController,
    _localRev:5,_localRevReservado:5,_estadoLecturaBloqueada:false,_conflictoEstadoAB:null,
    _ventaConfirmando:false,_payoutConfirmando:false,_retencionConfirmando:false,
    _ventaPendiente:null,_payoutPendiente:null,_retencionPendiente:null,
    _guardadoCatalogoPendiente:null,_estadoPublicableConfirmado:null,
    _negadoPorRol:()=>null,_rolLocal:()=> 'dueno',_recargarSiOtraPestanaEscribio:()=>{},
    validarRespaldo:()=>null,_huellaPublicable:()=> '{}',aplicarRespaldo:()=>{},
    _fetchInterno:()=>{writes++;return Promise.resolve(new Response('{"ok":true}',{status:200}))},
    window:{location:{origin:'https://fixture.invalid'},OC_AUTH_SESSION_EPOCH:0,
      OCTabSession:{isCurrent:()=>true},OCEstadoIDB:null},
    navigator:{locks:{request(){lockAttempts++;return new Promise(()=>{})}}}
  };
  const fetch=vm.runInNewContext('(function(){'+src.slice(a,b)+';return _fetchConCandado;})',ctx)();
  return {ctx,fetch,get writes(){return writes},get lockAttempts(){return lockAttempts}};
}
const post={method:'POST',body:'{}'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('owner-approved: normal sale does not wait for zombie Web Locks or 10-second timeout',async()=>{
  const f=fixture();
  assert.equal((await f.fetch('/api/ventas',post)).status,200);
  assert.equal(f.writes,1);assert.equal(f.lockAttempts,0);
});
test('tab-local writes are FIFO: second mutation waits for first confirmed result',async()=>{
  const f=fixture(),seen=[];let release;
  f.ctx._fetchInterno=()=>{seen.push(seen.length+1);return seen.length===1?
    new Promise(resolve=>{release=()=>resolve(new Response('{}',{status:200}))}):
    Promise.resolve(new Response('{}',{status:200}))};
  const one=f.fetch('/api/payouts',post),two=f.fetch('/api/payouts',post);
  await tick();assert.deepEqual(seen,[1]);
  release();assert.equal((await one).status,200);assert.equal((await two).status,200);
  assert.deepEqual(seen,[1,2]);assert.equal(f.lockAttempts,0);
});
// JFC order 2026-11-11 (real shop could not sell): the login EPOCH and the tab
// LEASE no longer reject a queued write. Only the ROLE does (real sign-out or a
// real role change). The two tests below replace the old ones that expected 403
// for an epoch change and for losing the tab lease; payouts, stock adjustments and
// expenses share this same guard, so one fixture covers them all.
test('a queued write still completes when only the login epoch changes (same role)',async()=>{
  const f=fixture();let release;let started=0;
  f.ctx._fetchInterno=()=>{started++;return new Promise(resolve=>{release=()=>resolve(new Response('{}',{status:200}))})};
  const one=f.fetch('/api/payouts',post),two=f.fetch('/api/payouts',post);
  await tick();f.ctx.window.OC_AUTH_SESSION_EPOCH=1;release();
  assert.equal((await one).status,200);
  await tick();release();
  assert.equal((await two).status,200);assert.equal(started,2);
});
test('a queued write is rejected with 403 when the role really changes before execution',async()=>{
  const f=fixture();let release;let started=0;
  f.ctx._fetchInterno=()=>{started++;return new Promise(resolve=>{release=()=>resolve(new Response('{}',{status:200}))})};
  const one=f.fetch('/api/payouts',post),two=f.fetch('/api/payouts',post);
  await tick();f.ctx._rolLocal=()=> '';release();
  const r2=await two;
  assert.equal((await one).status,200);assert.equal(r2.status,403);assert.equal(started,1);
  const cuerpo=await r2.text();
  assert.doesNotMatch(cuerpo,/Your session changed while this action was waiting/,'JFC 2026-11-12: forbidden message');
  assert.match(cuerpo,/Ask the owner or a manager/);
});
test('a queued mutation still completes when the tab loses the lease (sync-only concept)',async()=>{
  const f=fixture();let release,started=0,current=true;
  f.ctx.window.OCTabSession.isCurrent=()=>current;
  f.ctx._fetchInterno=()=>{started++;return new Promise(resolve=>{release=()=>resolve(new Response('{}',{status:200}))})};
  const one=f.fetch('/api/payouts',post),two=f.fetch('/api/payouts',post);
  await tick();current=false;release();
  assert.equal((await one).status,200);
  await tick();release();
  assert.equal((await two).status,200);assert.equal(started,2);
});
test('an unrecovered 507 is a 507, not a fabricated successful sale',async()=>{
  const f=fixture();
  f.ctx._fetchInterno=()=>new Response('{}',{status:507});
  assert.equal((await f.fetch('/api/productos/p1/venta',post)).status,507);
});
test('CAS retry after newer durable revision replays sale once, not indefinitely',async()=>{
  const f=fixture(),revs=[];let calls=0;
  f.ctx._fetchInterno=()=>{calls++;return new Response('{}',{status:calls===1?507:200})};
  f.ctx.window.OCEstadoIDB={leer:async()=>({_rev:6,productos:[],ubicaciones:[]})};
  f.ctx.aplicarRespaldo=x=>revs.push(x._rev);
  assert.equal((await f.fetch('/api/productos/p1/venta',post)).status,200);
  assert.equal(calls,2);assert.deepEqual(revs,[6]);assert.equal(f.ctx._localRev,6);
});
test('CAS rejects stale/no-newer snapshots without repeating the monetary mutation',async()=>{
  const f=fixture();let calls=0;
  f.ctx._fetchInterno=()=>{calls++;return new Response('{}',{status:507})};
  f.ctx.window.OCEstadoIDB={leer:async()=>({_rev:5,productos:[],ubicaciones:[]})};
  assert.equal((await f.fetch('/api/productos/p1/venta',post)).status,507);
  assert.equal(calls,1);
});
