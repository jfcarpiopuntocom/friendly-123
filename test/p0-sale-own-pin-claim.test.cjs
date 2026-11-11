'use strict';
// P0: test the shipped tab-session wait helper and exact mock-backend FIFO.
// Synthetic fixtures ONLY. Never touch live licenses, PINs, inventory or money.
const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const tab=fs.readFileSync(path.join(__dirname,'../docs/tab-session.js'),'utf8');
const backend=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
const a=backend.indexOf('  let _colaEscriturasLocal = Promise.resolve();');
const b=backend.indexOf('  const _fetchInterno = async function',a);
assert.ok(a>=0&&b>a,'use exact current backend guard');
const delay=()=>new Promise(r=>setImmediate(r));
function tabWaitFixture(){
 const begin=tab.indexOf(' function waitOwnClaim('),end=tab.indexOf(' window.OCTabSession=',begin);
 assert.ok(begin>=0&&end>begin,'production must expose bounded own-PIN-claim helper');
 const listeners=new Map(), w={OC_AUTH_SESSION_EPOCH:7,
  addEventListener:(event,fn)=>{let l=listeners.get(event)||new Set();l.add(fn);listeners.set(event,l);},
  removeEventListener:(event,fn)=>listeners.get(event)?.delete(fn)};
 const ctx={window:w,pending:true,claimed:false,suspendida:false,epoch:7,
  current:()=>ctx.claimed&&!ctx.pending&&!ctx.suspendida&&ctx.owner,
  owner:false,Number,Math,Promise,setTimeout,clearTimeout};
 vm.runInNewContext(tab.slice(begin,end)+'\nthis.wait=waitOwnClaim;',ctx);
 const signal=()=>{for(const f of listeners.get('oc-tab-session-changed')||[])f();};
 return {ctx,signal,wait:ms=>ctx.wait(ms)};
}
function backendFixture(){
 let writes=0,role='dueno',epoch=0,claimed=true,pending=true,owner=false,claimCalls=0;
 let release=null;
 const tabSession={
  get pending(){return pending;},
  isCurrent:()=>claimed&&!pending&&owner,
  waitOwnClaim:()=>{claimCalls++;return new Promise(resolve=>{release=resolve;});}
 };
 const ctx={
  Response,URL,Promise,AbortController,
  _localRev:5,_localRevReservado:5,_estadoLecturaBloqueada:false,_conflictoEstadoAB:null,
  _ventaConfirmando:false,_payoutConfirmando:false,_retencionConfirmando:false,
  _ventaPendiente:null,_payoutPendiente:null,_retencionPendiente:null,
  _guardadoCatalogoPendiente:null,_estadoPublicableConfirmado:null,
  _negadoPorRol:()=>null,_rolLocal:()=>role,_recargarSiOtraPestanaEscribio:()=>{},
  validarRespaldo:()=>null,_huellaPublicable:()=> '{}',aplicarRespaldo:()=>{},
  _fetchInterno:()=>{writes++;return Promise.resolve(new Response('{"ok":true}',{status:200}));},
  window:{location:{origin:'https://fixture.invalid'},OC_AUTH_SESSION_EPOCH:0,
    OCTabSession:tabSession,OCEstadoIDB:null,OC_TAB_READONLY:false}
 };
 const fetch=vm.runInNewContext('(function(){'+backend.slice(a,b)+';return _fetchConCandado;})',ctx)();
 return {fetch,ctx,tabSession,get writes(){return writes;},get claimCalls(){return claimCalls;},
  beginOwnClaim(){pending=true;claimed=true;owner=false;},
  claimSuccess(){pending=false;claimed=true;owner=true;if(release)release(true);},
  claimFailure(){pending=false;claimed=false;owner=false;if(release)release(false);},
  rival(){pending=false;claimed=true;owner=false;if(release)release(false);},
  logout(){role=null;pending=false;claimed=false;owner=false;ctx.window.OC_AUTH_SESSION_EPOCH++;if(release)release(false);}
 };
}
const sale={method:'POST',body:'{}'};
test('RED own PIN pending: CONFIRM waits only its own lease and commits once afterwards',async()=>{
 const f=backendFixture();
 const task=f.fetch('/api/productos/p1/venta',sale);
 await delay();assert.equal(f.writes,0,'never write while the own PIN claim is pending');
 assert.equal(f.claimCalls,1,'use the real session-own wait contract');
 f.claimSuccess();
 assert.equal((await task).status,200);
 assert.equal(f.writes,1,'one sale, not a second attempt');
});
test('real competing tab must remain 403; never wait for a foreign lease',async()=>{
 const f=backendFixture();f.rival();
 assert.equal((await f.fetch('/api/productos/p1/venta',sale)).status,403);
 assert.equal(f.claimCalls,0);assert.equal(f.writes,0);
});
test('real logout during own claim preserves 403, never commits',async()=>{
 const f=backendFixture(),task=f.fetch('/api/productos/p1/venta',sale);
 await delay();f.logout();
 assert.equal((await task).status,403);assert.equal(f.writes,0);
});
test('own PIN claim that fails keeps the sale closed, zero writes',async()=>{
 const f=backendFixture(),task=f.fetch('/api/productos/p1/venta',sale);
 await delay();f.claimFailure();
 assert.equal((await task).status,403);assert.equal(f.writes,0);
});
test('real tab-session own PIN claim succeeds after event, no fixed sleep',async()=>{
 const f=tabWaitFixture(),task=f.wait(400);
 f.ctx.pending=false;f.ctx.claimed=true;f.ctx.owner=true;f.signal();
 assert.equal(await task,true);
});
test('real tab-session competitor cannot reauthorize failed ownership',async()=>{
 const f=tabWaitFixture(),task=f.wait(400);
 f.ctx.pending=false;f.ctx.claimed=true;f.ctx.owner=false;f.signal();
 assert.equal(await task,false);
});
test('real tab-session logout/epoch change makes any pending claim fail',async()=>{
 const f=tabWaitFixture(),task=f.wait(400);
 f.ctx.window.OC_AUTH_SESSION_EPOCH++;
 f.ctx.pending=false;f.ctx.claimed=true;f.ctx.owner=true;f.signal();
 assert.equal(await task,false);
});
test('real tab-session unresolved own claim times out instead of granting authority',async()=>{
 const f=tabWaitFixture();assert.equal(await f.wait(25),false);
});
