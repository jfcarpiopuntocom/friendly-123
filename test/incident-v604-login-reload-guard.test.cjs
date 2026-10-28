'use strict';
// (JFC 2026-10-27) La recarga diferida del login (f123_reload_al_entrar) respeta la guarda de
// recuperacion Yjs/IDB, y la bitacora de recargas (f123_recargas_log) es acotada y nunca lanza.
// Se carga el fuente Y el bundle minificado (docs/app-inline-03.min.js) en un VM.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const sources=['src/app/app-inline-03.js','docs/app-inline-03.min.js'];
function store(){const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>{m.set(k,String(v));},removeItem:k=>{m.delete(k);},m};}
// Carga solo el tramo recuperacionPendiente..marcarRecarga (hasta function intentar) con un window sintetico.
function cargar(file,{yjs,ls}={}){
 const s=read(file);
 const a=s.indexOf('function recuperacionPendiente()'),b=s.indexOf('function intentar()',a);
 assert(a>0&&b>a,'helpers reales presentes en '+file);
 const window={OCYjs:yjs};
 const ctx={window,localStorage:ls||store(),sessionStorage:store(),Date,JSON,Array,String};
 vm.runInNewContext(s.slice(a,b),ctx);
 return ctx;
}
// Ejecuta el bloque real de entrar() de auth-ui.js; devuelve 'recargo' | 'siguio'.
function entrar(ctx,rol){
 const s=read('docs/auth-ui.js');
 const a=s.indexOf('var _recPend = false;'),b=s.indexOf('    } catch (_) {}\n    const esDemo',a)>0?s.indexOf('    } catch (_) {}\n    const esDemo',a):s.indexOf('    } catch (_) {}\r\n    const esDemo',a);
 assert(a>0&&b>a,'bloque real de entrar() presente');
 let recargo=false;
 const c=Object.assign({},ctx,{nuevoRol:rol,location:{reload(){recargo=true;}}});
 c.window=ctx.window;
 const r=vm.runInNewContext('(function(){try{'+s.slice(a,b)+'}catch(_){} return "siguio";})()',c);
 return recargo?'recargo':r;
}
const ok={recuperando:false,recuperacionLocal:'listo'};
for(const file of sources){
 test(file+' - recuperacion pendiente: el login NO recarga y la bandera sigue en 1',()=>{
  const ctx=cargar(file,{yjs:{estado:'activo',canal:{recuperando:true,recuperacionLocal:'listo'}}});
  assert.equal(ctx.window.__f123RecuperacionPendiente(),true);
  ctx.sessionStorage.setItem('f123_reload_al_entrar','1');
  assert.equal(entrar(ctx,'dueno'),'siguio');
  assert.equal(ctx.sessionStorage.getItem('f123_reload_al_entrar'),'1');
  assert.equal(ctx.sessionStorage.getItem('f123_sesion'),null,'no toca la sesion diferida si no recarga');
 });
 test(file+' - recuperacion local IDB pendiente tambien bloquea; _diag pendiente bloquea',()=>{
  let ctx=cargar(file,{yjs:{estado:'activo',canal:{recuperando:false,recuperacionLocal:'pendiente'}}});
  assert.equal(ctx.window.__f123RecuperacionPendiente(),true);
  ctx=cargar(file,{yjs:{estado:'activo',canal:ok,_diag:()=>({recuperacionLocalPendiente:true})}});
  assert.equal(ctx.window.__f123RecuperacionPendiente(),true);
 });
 test(file+' - recuperacion terminada o sin OCYjs: recarga y limpia la bandera',()=>{
  for(const yjs of [{estado:'activo',canal:ok,opsCanal:ok,fotosCanal:ok,_diag:()=>({recuperacionLocalPendiente:false})},undefined]){
   const ctx=cargar(file,{yjs});
   assert.equal(ctx.window.__f123RecuperacionPendiente(),false);
   ctx.sessionStorage.setItem('f123_reload_al_entrar','1');
   assert.equal(entrar(ctx,'demo'),'recargo');
   assert.equal(ctx.sessionStorage.getItem('f123_reload_al_entrar'),null);
   assert.deepEqual(JSON.parse(ctx.sessionStorage.getItem('f123_sesion')),{rol:'demo',demo:true},'rol demo preservado');
   assert.equal(JSON.parse(ctx.localStorage.getItem('f123_recargas_log')).at(-1).m,'login-diferida');
  }
 });
 test(file+' - sin bandera no recarga',()=>{
  const ctx=cargar(file,{yjs:undefined});
  assert.equal(entrar(ctx,'dueno'),'siguio');
 });
 test(file+' - __f123RecuperacionPendiente no lanza aunque OCYjs explote',()=>{
  const yjs={get estado(){throw new Error('boom');}};
  const ctx=cargar(file,{yjs});
  assert.doesNotThrow(()=>ctx.window.__f123RecuperacionPendiente());
 });
 test(file+' - __f123MarcarRecarga guarda maximo 15 y nunca lanza',()=>{
  const ctx=cargar(file);
  for(let i=0;i<20;i++)ctx.window.__f123MarcarRecarga('m'+i);
  const log=JSON.parse(ctx.localStorage.getItem('f123_recargas_log'));
  assert.equal(log.length,15);
  assert.equal(log[0].m,'m5');assert.equal(log.at(-1).m,'m19');
  assert.deepEqual(Object.keys(log[0]).sort(),['m','t','v']);
  ctx.localStorage.setItem('f123_recargas_log','{no json');
  ctx.window.__f123MarcarRecarga('x');
  assert.equal(JSON.parse(ctx.localStorage.getItem('f123_recargas_log')).length,1,'log corrupto se reinicia');
  const roto={getItem(){throw new Error('x');},setItem(){throw new Error('y');}};
  const ctx2=cargar(file,{ls:roto});
  assert.doesNotThrow(()=>ctx2.window.__f123MarcarRecarga('z'));
 });
}
