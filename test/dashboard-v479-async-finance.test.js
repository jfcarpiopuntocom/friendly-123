'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const html=()=>fs.readFileSync(path.join(__dirname,'../docs/dashboard.html'),'utf8');
function extract(name){const s=html(),start=s.indexOf('function '+name+'(');assert(start>=0,name);const brace=s.indexOf('{',start);let n=0,inStr='',escape=false;for(let i=brace;i<s.length;i++){const ch=s[i];if(inStr){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch===inStr)inStr='';continue;}if(ch==='"'||ch==="'"||ch==='`'){inStr=ch;continue;}if(ch==='{')n++;else if(ch==='}'&&!--n)return s.slice(start,i+1);}throw Error('broken function '+name)}
function fixture() {
 const reqs = [];
 const indexedDB = {open() {
   const req = {onsuccess: null, query: null};
   req.result = {
     objectStoreNames: {contains: () => true},
     transaction: () => ({objectStore: () => ({getAll: () => {
       const q = {result: [], onsuccess: null}; req.query = q; return q;
     }})}),
     close: () => {},
   };
   reqs.push(req); return req;
 }};
 const ctx={
  codigoLocalActivo: ()=>'F123-A', codigoSesionActual:'F123-A',autorizado:true,_generacionPinturaLocal:0,
  leerEstadoLocal:()=>null, sinDemoSiHayLicencia:x=>x,
  datosDesdeLocal:e=>({productos:[{id:e.shop}],clientes:[],ventas:[{id:e.shop}],resumen:{},liquidaciones:[],payouts:[],ajustesComision:[],perchas:[]}),
  datos:{productos:[],hechosFinancieros:[{tipo:'cartera_old',id:'from-other-session'}]},
  localStorage:{getItem:()=>'{}'},$:()=>({textContent:''}),indexedDB,
  ws:null,pulso:()=>{},mostrar:()=>{},Date,Number,Object
 };
 vm.createContext(ctx);
 vm.runInContext(extract('pintarDesdeLocal')+';this.paint=pintarDesdeLocal',ctx);
 return {ctx,reqs};
}
test('dashboard old finance facts must never be shown before fresh IDB snapshot resolves',()=>{const f=fixture();assert.equal(f.ctx.paint({shop:'A'}),true);assert.equal(f.ctx.datos.productos[0].id,'A');assert.deepEqual(Array.from(f.ctx.datos.hechosFinancieros||[]),[],'old tenant financial facts must clear synchronously before new display');});
test('delayed finance query from old snapshot must not overwrite newer snapshot',()=>{const f=fixture();f.ctx.paint({shop:'A'});const a=f.reqs[0];a.onsuccess();f.ctx.paint({shop:'B'});const b=f.reqs[1];b.onsuccess();b.query.result=[{tipo:'cartera_new',id:'B'}];b.query.onsuccess();a.query.result=[{tipo:'cartera_old',id:'A'}];a.query.onsuccess();assert.equal(f.ctx.datos.hechosFinancieros[0]?.id,'B','late IDB read from previous snapshot must be discarded');});
