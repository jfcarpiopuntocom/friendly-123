const {test}=require('node:test');
const assert=require('node:assert/strict');
const {browser}=require('./helpers/browser.cjs');
async function shop(){
 const w=browser();w.OCAuth={rolActual:()=> 'dueno'};
 const artist=await w.request('/api/promotoras','POST',{nombre:'Synthetic artist',comisionBase:80});
 const shelf=await w.request('/api/ubicaciones','POST',{nombre:'Synthetic workshop',tipo:'socio'});
 await w.request('/api/ubicaciones/'+shelf.id,'PUT',{promotoraId:artist.id});
 const p=await w.request('/api/productos','POST',{nombre:'Synthetic lesson',barcode:'SYN-REPORT-CUT',precio:100,costo:10,stockInicial:2,ubicacionId:shelf.id});
 await w.request('/api/productos/'+p.id+'/venta','POST',{cantidad:1});
 return {w,shelf,p};
}
test('reporting cut reads canonical sales and expenses together without mutating the business',async()=>{
 const {w,p}=await shop();const expense=await w.request('/api/gastos','POST',{concepto:'Synthetic paper',monto:5,categoria:'services'});
 const before=JSON.stringify(w.catalog());
 const cut=await w.request('/api/reporting/corte');
 assert.equal(cut.schema,1);assert.ok(Number.isSafeInteger(cut.revision));assert.ok(cut.timezone);
 assert.deepEqual(cut.ventas,await w.request('/api/ventas/todas'));
 assert.deepEqual(cut.gastos,(await w.request('/api/gastos')).gastos);
 assert.equal(JSON.stringify(w.catalog()),before,'GET must not write history or financial facts');
 // browser.cjs also contains the isolated historical demo fixture. Keep its
 // records in the canonical equality check, outside this independent example.
 const result=w.OCBusinessReadModel.businessResult({sales:cut.ventas.filter(v=>v.productoId===p.id),expenses:cut.gastos.filter(g=>g.id===expense.id)});
 assert.equal(result.houseAfterExpensesCents,500);
});
test('a financial cut advances on edits and payment cannot lower economic result again',async()=>{
 const {w,shelf,p}=await shop();const before=await w.request('/api/reporting/corte');
 const result=cut=>w.OCBusinessReadModel.businessResult({sales:cut.ventas.filter(v=>v.productoId===p.id),expenses:[]}).houseAfterExpensesCents;
 await w.request('/api/liquidaciones/'+shelf.id+'/marcar-pagado','POST',{medioPago:'efectivo'});
 const after=await w.request('/api/reporting/corte');
 assert.ok(after.revision>before.revision);assert.equal(result(before),1000);assert.equal(result(after),1000);
 assert.equal(after.ventas.find(v=>v.productoId===p.id).comisionPendiente,0);
});
test('reporting cut does not add a commission-reading permission to employees',async()=>{
 const {w}=await shop();w.OCAuth={rolActual:()=> 'empleado'};
 const response=await w.fetch('/api/reporting/corte');assert.equal(response.status,403);
});
