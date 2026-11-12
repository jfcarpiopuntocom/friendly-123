'use strict';
// v750: tres aparatos (A, B, C) sobre Yjs real y backend real, sin red ni datos de clientes.
// Cada escenario corre con cuatro estados de producto: sin base (creado o nunca movido desde v747),
// con base heredada, con epoca de creacion sin base, y con epoca + base.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {peer,exchange}=require('./helpers/yjs-peer.cjs');
const ID='syn-p';
const st=async p=>{const x=(await p.w.request('/api/respaldo/exportar')).productos.find(x=>x.id===ID);return x?x.stockActual:undefined;};
const full=async p=>{const x=(await p.w.request('/api/respaldo/exportar')).productos.find(x=>x.id===ID);return JSON.stringify({s:x.stockActual,b:x.stockBase,pn:x.stockPN&&Object.values(x.stockPN),e:(x.stockEpochId||'').slice(-4),w:!!x.stockCountWitness,cts:x.stockCountTs?1:0});};
async function trio(kind,stock=10){
  const a=await peer(),b=await peer(),c=await peer();
  const f=await a.w.request('/api/respaldo/exportar');
  const p={...f.productos[0],id:ID,nombre:'Synthetic',barcode:'SYN-1',stockActual:stock,stockTs:1000,rev:{c:1,d:'fx'}};
  for(const k of ['stockBase','stockPN','stockEpochId','stockCountWitness','stockReconciliacionPendiente','stockCountTs','stockEvidencias','stockDeficit'])delete p[k];
  if(kind==='base'){p.stockBase=stock;p.stockPN={};}
  if(kind==='epoca'){p.stockEpochId='stock-epoch-old1';}
  if(kind==='epocabase'){p.stockEpochId='stock-epoch-old1';p.stockBase=stock;p.stockPN={};}
  f.productos=[p];f.ventas=[];f.movimientos=[];
  await a.w.request('/api/respaldo/importar','POST',f);
  a.w.OCYjs._store.sembrar();await a.flush();
  await exchange(a,b,2);await exchange(a,c,2);
  return {a,b,c};
}
const sell=async(p,n=1)=>{const r=await p.w.request('/api/productos/'+ID+'/venta','POST',{cantidad:n});await p.flush();return r;};
const count=async(p,n)=>{await p.w.request('/api/productos/'+ID+'/ajustar','POST',{stockFisico:n});await p.flush();};
const all=async(...ps)=>{for(let r=0;r<3;r++)for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++)await exchange(ps[i],ps[j],1);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const S={
 async ultimaUnidad(k){const {a,b,c}=await trio(k,1);await sell(a);await all(a,b,c);return [0,a,b,c];},
 async ultimaUnidadYAnula(k){const {a,b,c}=await trio(k,1);const v=await sell(a);await all(a,b,c);await a.w.request('/api/ventas/'+v.ventaId+'/anular','POST',{});await a.flush();await all(a,b,c);return [1,a,b,c];},
 async recuentoACeroConVentaOffline(k){const {a,b,c}=await trio(k);await sell(b);await wait(5);await count(a,0);await all(a,b,c);return [0,a,b,c];},
 async frioEntraTarde(k){const {a,b,c}=await trio(k);await sell(a,2);await count(a,5);await sell(a);await all(a,b);const d=await peer();await all(a,b,d);return [4,a,b,d];},
 async ventasOffline(k){const {a,b,c}=await trio(k);await sell(a);await wait(5);await sell(b);await all(a,b,c);return [8,a,b,c];},
 async viejoLlegaTarde(k){const {a,b,c}=await trio(k);await sell(a,3);await all(a,c);await wait(5);await sell(b);await all(a,b,c);return [6,a,b,c];},
 async anulaOtro(k){const {a,b,c}=await trio(k);const v=await sell(a);await all(a,b,c);await b.w.request('/api/ventas/'+v.ventaId+'/anular','POST',{});await b.flush();await all(a,b,c);return [10,a,b,c];},
 async recuentoLuegoVenta(k){const {a,b,c}=await trio(k);await count(a,5);await all(a,b,c);await sell(b);await all(a,b,c);return [4,a,b,c];},
 async recuentoConVentaOfflinePrevia(k){const {a,b,c}=await trio(k);await sell(b);await wait(5);await count(a,5);await all(a,b,c);return [5,a,b,c];},
 async recuentoYVentaOfflinePosterior(k){const {a,b,c}=await trio(k);await count(a,5);await wait(5);await sell(b);await all(a,b,c);return ['4 o 5',a,b,c];},
 async dosRecuentos(k){const {a,b,c}=await trio(k);await count(a,5);await wait(5);await count(b,7);await all(a,b,c);return [7,a,b,c];},
 async recuentoACero(k){const {a,b,c}=await trio(k);await count(a,0);await all(a,b,c);return [0,a,b,c];},
 async recuentoSube(k){const {a,b,c}=await trio(k,1);await count(a,9);await all(a,b,c);await sell(c);await all(a,b,c);return [8,a,b,c];},
};
for(const k of ['sinbase','base','epoca','epocabase'])for(const n of Object.keys(S)){
  test('v750 stock A/B/C: '+n+' ['+k+']',async()=>{
    const [exp,a,b,c]=await S[n](k);
    const r=[await st(a),await st(b),await st(c)];
    const ok=String(exp).split(' o ').map(Number);
    assert.ok(r.every(x=>ok.includes(x))&&r[0]===r[1]&&r[1]===r[2],'esperado '+exp+' en los tres; A/B/C='+r.join('/')+' A '+await full(a)+' B '+await full(b)+' C '+await full(c));
  });
}
