// Fable 5.2 / JFC 12-Nov: stock has one authenticated physical count,
// never a guessed per-device PN baseline. Synthetic fixtures only.
const test=require('node:test');
const assert=require('node:assert/strict');
const {browser}=require('./helpers/browser.cjs');

async function device(id,stock,ts=0) {
  const w=browser();
  const fx=await w.request('/api/respaldo/exportar');
  const row=fx.productos.find(p=>Number(p.stockActual)>=1);
  assert.ok(row,'fixture requires an existing product');
  Object.assign(row,{id,nombre:'Synthetic shelf',stockActual:stock,stockTs:ts});
  for(const k of ['stockBase','stockPN','stockEpochId','stockCountWitness','stockReconciliacionPendiente'])
    delete row[k];
  fx.productos=[row];fx.ventas=[];fx.movimientos=[];
  await w.request('/api/respaldo/importar','POST',fx);
  return w;
}
async function product(w,id){
  const f=await w.request('/api/respaldo/exportar');
  return f.productos.find(p=>p.id===id);
}

test('a stale epoch identifier without a count witness cannot replace known stock by zero',async()=>{
  const id='unwitnessed-zero',current=await device(id,9,2000),older=await device(id,0,1000);
  const incoming=older.catalog();
  Object.assign(incoming.productos.find(p=>p.id===id),{stockBase:0,stockEpochId:'old-epoch',stockPN:{},stockCountWitness:null});
  current.OCSync.aplicarCatalogo(incoming,null);
  assert.equal((await product(current,id)).stockActual,9);
});

test('sale from a legacy uncounted device does not invent a PN base',async()=>{
  const id='no-guessed-base',w=await device(id,7);
  const sold=await w.request('/api/productos/'+id+'/venta','POST',{cantidad:1});
  assert.ok(sold.ventaId,'sale must still commit locally');
  const p=await product(w,id);
  assert.equal(p.stockActual,6,'no disruption to local sale');
  assert.equal(p.stockBase==null,true,'7 inferred from current screen is NOT a witnessed count');
  assert.equal(p.stockPN==null||!Object.keys(p.stockPN).length,true,'no PN ledger tied to a guessed baseline');
  const backup=await w.request('/api/respaldo/exportar');
  assert.equal(backup.ventas.filter(v=>v.id===sold.ventaId).length,1,'money/sale preserved exactly once');
});

test('authorized physical count establishes first PN epoch; subsequent sale keeps that same base',async()=>{
  const id='count-authority',w=await device(id,3);
  w.OCAuth={rolActual:()=>'dueno'};
  await w.request('/api/productos/'+id+'/ajustar','POST',{stockFisico:9,motivo:'recuento autorizado'});
  let p=await product(w,id);
  assert.equal(p.stockBase,9);
  assert.ok(/^stock-epoch-/.test(p.stockEpochId||''),'physical count must carry a unique epoch');
  const epoch=p.stockEpochId;
  const sale=await w.request('/api/productos/'+id+'/venta','POST',{cantidad:1});
  assert.ok(sale.ventaId);
  p=await product(w,id);
  assert.equal(p.stockBase,9,'sale uses witness, never creates its own base');
  assert.equal(p.stockEpochId,epoch);
  assert.equal(p.stockActual,8);
});

test('authenticated count wins against a later legacy timestamp on another device',async()=>{
  const id='two-devices-physical-count',owner=await device(id,4),legacy=await device(id,11,Date.now()+60000);
  owner.OCAuth={rolActual:()=>'dueno'};
  await owner.request('/api/productos/'+id+'/ajustar','POST',{stockFisico:6,motivo:'counted physical shelf'});
  const expected=await product(owner,id);
  assert.equal(expected.stockBase,6);
  assert.ok(expected.stockEpochId);
  legacy.OCSync.aplicarCatalogo(owner.catalog(),null);
  const b=await product(legacy,id);
  assert.equal(b.stockActual,6,'validated recount outranks legacy stockTs from another clock');
  assert.equal(b.stockBase,6);
  assert.equal(b.stockEpochId,expected.stockEpochId);
  owner.OCSync.aplicarCatalogo(legacy.catalog(),null);
  assert.equal((await product(owner,id)).stockActual,6);
});

test('later authorized physical count beats an older count whose last sale stamped a newer stockTs',async()=>{
  const id='two-physical-epochs',older=await device(id,8),newer=await device(id,7);
  for(const w of [older,newer])w.OCAuth={rolActual:()=>'dueno'};
  await older.request('/api/productos/'+id+'/ajustar','POST',{stockFisico:8});
  await newer.request('/api/productos/'+id+'/ajustar','POST',{stockFisico:6});
  const setClocks=async(w,countTs,stockTs)=>{
    const b=await w.request('/api/respaldo/exportar'),p=b.productos.find(p=>p.id===id);
    p.stockCountTs=countTs;p.stockTs=stockTs;
    await w.request('/api/respaldo/importar','POST',b);
  };
  await setClocks(older,1000,9000); // an older count, with a later sale/clock update
  await setClocks(newer,2000,2000); // physically later authorized count
  older.OCSync.aplicarCatalogo(newer.catalog(),null);
  assert.equal((await product(older,id)).stockActual,6,'physical count time wins, not stockTs of an unrelated movement');
  newer.OCSync.aplicarCatalogo(older.catalog(),null);
  assert.equal((await product(newer,id)).stockActual,6,'no oscillation on reverse merge');
});
