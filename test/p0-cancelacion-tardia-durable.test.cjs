'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser}=require('./helpers/browser.cjs');

test('a rejected late cancellation keeps the sale and stock and sends no sync movement',async()=>{
  const w=browser();
  w.OCAuth={rolActual:()=> 'dueno'};
  const p=await w.request('/api/productos','POST',{nombre:'QA cancel',barcode:'QA-CANCEL',stockInicial:5,precio:12,costo:4});
  const sale=await w.request('/api/productos/'+p.id+'/venta','POST',{cantidad:1});
  const before=await w.request('/api/respaldo/exportar');
  const ops=[];
  w.OCSyncEmit=(...args)=>ops.push(args);
  w.OCEstadoIDB={soportado:true,guardarConRevision:async()=>false,ultimoError:()=>null};
  const response=await w.fetch('/api/ventas/'+sale.ventaId+'/cancelar',{method:'POST',body:'{}'});
  assert.equal(response.status,503);
  const after=await w.request('/api/respaldo/exportar');
  for(const key of ['ventas','productos','movimientos','selloUltimo']) assert.deepEqual(after[key],before[key],key);
  assert.deepEqual(ops,[]);
});
