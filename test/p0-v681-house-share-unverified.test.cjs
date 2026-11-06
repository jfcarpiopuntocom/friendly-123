'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser}=require('./helpers/browser.cjs');
const fs=require('node:fs');
const path=require('node:path');
test('associate holds house share from a newly sold event: never show PAID without receipt',async()=>{
  const app=browser();app.OCAuth={rolActual:()=> 'dueno'};
  const a=await app.request('/api/promotoras','POST',{nombre:'Synthetic person',comisionBase:85});
  const u=await app.request('/api/ubicaciones','POST',{nombre:'Synthetic event rack',tipo:'socio'});
  await app.request('/api/ubicaciones/'+u.id,'PUT',{promotoraId:a.id});
  const p=await app.request('/api/productos','POST',{nombre:'Synthetic event',sku:'E681',barcode:'E681',precio:15,costo:0,stockInicial:3,ubicacionId:u.id,tipoProducto:'ticket',fechaEvento:'2026-10-23',pctAsociado:85,direccionComision:'asociadoPaga'});
  const r=await app.request('/api/productos/'+p.id+'/venta','POST',{cantidad:1,direccionComision:'asociadoPaga',info:{fechaEvento:'2026-10-23'}});
  assert.ok(r.ventaId);
  const sales=await app.request('/api/ventas/todas?ubicacionId=todas');
  const v=sales.find(s=>s.id===r.ventaId);
  assert.equal(v.direccionComision,'asociadoPaga');
  assert.equal(v.comisionPendiente,0);
  const rows=await app.request('/api/liquidaciones?mes='+v.mes);
  const rack=rows.find(x=>x.ubicacionId===u.id);
  assert.equal(rack.paymentStatus,'house-unverified');
  assert.notEqual(rack.estado,'pagado');
  assert.equal(rack.stillDue,0);
  const data=await app.request('/api/respaldo/exportar');
  assert.equal(data.payouts.length,0);
  assert.notEqual(data.ventas.find(x=>x.id===r.ventaId).liquidada,true);
});
test('product badge and rack status label associate-held house share unverified',()=>{
  const s=fs.readFileSync(path.join(__dirname,'../src/app/app-inline-01.js'),'utf8');
  const m=fs.readFileSync(path.join(__dirname,'../docs/app-inline-01.min.js'),'utf8');
  for(const text of [s,m]){
    assert.ok(text.includes('house share unverified'));
    assert.ok(text.includes('house-unverified'));
    assert.ok(text.includes('casaEnAsociado'));
  }
});