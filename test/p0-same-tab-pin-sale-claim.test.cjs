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
test('P0 RED: own PIN lease settling during CONFIRM waits for its actual lease and saves exactly once',async()=>{
 const f=fixture(),request=f.fetch('/api/productos/p1/venta',sale);
 await tick();
 assert.equal(f.writes,0,'do not write until own lease is proven');
 f.settle(true);
 assert.equal((await request).status,200,'same tab with proven PIN lease may continue the original sale');
 assert.equal(f.writes,1);
 assert.equal(f.listeners,0,'bounded listener cleanup');
});
test('P0: a competing tab does not gain authority by completing our pending claim',async()=>{
 const f=fixture(),request=f.fetch('/api/productos/p1/venta',sale);
 await tick();f.lose();
 assert.equal((await request).status,403);
 assert.equal(f.writes,0);
 assert.equal(f.listeners,0);
});
test('P0: logout during pending own-claim cancels sale, even if lease later appears',async()=>{
 const f=fixture(),request=f.fetch('/api/productos/p1/venta',sale);
 await tick();f.logout();
 assert.equal((await request).status,403);
 assert.equal(f.writes,0);
});
test('P0: role changes during pending PIN claim never authorize old sale',async()=>{
 const f=fixture(),request=f.fetch('/api/productos/p1/venta',sale);
 await tick();f.changeRole();
 assert.equal((await request).status,403);
 assert.equal(f.writes,0);
});
test('P0: normal active owner sale stays immediate and needs no listener',async()=>{
 const f=fixture();f.setActive();
 assert.equal((await f.fetch('/api/productos/p1/venta',sale)).status,200);
 assert.equal(f.writes,1);
 assert.equal(f.listeners,0);
});
test('P0: pending claim cannot open non-sale writes',async()=>{
 const f=fixture(),p=f.fetch('/api/ubicaciones',{method:'POST',body:'{}'});
 assert.equal((await p).status,403);
 assert.equal(f.writes,0);
});
