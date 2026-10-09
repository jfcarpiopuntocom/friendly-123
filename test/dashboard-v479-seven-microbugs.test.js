'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=()=>fs.readFileSync(require('node:path').join(__dirname,'../docs/dashboard.html'),'utf8');
function extract(prefix){const s=html();const start=s.indexOf(prefix);assert(start>=0,'function '+prefix+' present');const brace=s.indexOf('{',start);let level=0,inString='',escape=false;for(let i=brace;i<s.length;i++){const c=s[i];if(inString){if(escape){escape=false;continue}if(c==='\\'){escape=true;continue}if(c===inString)inString='';continue;}if(c==='"'||c==="'"||c==='`'){inString=c;continue}if(c==='{')level++;else if(c==='}'&&!--level)return s.slice(start,i+1);}throw Error('unterminated '+prefix)}
test('MB1 [RED] same-revision storage signal forces repaint (no lost dashboard updates)',async()=>{
 const src=extract('async function refrescarLocal('); const result=[];let rev=4;const ctx={autorizado:true,leerEstadoLocalActual:async()=>({_rev:4,productos:[]}),_ultimaRevRepintada:4,bloquearSesionSiCambioTienda:()=>false,pintarDesdeLocal:(s)=>{result.push(s);return true}};vm.createContext(ctx);vm.runInContext(src+';this.callRefresh=refrescarLocal',ctx);await ctx.callRefresh(true);assert.equal(result.length,1,'explicit storage signal must repaint even if revision unchanged');
});
test('MB2 [RED] old read cannot paint after new revision',async()=>{
 const src=extract('async function refrescarLocal(');const painted=[];const ctx={autorizado:true,leerEstadoLocalActual:async()=>({_rev:3,productos:[]}),_ultimaRevRepintada:5,bloquearSesionSiCambioTienda:()=>false,pintarDesdeLocal:s=>{painted.push(s);return true}};vm.createContext(ctx);vm.runInContext(src+';this.callRefresh=refrescarLocal',ctx);await ctx.callRefresh(true);assert.equal(painted.length,0,'monotonic revision prevents rollback in viewer');
});
test('MB3 [RED] session must not retain prior shop after active notebook switches',()=>{
 const src=extract('function bloquearSesionSiCambioTienda(');const ctx={autorizado:true,_sesionLocal:true,codigoSesionActual:'F123-AAA',codigoLocalActivo:()=> 'F123-BBB',fotoToken:'SECRET',ws:null,_repintarVivoT:null,fotoTimer:null,reconexionTimer:null,clearTimeout:()=>{},document:{body:{classList:{remove:()=>{}},removeAttribute:()=>{}}},$:(id)=>ctx.elements[id],elements:{puerta:{style:{},},tablero:{style:{}},cabecera:{style:{}},entrar:{disabled:true},msg:{textContent:''}}};vm.createContext(ctx);vm.runInContext(src+';this.check=bloquearSesionSiCambioTienda',ctx);ctx.check();assert.equal(ctx.autorizado,false);assert.equal(ctx.elements.tablero.style.display,'none');assert.equal(ctx.elements.puerta.style.display,'flex');assert.equal(ctx.fotoToken,'');
});
test('MB4 [RED] storage event catches active license changes (not merely state buffers)',()=>{
 const s=html();assert.match(s,/window\.addEventListener\("storage",\s*function\s*\(ev\)[\s\S]*?ev\.key === "f123_tienda_activa"/);
});
test('MB5 [RED] async IDB read cannot cross active notebook boundary',async()=>{
 const src=extract('async function leerEstadoLocalActual(');let code='F123-A';const old={_rev:4,productos:[]};const mirror={_rev:5,productos:[{id:'B'}]};const ctx={leerEstadoLocal:()=>old,localStorage:{getItem:k=>k==='f123_owned'?'{}':null},window:{OCEstadoIDB:{leer:async()=>{code='F123-B';return mirror}}},codigoLocalActivo:()=>code};vm.createContext(ctx);vm.runInContext(src+';this.readActual=leerEstadoLocalActual',ctx);const result=await ctx.readActual();assert.equal(result,null,'changing notebook during async read invalidates read result');
});
test('MB6 [RED] access directory escapes user names and notes before innerHTML',async()=>{
 const src=extract('function cargarAcceso(');let inserted='';const el={set innerHTML(v){inserted=v},get innerHTML(){return inserted}};const esc=(s)=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');const ctx={$:()=>el,esc,ordenar:async()=>({ok:true,datos:{directorio:{owner:{nombre:'<img src=x onerror=alert(1)>',pin:'789',notas:'<svg onload=alert(2)>'},empleados:[],acct:{}}}})};vm.createContext(ctx);vm.runInContext(src+';this.load=cargarAcceso',ctx);ctx.load();await new Promise(r=>setTimeout(r,10));assert(!inserted.includes('<img'), 'untrusted display name must be text');assert(!inserted.includes('<svg'), 'untrusted notes must be text');assert(inserted.includes('&lt;img'));
 const hostile={$:()=>el,esc,ordenar:async()=>({ok:false,datos:{error:'<img src=x onerror=alert(3)>'}})};vm.createContext(hostile);vm.runInContext(src+';this.load=cargarAcceso',hostile);hostile.load();await new Promise(r=>setTimeout(r,10));assert(!inserted.includes('<img'),'remote error must not inject executable markup');
});
test('MB7 [RED] print stylesheet must respect unopened PIN gate',()=>{
 const s=html();assert.match(s,/body:not\(\[data-dashboard-auth="yes"\]\)\s+#tablero\s*\{\s*display:none\s*!important/);
});
