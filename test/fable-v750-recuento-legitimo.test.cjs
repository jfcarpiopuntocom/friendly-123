const {test}=require('node:test');const assert=require('node:assert/strict');const {browser}=require('./helpers/browser.cjs');
async function dev(extra){const w=browser();const fx=await w.request('/api/respaldo/exportar');const p=fx.productos.find(x=>Number(x.stockActual)>=1);
  for(const k of ['stockBase','stockPN','stockEpochId','stockCountWitness','stockCountTs'])delete p[k];
  Object.assign(p,{id:'syn-legit',stockActual:9,stockTs:1000},extra);fx.productos=[p];fx.ventas=[];fx.movimientos=[];await w.request('/api/respaldo/importar','POST',fx);return w;}
const st=async w=>(await w.request('/api/respaldo/exportar')).productos.find(x=>x.id==='syn-legit').stockActual;
const rem=(w,o)=>{const c=w.catalog();Object.assign(c.productos.find(x=>x.id==='syn-legit'),o);return c;};
test('recuento v748 sin testigo 9->1 llega a un aparato sin epoca',async()=>{const w=await dev({});
  w.OCSync.aplicarCatalogo(rem(w,{stockActual:1,stockTs:5000,stockCountTs:5000,stockBase:1,stockPN:{},stockEpochId:'stock-epoch-v748',stockCountWitness:null}),null);assert.equal(await st(w),1);});
test('recuento v748 sin testigo 9->1 llega a un aparato con epoca vieja',async()=>{const w=await dev({stockEpochId:'stock-epoch-old',stockBase:9,stockPN:{}});
  w.OCSync.aplicarCatalogo(rem(w,{stockActual:1,stockTs:5000,stockCountTs:5000,stockBase:1,stockPN:{},stockEpochId:'stock-epoch-v748',stockCountWitness:null}),null);assert.equal(await st(w),1);});
test('recuento v750 con testigo a 0 tras venta offline no vista llega',async()=>{const w=await dev({stockBase:10,stockPN:{b:{add:0,sub:1}},stockTs:2000});
  w.OCSync.aplicarCatalogo(rem(w,{stockActual:0,stockTs:1500,stockCountTs:1500,stockBase:0,stockPN:{},stockEpochId:'stock-epoch-n',stockCountWitness:{base:10,epoch:'',pn:{}}}),null);assert.equal(await st(w),0);});
