'use strict';
// P0 RED: past-month own/counter sales must not disappear from Commissions'
// month selector or Summary by Product merely because they have no split.
// Synthetic local notebook only; no real money, sync, network, or migrations.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {browser}=require('./helpers/browser.cjs');

test('RED: previous month with house-only sales remains selectable and has a product summary',async()=>{
  const app=browser();
  app.OCAuth={rolActual:()=> 'dueno'};
  const rack=await app.request('/api/ubicaciones','POST',{nombre:'Historic own rack',tipo:'propio'});
  const product=await app.request('/api/productos','POST',{
    nombre:'Historic own item',barcode:'P0-OLD-OWN-2025',sku:'P0-OLD-OWN-2025',
    precio:29,costo:11,stockInicial:3,ubicacionId:rack.id
  });
  await app.request('/api/productos/'+product.id+'/venta','POST',{cantidad:1});
  const backup=await app.request('/api/respaldo/exportar');
  const sale=backup.ventas.find(v=>v.productoId===product.id);
  assert.ok(sale,'real local sale persisted into backup');
  assert.equal(sale.split==null,true,'own rack has no commission split');
  sale.fecha='2025-03-15T17:00:00.000Z';
  await app.request('/api/respaldo/importar','POST',backup);
  const all=await app.request('/api/ventas/todas?ubicacionId=todas');
  const old=all.find(v=>v.productoId===product.id);
  assert.equal(old.mes,'2025-03','backend still retains old sale');
  const months=await app.request('/api/liquidaciones/meses');
  const historic=months.find(m=>m.mes==='2025-03');
  assert.ok(historic,'historic month MUST be selectable even when its only sale is house-only');
  assert.equal(historic.pendiente,0,'no commission invented');
  assert.equal(historic.comision,0,'no commission invented');
  const src=fs.readFileSync(path.join(__dirname,'../src/app/app-inline-01.js'),'utf8');
  const start=src.indexOf('function agruparVentasPorProducto(');
  const end=src.indexOf('function selectorVistaComisionesHtml(',start);
  assert.ok(start>0&&end>start);
  const group=new Function(src.slice(start,end)+';return agruparVentasPorProducto;')();
  const rows=group(all,true,'2025-03',true);
  const item=rows.find(r=>r.productoId===product.id);
  assert.ok(item,'Summary by Product includes the selected historic sale');
  assert.equal(item.totalUnid,1);
  assert.equal(item.total,29);
  assert.equal(item.propiasMonto,29);
  assert.equal(item.socio,0);
});

test('P0: historic split commission month keeps exact money, no duplicate counting',async()=>{
  const app=browser();app.OCAuth={rolActual:()=> 'dueno'};
  const rack=await app.request('/api/ubicaciones','POST',{nombre:'Historic shared rack',tipo:'socio',comisionSocio:40});
  const product=await app.request('/api/productos','POST',{
    nombre:'Historic shared item',barcode:'P0-OLD-SPLIT-2025',sku:'P0-OLD-SPLIT-2025',
    precio:50,costo:20,stockInicial:3,ubicacionId:rack.id
  });
  await app.request('/api/productos/'+product.id+'/venta','POST',{cantidad:1});
  const backup=await app.request('/api/respaldo/exportar');
  const sale=backup.ventas.find(v=>v.productoId===product.id);
  assert.ok(sale&&sale.split);
  sale.fecha='2025-04-15T17:00:00.000Z';
  await app.request('/api/respaldo/importar','POST',backup);
  const month=(await app.request('/api/liquidaciones/meses')).find(m=>m.mes==='2025-04');
  assert.ok(month);
  assert.equal(month.comision,20);
  assert.equal(month.ventas,1);
});
