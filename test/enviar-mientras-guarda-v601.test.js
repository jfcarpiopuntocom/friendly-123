// v601: enviar mientras se guarda (no-dinero, JFC 2026-10-27).
// (a) un cambio NO-dinero sale al sync aunque un guardado normal siga en curso;
// (b) un pago/venta (guardado estricto) NO publica estado provisional hasta su ACK durable.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser}=require('./helpers/browser.cjs');
async function setup(){
 const entries=new Map();let fail=false;
 const storage={get length(){return entries.size},key:i=>[...entries.keys()][i],getItem:k=>entries.get(k)??null,
  setItem:(k,v)=>{if(fail)throw Error('Synthetic storage full');entries.set(k,String(v));},removeItem:k=>entries.delete(k)};
 const app=browser(storage);app.OCAuth={rolActual:()=> 'dueno'};
 const a=await app.request('/api/promotoras','POST',{nombre:'Synthetic A',comisionBase:40});
 const r=await app.request('/api/ubicaciones','POST',{nombre:'Synthetic rack',tipo:'socio'});
 await app.request('/api/ubicaciones/'+r.id,'PUT',{promotoraId:a.id});
 const p=await app.request('/api/productos','POST',{nombre:'Synthetic',sku:'V601',barcode:'V601',precio:100,costo:20,stockInicial:3,ubicacionId:r.id});
 await app.request('/api/productos/'+p.id+'/venta','POST',{cantidad:1});
 return {app,a,r,p,fail:()=>{fail=true},recover:()=>{fail=false}};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('(a) non-money change is announced and broadcast while a normal save is still pending',async()=>{
 const f=await setup();f.fail();
 let confirm;f.app.OCEstadoIDB={guardar:()=>new Promise(r=>{confirm=r})};
 let eventos=0;f.app.addEventListener('oc-catalogo-cambiado',()=>eventos++);
 // alta de una percha: cambio de catalogo NO-dinero; el guardado IDB queda colgado a proposito
 await f.app.request('/api/ubicaciones','POST',{nombre:'Synthetic rack 2',tipo:'socio'});
 for(let i=0;i<5;i++)await tick();
 assert.ok(eventos>=1,'oc-catalogo-cambiado must fire before the save confirms');
 let listo=false;const cat=f.app.OCSync.catalogoConfirmado().then(c=>{listo=true;return c});
 for(let i=0;i<5;i++)await tick();
 assert.equal(listo,true,'legacy broadcast must not wait for a normal pending save');
 assert.ok((await cat),'catalogoConfirmado returns the current catalog');
 assert.ok(f.app.OCSync.catalogoPropio(),'seed allowed while normal save pending');
 if(confirm)confirm(true);
});
test('(a2) a failed last save with RAM different still blocks sending',async()=>{
 const f=await setup();f.fail();f.app.OCEstadoIDB={guardar:async()=>false};
 await f.app.request('/api/ubicaciones','POST',{nombre:'Synthetic rack 3',tipo:'socio'});
 for(let i=0;i<10;i++)await tick();
 assert.equal(f.app.OCSync.catalogoPropio(),null);
});
test('(b) a payout during a strict save does NOT publish provisional state',async()=>{
 const f=await setup();f.fail();
 let confirm;f.app.OCEstadoIDB={guardar:()=>new Promise(r=>{confirm=r})};
 let eventos=0;f.app.addEventListener('oc-catalogo-cambiado',()=>eventos++);
 let terminado=false;
 const pago=f.app.request('/api/payouts','POST',{ubicacionId:f.r.id,payeeId:f.a.id,amountCents:1500,medioPago:'efectivo',opId:'v601'}).then(x=>{terminado=true;return x});
 for(let i=0;i<10;i++)await tick();
 assert.equal(terminado,false);
 assert.equal(f.app.OCSync.catalogoPropio(),null,'no seed during strict save');
 let listo=false;const cat=f.app.OCSync.catalogoConfirmado().then(c=>{listo=true;return c});
 for(let i=0;i<10;i++)await tick();
 assert.equal(listo,false,'legacy broadcast must keep waiting for the money ACK');
 assert.equal(eventos,0);
 confirm(true);await pago;await cat;
});
