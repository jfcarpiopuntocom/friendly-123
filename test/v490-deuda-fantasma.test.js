// v490 (2026-10-13): two money defects found by the v489 review.
// 1) Walk-in cash sale -> customer + on account, and the device fails to save:
//    the receipt was already written, rollback put the sale back to walk-in,
//    the customer kept a phantom debt and every retry got 409.
// 2) Legacy sale whose customer changed in an old version: an old receipt for
//    customer A plus a new one for customer B = the same sale charged twice.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {browser}=require('./helpers/browser.cjs');
function app(){
 const facts=[];const w=browser();w.OCAuth={rolActual:()=> 'dueno'};
 w.AMG={Hechos:{todos:async()=>facts.slice(),verificarCadenas:async()=>({ok:true}),registrar:async(tipo,datos)=>{const h={id:'synthetic-v490-'+facts.length,tipo,datos:JSON.parse(JSON.stringify(datos)),ts:Date.now()+facts.length};facts.push(h);return h;}}};
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/cartera.js'),'utf8'),w);
 return {w,facts};
}
const balance=(s,id)=>s.w.request('/api/clientes/'+id+'/cartera');
test('failed save on walk-in -> customer on account leaves no phantom debt and the retry succeeds',async()=>{
 const s=app();const a=await s.w.request('/api/clientes','POST',{nombre:'Synthetic v490 A'});
 const p=await s.w.request('/api/productos','POST',{nombre:'Synthetic v490 IPA',barcode:'SYNTH-V490-1',precio:10,costo:2,stockInicial:30});
 const {ventaId}=await s.w.request('/api/productos/'+p.id+'/venta','POST',{cantidad:12,info:{formaPago:'cash'}});
 const original=s.w.localStorage.setItem.bind(s.w.localStorage);
 s.w.localStorage.setItem=()=>{throw Error('synthetic disk full')};s.w.OCEstadoIDB={guardar:async()=>false};
 await assert.rejects(()=>s.w.request('/api/ventas/'+ventaId,'PATCH',{clienteId:a.id,info:{formaPago:'fiado'}}),/503/);
 s.w.localStorage.setItem=original;delete s.w.OCEstadoIDB;
 const v=(await s.w.request('/api/ventas/todas')).find(x=>x.id===ventaId);
 assert.equal(v.clienteId||'','');assert.equal(v.formaPago,'cash');
 assert.equal((await balance(s,a.id)).saldo,0,'no phantom debt while the sale is still walk-in cash');
 await s.w.request('/api/ventas/'+ventaId,'PATCH',{clienteId:a.id,info:{formaPago:'fiado'}});
 assert.equal((await balance(s,a.id)).saldo,-120);
 assert.equal(s.facts.filter(h=>h.tipo==='cartera_cargo').length,1,'the retry reuses the same receipt');
});
test('legacy receipt for another customer blocks a second charge for the same sale',async()=>{
 const s=app();const a=await s.w.request('/api/clientes','POST',{nombre:'Synthetic v490 old'});
 const b=await s.w.request('/api/clientes','POST',{nombre:'Synthetic v490 new'});
 const p=await s.w.request('/api/productos','POST',{nombre:'Synthetic v490 item',barcode:'SYNTH-V490-2',precio:10,costo:2,stockInicial:30});
 const {ventaId}=await s.w.request('/api/productos/'+p.id+'/venta','POST',{cantidad:2,clienteId:b.id,info:{formaPago:'cash'}});
 s.facts.push({id:'synthetic-legacy-v490',tipo:'cartera_cargo',datos:{clienteId:a.id,monto:20,motivo:'Legacy charge',ventaId},ts:1});
 await assert.rejects(()=>s.w.request('/api/ventas/'+ventaId,'PATCH',{info:{formaPago:'fiado'}}),/409/);
 assert.equal(s.facts.filter(h=>h.tipo==='cartera_cargo').length,1,'no second receipt');
 assert.equal((await balance(s,b.id)).saldo,0);
 assert.equal((await s.w.request('/api/ventas/todas')).find(x=>x.id===ventaId).formaPago,'cash');
});
