'use strict';
// P0 #611: one-device daily operation is a first-class contract.
// Synthetic notebook, no real licenses, no Sync3 shutdown, no network.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser}=require('./helpers/browser.cjs');

function disk(){
 const data=new Map();
 return {get length(){return data.size},key:i=>[...data.keys()][i],
  getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),
  removeItem:k=>data.delete(k)};
}

test('P0 one apparatus: event ticket sale, stock, cash and commission survive closing and reopening',async()=>{
 const store=disk();
 const app=browser(store);app.OCAuth={rolActual:()=> 'dueno'};
 const person=await app.request('/api/promotoras','POST',{nombre:'Synthetic event associate',comisionBase:40});
 const rack=await app.request('/api/ubicaciones','POST',{nombre:'Synthetic local event',tipo:'socio'});
 await app.request('/api/ubicaciones/'+rack.id,'PUT',{promotoraId:person.id});
 const item=await app.request('/api/productos','POST',{
  nombre:'Synthetic event ticket',sku:'ONE-DEVICE-P0',barcode:'ONE-DEVICE-P0',
  tipoProducto:'ticket',fechaEvento:'2026-11-07',precio:100,costo:20,stockInicial:3,ubicacionId:rack.id
 });
 const s=await app.fetch('/api/productos/'+item.id+'/venta',{
  method:'POST',body:JSON.stringify({cantidad:1,info:{formaPago:'efectivo',fechaEvento:'2026-11-07'}})
 });
 assert.equal(s.status,200,'local sale must durably commit without a second device');
 const receipt=await s.json();assert.ok(receipt.ventaId);
 const before=await app.request('/api/respaldo/exportar');
 assert.equal(before.productos.find(p=>p.id===item.id).stockActual,2,'one physical unit deducted');
 assert.equal(before.ventas.filter(v=>v.id===receipt.ventaId).length,1,'one and only one sale');
 const sale=(await app.request('/api/ventas/todas')).find(v=>v.id===receipt.ventaId);
 assert.equal(sale.comisionAsociado,40);
 const period=sale.mes;
 const liq=(await app.request('/api/liquidaciones?mes='+period)).find(r=>r.ubicacionId===rack.id);
 assert.ok(liq,'event location has a local commissions row');
 assert.equal(liq.stillDue,40);
 const pay=await app.request('/api/payouts','POST',{ubicacionId:rack.id,payeeId:person.id,
   amountCents:1500,medioPago:'efectivo',opId:'p0-one-device-receipt'});
 assert.ok(pay.payout&&pay.payout.id,'financial receipt durably stored once');
 const second=browser(store);second.OCAuth={rolActual:()=> 'dueno'};
 const after=await second.request('/api/respaldo/exportar');
 assert.equal(after.productos.find(p=>p.id===item.id).stockActual,2,'same device reload retains stock');
 assert.equal(after.ventas.filter(v=>v.id===receipt.ventaId).length,1,'same device reload retains sale');
 assert.equal(after.payouts.filter(p=>p.opId==='p0-one-device-receipt').length,1,'cash receipt is not lost or duplicated');
 const balance=(await second.request('/api/liquidaciones?mes='+period)).find(r=>r.ubicacionId===rack.id);
 assert.equal(balance.stillDue,25,'same-device commissions remain exact after restart');
});
