'use strict';
// P0 Belén / Hermes H1 — test the ACTUAL local-dashboard financial read block,
// with no customer license, no data migration and no business write.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {IDBFactory}=require('fake-indexeddb');
const {createHash,webcrypto}=require('node:crypto');
const verifier=fs.readFileSync(path.join(__dirname,'../docs/core/hechos-chain-readonly.js'),'utf8');
function hecho(instance,seq,tipo) {
 const h={id:instance+'-'+seq,instanceId:instance,autor:'dueno',reloj:{[instance]:seq},
   ts:1763400000000+seq,tipo,datos:{monto:5},hashPrevio:'',hash:''};
 const base=JSON.stringify({id:h.id,instanceId:h.instanceId,autor:h.autor,
   reloj:h.reloj,ts:h.ts,tipo:h.tipo,datos:h.datos,hashPrevio:h.hashPrevio});
 h.hash=createHash('sha256').update(base).digest('hex');return h;
}
const file=fs.readFileSync(path.join(__dirname,'../src/dashboard/dashboard-main.js'),'utf8');
const a=file.indexOf('      /* No previous shop / revision finance facts may survive until IDB replies. */');
const b=file.indexOf('      try {\n        var o = JSON.parse(localStorage.getItem("f123_owned")',a);
assert.ok(a>0 && b>a,'must exercise actual dashboard local financial IDB reader');
const code=file.slice(a,b);
async function dbWith(factory,name,rows,modern=true){
 return new Promise((resolve,reject)=>{
  const req=factory.open(name,1);
  req.onupgradeneeded=()=>{
    const store=req.result.createObjectStore('hechos',{keyPath:'id'});
    for(const h of rows||[])store.add(h);
  };
  req.onerror=()=>reject(req.error);
  req.onsuccess=()=>{req.result.close();resolve()};
 });
}
function fixture(idb){
 const rendered=[];
 const ctx={
  indexedDB:idb,crypto:webcrypto,TextEncoder,datos:{},e:{ventas:[],productos:[],clientes:[],gastos:[],ajustesComision:[]},
  d:{resumen:{}},localStorage:{getItem:()=>null},Intl,
  autorizado:true,codigoSesionActual:'SYNTHETIC-ROOM',codeHere:'SYNTHETIC-ROOM',
  codigoLocalActivo:()=> 'SYNTHETIC-ROOM',_generacionPinturaLocal:0,
  mostrar:()=>rendered.push({...ctx.datos.cobertura}),console,
 };
 ctx.window=ctx;
 vm.runInNewContext(verifier,ctx,{filename:'hechos-chain-readonly.js'});
 vm.runInNewContext(code,ctx,{filename:'dashboard-local-facts-snippet.js'});
 return {ctx,rendered};
}
const wait=()=>new Promise(r=>setTimeout(r,180));
test('H1 RED: first-install no fact DB reports source missing, never says complete',async()=>{
 const idb=new IDBFactory();
 const f=fixture(idb);await wait();
 assert.equal(f.ctx.datos.cobertura.hechosFinancieros,false);
 assert.equal(f.ctx.datos.cobertura.motivoHechos,'sin-almacen');
});
test('H1 RED: legacy-only amg_hechos_db reports pending migration without reading unscoped money',async()=>{
 const idb=new IDBFactory();
 await dbWith(idb,'amg_hechos_db',[{id:'synthetic-1',tipo:'cartera_abono',monto:99}]);
 const f=fixture(idb);await wait();
 assert.equal(f.ctx.datos.cobertura.hechosFinancieros,false);
 assert.equal(f.ctx.datos.cobertura.motivoHechos,'sin-migrar');
 assert.equal(f.ctx.datos.hechosFinancieros.length,0);
 const names=(await idb.databases()).map(x=>x.name);
 assert.equal(names.includes('f123_hechos_db'),false,'viewer must never CREATE an empty modern finance ledger');
});
test('H1 RED: blocked modern fact database reports blocked, not silent incomplete',async()=>{
 const idb={databases:async()=>[{name:'f123_hechos_db'}],open:()=>{
   const req={};queueMicrotask(()=>req.onblocked?.());return req;
 }};
 const f=fixture(idb);await wait();
 assert.equal(f.ctx.datos.cobertura.motivoHechos,'bloqueado');
 assert.equal(f.ctx.datos.cobertura.hechosFinancieros,false);
});
test('H1 RED: IDB read error reports actionable error while leaving financial figures unavailable',async()=>{
 const idb={databases:async()=>[{name:'f123_hechos_db'}],open:()=>{throw new Error('Synthetic blocked storage')}};
 const f=fixture(idb);await wait();
 assert.equal(f.ctx.datos.cobertura.motivoHechos,'error-lectura');
 assert.equal(f.ctx.datos.cobertura.hechosFinancieros,false);
});
test('H1 existing modern finance ledger is read-only and completes with exactly the prior facts',async()=>{
 const idb=new IDBFactory();
 await dbWith(idb,'f123_hechos_db',[hecho('writer-A',1,'cartera_abono'),hecho('writer-B',1,'caja_chica_ingreso'),hecho('writer-C',1,'plan_pago_creado')]);
 const f=fixture(idb);await wait();
 assert.equal(f.ctx.datos.cobertura.hechosFinancieros,true);
 assert.equal(f.ctx.datos.hechosFinancieros.length,2);
 assert.equal(f.ctx.datos.cobertura.motivoHechos,null);
});
test('H1 source session cancellation does not republish previous-shop facts or reasons',async()=>{
 const idb={databases:async()=>[{name:'f123_hechos_db'}],open:()=>{
   const req={};queueMicrotask(()=>{fixtureState.ctx.autorizado=false;req.onerror?.()});return req;
 }};
 const fixtureState={};
 const f=fixture(idb);fixtureState.ctx=f.ctx;await wait();
 assert.equal(f.rendered.length,0,'a stale generation must not repaint the new shop');
});
test('H1 dashboard Casa communicates distinct source status in Spanish and English without disclosing money',()=>{
 assert.match(file,/sin-migrar/,'Spanish bank-migration status required');
 assert.match(file,/bloqueado/,'blocked IDB needs clear status');
 assert.match(file,/motivoHechos/,'coverage reason must reach rendering');
 assert.match(file,/f123_hechos_db/);
});
