'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createHash,webcrypto}=require('node:crypto');
const {IDBFactory}=require('fake-indexeddb');
const base=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(base,'src/dashboard/dashboard-main.js'),'utf8');
const i=source.indexOf('      /* No previous shop / revision finance facts may survive until IDB replies. */');
const j=source.indexOf('      try {\n        var o = JSON.parse(localStorage.getItem("f123_owned")',i);
assert.ok(i>0&&j>i,'exercise actual source local finance read');
const local=source.slice(i,j);
const verifierPath=path.join(base,'docs/core/hechos-chain-readonly.js');
const make=(instance,seq,prev,tipo='cartera_abono',amount=7)=>{
 const h={id:instance+'-'+seq,instanceId:instance,autor:'dueno',reloj:{[instance]:seq},
  ts:1763400000000+seq,tipo,datos:{clienteId:'syn-client',monto:amount},hashPrevio:prev||'',hash:''};
 const canonical=JSON.stringify({id:h.id,instanceId:h.instanceId,autor:h.autor,reloj:h.reloj,ts:h.ts,tipo:h.tipo,datos:h.datos,hashPrevio:h.hashPrevio});
 h.hash=createHash('sha256').update(canonical).digest('hex');
 return h;
};
async function seed(rows){
 const db=new IDBFactory();
 await new Promise((resolve,reject)=>{
  const req=db.open('f123_hechos_db',1);
  req.onupgradeneeded=()=>{const store=req.result.createObjectStore('hechos',{keyPath:'id'});rows.forEach(x=>store.put(x))};
  req.onsuccess=()=>{req.result.close();resolve()};req.onerror=()=>reject(req.error);
 });
 return db;
}
async function run(rows,{withModule=true,crypto=webcrypto,afterStart}={}){
 const indexedDB=await seed(rows);
 const ctx={indexedDB,crypto,TextEncoder,Promise,datos:{},e:{ajustesComision:[],productos:[],ventas:[],clientes:[],gastos:[]},
  d:{resumen:{}},localStorage:{getItem:()=>null},Intl,autorizado:true,
  _generacionPinturaLocal:0,codigoSesionActual:'SYNTHETIC-STORE',codeHere:'SYNTHETIC-STORE',
  codigoLocalActivo:()=>ctx.codigoSesionActual,rendered:[],console};
 ctx.window=ctx;
 ctx.mostrar=()=>ctx.rendered.push({ready:ctx.datos.cobertura.hechosFinancieros,
  why:ctx.datos.cobertura.motivoHechos,rows:ctx.datos.hechosFinancieros.length});
 if(withModule && fs.existsSync(verifierPath))vm.runInNewContext(fs.readFileSync(verifierPath,'utf8'),ctx);
 vm.runInNewContext(local,ctx,{filename:'dashboard-financial-local.js'});
 if(afterStart)afterStart(ctx);
 await new Promise(r=>setTimeout(r,240));
 return ctx;
}
test('H6 RED: tampered amount with old hash cannot become verified Casa facts',async()=>{
 const f=make('writer-A',1,'');f.datos.monto=999;
 const c=await run([f]);
 assert.equal(c.datos.cobertura.hechosFinancieros,false);
 assert.equal(c.datos.cobertura.motivoHechos,'cadena-invalida');
 assert.equal(c.datos.hechosFinancieros.length,0);
});
test('H6 RED: a missing author predecessor fails closed, not a cash zero',async()=>{
 const first=make('writer-A',1,''),third=make('writer-A',3,first.hash);
 const c=await run([third]);
 assert.equal(c.datos.cobertura.hechosFinancieros,false);
 assert.equal(c.datos.cobertura.motivoHechos,'cadena-invalida');
});
test('H6 RED: valid multiple-author SHA256 chains count only cash facts after verification',async()=>{
 const a=make('writer-A',1,''),b=make('writer-A',2,a.hash,'caja_chica_ingreso');
 const c=make('writer-B',1,'','plan_pago_creado');
 const ctx=await run([a,b,c]);
 assert.equal(ctx.datos.cobertura.hechosFinancieros,true);
 assert.equal(ctx.datos.cobertura.motivoHechos,null);
 assert.equal(ctx.datos.hechosFinancieros.length,2);
});
test('H6 RED: absent pure verifier cannot silently accept unverified IDB facts',async()=>{
 const a=make('writer-A',1,'');
 const ctx=await run([a],{withModule:false});
 assert.equal(ctx.datos.cobertura.hechosFinancieros,false);
 assert.equal(ctx.datos.cobertura.motivoHechos,'sin-verificador');
});
test('H6 RED: no WebCrypto cannot certify unweak SHA256 hash receipts',async()=>{
 const a=make('writer-A',1,'');
 const ctx=await run([a],{crypto:null});
 assert.equal(ctx.datos.cobertura.hechosFinancieros,false);
 assert.equal(ctx.datos.cobertura.motivoHechos,'cadena-invalida');
});
test('H6 source does not mutate underlying journal in any validator path',()=>{
 assert.ok(!local.includes('transaction("hechos", "readwrite"'));
 assert.ok(!local.includes('objectStore("hechos").put'));
 assert.ok(!local.includes('objectStore("hechos").delete'));
});
