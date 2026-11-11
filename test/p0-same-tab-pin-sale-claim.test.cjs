'use strict';
// P0 synthetic-only regression from exact shipped _fetchConCandado closure.
// No customer data, token, PIN, license or external requests.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/mock-backend.js'),'utf8');
const a=source.indexOf('  let _colaEscriturasLocal = Promise.resolve();');
const b=source.indexOf('  const _fetchInterno = async function',a);
assert.ok(a>=0&&b>a,'load actual current backend FIFO and session guard');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
 let pending=true,current=false,epoch=7,role='dueno',writes=0;
 const listeners=new Set();
 const window={
   location:{origin:'https://synthetic.invalid'},
   get OC_AUTH_SESSION_EPOCH(){return epoch},
   OC_TAB_READONLY:false,OCEstadoIDB:null,
   OCTabSession:{get pending(){return pending},isCurrent:()=>current&&!pending},
   addEventListener:(type,fn)=>{if(type==='oc-tab-session-changed')listeners.add(fn)},
   removeEventListener:(type,fn)=>{if(type==='oc-tab-session-changed')listeners.delete(fn)}
 };
 const ctx={Response,URL,Promise,setTimeout,clearTimeout,window,
   _localRev:1,_localRevReservado:1,_estadoLecturaBloqueada:false,_conflictoEstadoAB:null,
   _ventaConfirmando:false,_payoutConfirmando:false,_retencionConfirmando:false,
   _ventaPendiente:null,_payoutPendiente:null,_retencionPendiente:null,
   _guardadoCatalogoPendiente:null,_estadoPublicableConfirmado:null,
   _negadoPorRol:()=>null,_rolLocal:()=>role,_recargarSiOtraPestanaEscribio:()=>{},
   validarRespaldo:()=>null,_huellaPublicable:()=> '{}',aplicarRespaldo:()=>{},
   _fetchInterno:()=>{writes++;return Promise.resolve(new Response('{"ok":true}',{status:200}))}
 };
 const fetch=vm.runInNewContext('(function(){'+source.slice(a,b)+';return _fetchConCandado;})',ctx)();
 return {
   fetch,emit(){for(const fn of [...listeners])fn()},settle(owned){pending=false;current=owned;for(const fn of [...listeners])fn()},
   lose(){pending=false;current=false;for(const fn of [...listeners])fn()},
   logout(){epoch++;role=null;pending=false;current=false;for(const fn of [...listeners])fn()},
   changeRole(){role='empleado';pending=false;current=true;for(const fn of [...listeners])fn()},
   get writes(){return writes}, get listeners(){return listeners.size},
   setActive(){pending=false;current=true;}
 };
}
const sale={method:'POST',body:'{}'};
// JFC order 2026-11-11 (real shop could not sell): the sale guard compares ONLY
// the role. A pending own PIN claim, a lost tab lease or a new login epoch never
// reject a write any more; a real sign-out or role change still gives 403.
// The v730 tests below asserted the lease-based behaviour and were rewritten
// (not lowered): the role/sign-out rejections and "no write when rejected" stay.
test('P0 (JFC 2026-11-11): CONFIRM during a pending own PIN claim is saved once, immediately',async()=>{
 const f=fixture(),request=f.fetch('/api/productos/p1/venta',sale);
 assert.equal((await request).status,200,'the lease is no longer a precondition for the sale');
 assert.equal(f.writes,1);
 assert.equal(f.listeners,0,'no listener is needed any more');
});
test('P0 (JFC 2026-11-11): a competing tab taking the lease does not reject the sale',async()=>{
 const f=fixture(),request=f.fetch('/api/productos/p1/venta',sale);
 f.lose();
 assert.equal((await request).status,200);
 assert.equal(f.writes,1);
 assert.equal(f.listeners,0);
});
test('P0: logout while the sale waits cancels it (real sign-out still gives 403)',async()=>{
 const f=fixture(),request=f.fetch('/api/productos/p1/venta',sale);
 f.logout();
 assert.equal((await request).status,403);
 assert.equal(f.writes,0);
});
test('P0: a real role change while the sale waits never authorizes the old sale',async()=>{
 const f=fixture(),request=f.fetch('/api/productos/p1/venta',sale);
 f.changeRole();
 assert.equal((await request).status,403);
 assert.equal(f.writes,0);
});
test('P0: normal active owner sale stays immediate and needs no listener',async()=>{
 const f=fixture();f.setActive();
 assert.equal((await f.fetch('/api/productos/p1/venta',sale)).status,200);
 assert.equal(f.writes,1);
 assert.equal(f.listeners,0);
});
test('P0 (JFC 2026-11-11): a pending claim does not block other business writes either',async()=>{
 const f=fixture(),p=f.fetch('/api/ubicaciones',{method:'POST',body:'{}'});
 assert.equal((await p).status,200);
 assert.equal(f.writes,1);
});
