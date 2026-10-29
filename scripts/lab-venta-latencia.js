#!/usr/bin/env node
"use strict";
/* P0 diagnostic only. No private data, network, production writes or behavioral changes.
 * Measures the REAL docs/estado-ab.js write function and the serializations
 * executed by mock-backend.js during a durable sale. Does not claim to measure
 * a user's device, a Web Lock held by another tab, or live Yjs replay. */
const fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const {performance}=require("node:perf_hooks");
const src=fs.readFileSync(path.join(__dirname,"../docs/estado-ab.js"),"utf8");
const sample=(n,history)=>({
 schemaVersion:3,_rev:0,instanceId:"synthetic-benchmark",nombreNegocio:"SYNTHETIC ONLY",
 productos:Array.from({length:n},(_,i)=>({id:"p"+i,nombre:"Producto "+i,precio:10,costo:4,stockActual:100,stockBase:100,stockPN:{"device":{p:0,n:0}},ubicacionId:"u1",categoria:"General"})),
 ventas:Array.from({length:history},(_,i)=>({id:"v"+i,productoId:"p"+(i%n),fecha:"2026-10-01T12:00:00Z",cantidad:1,precioUnit:10,costoUnit:4,split:{montoComisionSocio:2},info:null})),
 clientes:Array.from({length:Math.min(n,250)},(_,i)=>({id:"c"+i,nombre:"Cliente sintético "+i})),
 ubicaciones:[{id:"u1",nombre:"Shelves"}],movimientos:Array.from({length:history},(_,i)=>({id:"m"+i,tipo:"venta",fecha:"2026-10-01T12:00:00Z",info:"synthetic"})),actividadCompartida:[],
 transferencias:[],gastos:[],ajustesComision:[],payouts:[],payoutConflicts:[],payoutQuarantine:[],
 sucursales:[],promotoras:[],configuracion:{},usuarios:[]});
function store(){
 const raw=new Map();
 return {getItem:k=>raw.has(k)?raw.get(k):null,
 setItem:(k,v)=>{raw.set(k,String(v))},removeItem:k=>raw.delete(k),
 get length(){return raw.size},key:i=>[...raw.keys()][i]||null};
}
function bench(n,history,rounds=5){
 const storage=store(),window={localStorage:storage,crypto:{randomUUID:()=>String(Math.random()).slice(2)},navigator:{}};
 const ctx={window,AbortController,Promise,setTimeout,clearTimeout,console};
 vm.runInNewContext(src,ctx);
 const ab=window.OCEstadoAB.crear({storage,claveBase:"synthetic_sales"});
 const state=sample(n,history),rows=[];
 for(let i=1;i<=rounds;i++){
  const mark=()=>performance.now();
  const t0=mark();state._rev=i;state.ventas.push({id:"new-sale-"+i,productoId:"p0",cantidad:1,precioUnit:10});state.productos[0].stockActual--;
  const raw=JSON.stringify(state),t1=mark();
  const complete=JSON.parse(raw),t2=mark();
  const accepted=ab.guardarAhora(raw),t3=mark();
  const {_rev,_abCommit,...rest}=complete;
  const _huellaPublicable=JSON.stringify(rest),t4=mark();
  // docs/estado-idb.js clones the full snapshot again when mirroring.
  const _idbCopy=JSON.parse(JSON.stringify(complete)),t5=mark();
  if(accepted!==true||ab.leer().revMax!==i||_idbCopy.productos[0].stockActual!==(100-i)||!_huellaPublicable)
    throw new Error("Synthetic durable ACK/inventory verification failed");
  rows.push({str:t1-t0,parse:t2-t1,ab:t3-t2,huella:t4-t3,idbClone:t5-t4,total:t5-t0});
 }
 const median=a=>{const s=a.slice().sort((a,b)=>a-b);return +(s[Math.floor(s.length/2)]).toFixed(2)};
 const result={productos:n,ventas:history,rounds,ms:Object.fromEntries(Object.keys(rows[0]).map(k=>[k,median(rows.map(x=>x[k]))]))};
 return result;
}
for(const [products,hist] of [[1,10],[300,900],[1000,5000]]){
 const b=bench(products,hist);
 console.log("P0 synthetic timing "+JSON.stringify(b));
}
console.log("PASS: only synthetic in-memory data; two Web Lock wait times and real-device stalls are NOT measured.");
