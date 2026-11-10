'use strict';
// P0 production-read contract, SYNTHETIC notebook ONLY.
// If old house-only sales disappear from the selector, Summary by Product
// becomes unreachable despite preserved sales. No data writes in real shops.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {browser}=require('./helpers/browser.cjs');
const src=fs.readFileSync(path.join(__dirname,'../src/app/app-inline-01.js'),'utf8');
function groupSales(){
  const from=src.indexOf('function agruparVentasPorProducto(');
  const to=src.indexOf('function selectorVistaComisionesHtml(',from);
  assert.ok(from>=0 && to>from,'execute the production product-grouping function');
  return new Function(src.slice(from,to)+';return agruparVentasPorProducto;')();
}
function monthControl(months,selected){
  const from=src.indexOf('function selectorMesComisionesHtml(');
  const to=src.indexOf('function barraComisionesHtml(',from);
  assert.ok(from>=0 && to>from,'execute the production month-selector function');
  const esc=v=>String(v==null?'':v).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  const fmtMoney=v=>'$'+Number(v).toFixed(2);
  const factory=new Function('_ocMesComisiones','escHtml','fmtMoney','_ocMesEtiqueta','t','window',
    src.slice(from,to)+';return selectorMesComisionesHtml;');
  return factory(selected,esc,fmtMoney,v=>v,v=>v,{tf:(key)=>key})(months);
}
test('P0: December old house sales and January commissions stay selectable without invented money',async()=>{
  const app=browser();
  app.OCAuth={rolActual:()=> 'dueno'};
  const own=await app.request('/api/ubicaciones','POST',{nombre:'Synthetic own rack',tipo:'propio'});
  const shared=await app.request('/api/ubicaciones','POST',{nombre:'Synthetic shared rack',tipo:'socio',comisionSocio:40});
  const ownProd=await app.request('/api/productos','POST',{
    nombre:'Synthetic December book',barcode:'P0-MONTH-OWN-2024',sku:'P0-MONTH-OWN-2024',
    precio:29,costo:10,stockInicial:3,ubicacionId:own.id
  });
  const sharedProd=await app.request('/api/productos','POST',{
    nombre:'Synthetic January print',barcode:'P0-MONTH-SPLIT-2025',sku:'P0-MONTH-SPLIT-2025',
    precio:50,costo:20,stockInicial:3,ubicacionId:shared.id
  });
  await app.request('/api/productos/'+ownProd.id+'/venta','POST',{cantidad:1});
  await app.request('/api/productos/'+sharedProd.id+'/venta','POST',{cantidad:1});
  const backup=await app.request('/api/respaldo/exportar');
  const one=backup.ventas.find(v=>v.productoId===ownProd.id);
  const two=backup.ventas.find(v=>v.productoId===sharedProd.id);
  assert.ok(one && two && !one.split && two.split,'fixture must have own no-split and shared split');
  one.fecha='2024-12-15T17:00:00.000Z';
  two.fecha='2025-01-15T17:00:00.000Z';
  await app.request('/api/respaldo/importar','POST',backup);
  const months=await app.request('/api/liquidaciones/meses');
  const dec=months.find(m=>m.mes==='2024-12'),jan=months.find(m=>m.mes==='2025-01');
  assert.ok(dec,'December house-only month remains selectable across year boundary');
  assert.equal(dec.comision,0,'no invented associate commission for house-only sale');
  assert.equal(dec.pendiente,0,'house-only sale is not a commission liability');
  assert.equal(dec.ventas,0,'commission-sales legacy counter is unchanged');
  assert.ok(jan,'January real commission month remains selectable');
  assert.equal(jan.comision,20,'exact preserved 40% of 50, counted once');
  assert.equal(jan.ventas,1);
  const html=monthControl(months,'2024-12');
  assert.match(html.control,/value="2024-12" selected/,'old month is a real selectable option');
  assert.match(html.control,/value="2025-01"/,'another historical month is also offered');
  const rows=await app.request('/api/ventas/todas?ubicacionId=todas');
  const group=groupSales();
  const [decProduct]=group(rows,true,'2024-12',true).filter(x=>x.productoId===ownProd.id);
  assert.ok(decProduct,'Summary by Product receives the actual old house sale');
  assert.equal(decProduct.total,29);
  assert.equal(decProduct.totalUnid,1);
  assert.equal(decProduct.propiasMonto,29);
  assert.equal(decProduct.socio,0);
  const [janProduct]=group(rows,true,'2025-01',true).filter(x=>x.productoId===sharedProd.id);
  assert.ok(janProduct,'Summary by Product receives a split sale in the right month');
  assert.equal(janProduct.total,50);
  assert.equal(janProduct.socio,20);
  assert.equal(group(rows,true,'2024-12',true).some(x=>x.productoId===sharedProd.id),false,
    'January money must never leak into December');
});
