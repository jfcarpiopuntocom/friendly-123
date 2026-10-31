'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser}=require('./helpers/browser.cjs');
test('P0: imported prior-month sale and current sale remain separate unpaid obligations',async()=>{
 const app=browser();app.OCAuth={rolActual:()=> 'dueno'};
 const p=await app.request('/api/promotoras','POST',{nombre:'Synthetic Seller',comisionBase:40});
 const shelf=await app.request('/api/ubicaciones','POST',{nombre:'Synthetic Shelf',tipo:'socio',comisionSocio:40,promotoraId:p.id});
 const prod=await app.request('/api/productos','POST',{nombre:'Synthetic Item',sku:'SYN-MONTH',barcode:'SYN-MONTH',precio:25,costo:12,stockInicial:4,ubicacionId:shelf.id});
 await app.request('/api/productos/'+prod.id+'/venta','POST',{cantidad:1});
 const backup=await app.request('/api/respaldo/exportar');
 const first=backup.ventas.find(v=>v.productoId===prod.id);
 assert.ok(first,'initial sale must exist');
 const now=new Date(); const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,15,12));
 const previous=d.toISOString().slice(0,7);
 first.fecha=previous+'-15T12:00:00.000Z';
 const imported=await app.request('/api/respaldo/importar','POST',backup);
 const afterImport=await app.request('/api/respaldo/exportar');
 await app.request('/api/productos/'+prod.id+'/venta','POST',{cantidad:1});
 const latest=await app.request('/api/respaldo/exportar');
 const prior=(await app.request('/api/liquidaciones?mes='+previous)).find(row=>row.ubicacionId===shelf.id);
 const current=(await app.request('/api/liquidaciones')).find(row=>row.ubicacionId===shelf.id);
 console.log('SYNTHETIC-MONTH-FORENSIC',JSON.stringify({
  previous,imported:imported&&{ok:imported.ok,error:imported.error},
  salesAfterImport:afterImport.ventas.filter(v=>v.productoId===prod.id).map(v=>({id:v.id,date:v.fecha})),
  salesCurrent:latest.ventas.filter(v=>v.productoId===prod.id).map(v=>({id:v.id,date:v.fecha})),
  previousPending:prior?.ventasPendientes,currentPending:current?.ventasPendientes,
  previousStatement:prior?.payoutStatementLines?.map(x=>({kind:x.kind,sourceId:x.sourceId,dueCents:x.dueCents}))
 }));
 assert.equal(prior?.ventasPendientes,1,'the previous month has exactly one unpaid sale');
 assert.equal(current?.ventasPendientes,1,'the current month has exactly one unpaid sale');
});
