'use strict';
// v607: automatic safe adoption without an update banner; durable-save and recovery guards remain.
// Source and published bundle execute in a synthetic DOM.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const sources=['src/app/app-inline-03.js','docs/app-inline-03.min.js'];
function store(){const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>{m.set(k,String(v));},removeItem:k=>{m.delete(k);},m};}
function el(tag){
 const props=new Map(),attrs={},l={};
 return {tag,id:'',type:'',textContent:'',attrs,l,
  style:{setProperty:(k,v,p)=>props.set(k,{v,p}),props},
  setAttribute:(k,v)=>{attrs[k]=v;},
  addEventListener:(ev,fn)=>{l[ev]=fn;},
  remove(){this.gone=true;}};
}
// Carga el IIFE real actualizacionSola (de `const _ocActSolaOn` hasta su cierre) con un entorno sintetico.
function cargar(file,{recup=true,save}={}){
 const s=read(file);
 const a=s.indexOf('const _ocActSolaOn');
 const m=/setTimeout\(revisar,\s*(?:20000|2e4)\)[;,]?\s*\}\)\(\)/.exec(s.slice(a));
 assert(a>0&&m,'IIFE real presente en '+file);
 const code=s.slice(a,a+m.index+m[0].length);
 const clock={t:1700000000000};
 class D extends Date{static now(){return clock.t;}}
 const body=[];const timers=[];
 const document={visibilityState:'visible',activeElement:null,body:{appendChild:e=>{e.parent=body;body.push(e);}},
  getElementById:id=>{if(id==='f123-aviso-version')return body.find(e=>e.id===id&&!e.gone)||null;return null;},
  querySelectorAll:()=>[],addEventListener(){},createElement:t=>el(t)};
 const yjs={estado:'activo',canal:{recuperando:recup,recuperacionLocal:'listo'}};
 const reloads=[];
 const win={OCYjs:yjs,OCI18n:{getLang:()=>'es'},addEventListener(){},
  OCSync:save?{confirmarCatalogoDurable:save}:undefined};
 const ctx={window:win,document,navigator:{serviceWorker:{controller:null,addEventListener(){},getRegistration:()=>Promise.resolve(null)}},
  localStorage:store(),sessionStorage:store(),Date:D,JSON,Array,String,Number,Object,Promise,console,
  location:{reload(){reloads.push(1);}},
  getComputedStyle:()=>({display:'block'}),_recargarSeguroVersion(){},_ventasEnCurso:new Set(),
  setInterval:(fn,ms)=>{timers.push({fn,ms,k:'i'});return timers.length;},
  setTimeout:(fn,ms)=>{const t={fn,ms,k:'t',off:false};timers.push(t);return timers.length;},
  clearTimeout:id=>{if(timers[id-1])timers[id-1].off=true;}};
 ctx.sessionStorage.setItem('f123_sesion','{"rol":"dueno"}');
 vm.runInNewContext(code,ctx);
 const vigia=timers.filter(t=>t.k==='i'&&t.ms===60000);
 return {ctx,clock,yjs,body,reloads,timers,vigia,sola:win._ocActSola,
  aviso:()=>body.find(e=>e.id==='f123-aviso-version'&&!e.gone),
  log:()=>JSON.parse(ctx.localStorage.getItem('f123_recargas_log')||'[]').map(x=>x.m)};
}
for(const file of sources){
 test(file+' - recovery keeps its first timestamp without a banner or redundant watcher',async()=>{
  const f=cargar(file);assert.equal(f.vigia.length,0);
  f.ctx.sessionStorage.setItem('f123_act_sola_pendiente','1');
  f.sola.vigilar();const t0=f.ctx.sessionStorage.getItem('f123_update_frenada_desde');
  f.clock.t+=100000;await f.sola.intentar();
  assert.equal(f.ctx.sessionStorage.getItem('f123_update_frenada_desde'),t0);
  assert.deepEqual(f.log(),['frenada-recuperacion']);assert.equal(f.reloads.length,0);assert.equal(f.body.length,0);
  f.yjs.canal.recuperando=false;f.sola.vigilar();
  assert.equal(f.ctx.sessionStorage.getItem('f123_update_frenada_desde'),null);assert.equal(f.body.length,0);
 });
 test(file+' - safe idle durable adoption coalesces and keeps the session',async()=>{
  let saved=0;const f=cargar(file,{recup:false,save:async()=>{saved++;return true;}});
  f.ctx.sessionStorage.setItem('f123_act_sola_pendiente','1');f.clock.t+=100000;
  await Promise.all([f.sola.intentar(),f.sola.intentar()]);await f.sola.intentar();
  assert.equal(saved,1);assert.equal(f.reloads.length,1);assert.equal(f.body.length,0);
  assert.equal(f.log().at(-1),'version-segura');assert.equal(f.ctx.sessionStorage.getItem('f123_act_sola_pendiente'),null);
  assert.ok(f.ctx.sessionStorage.getItem('f123_sesion'));
 });
 test(file+' - failed, missing, non-true or timed-out durable ACK never reloads',async()=>{
  for(const save of [async()=>false,async()=>{throw Error('save failed');},async()=>undefined,()=>new Promise(()=>{}),null]){
   const f=cargar(file,{recup:false,save:save||undefined});f.clock.t+=100000;
   f.ctx.sessionStorage.setItem('f123_act_sola_pendiente','1');const pending=f.sola.intentar();
   const timer=f.timers.find(t=>t.k==='t'&&t.ms===5000);if(timer)timer.fn();await pending;
   assert.equal(f.reloads.length,0);assert.equal(f.body.length,0);assert.equal(f.ctx.sessionStorage.getItem('f123_act_sola_pendiente'),'1');
  }
 });
 test(file+' - PIN, editor and active transaction block saving and adoption',async()=>{
  for(const block of [f=>{f.ctx.document.getElementById=id=>id==='oc-gate'?{style:{display:'flex'}}:null;},f=>{f.ctx.document.querySelectorAll=s=>s==='.oc-vs-editor'?[{style:{display:'block'}}]:[];},f=>f.ctx._ventasEnCurso.add('sale')]){
   let saved=0;const f=cargar(file,{recup:false,save:async()=>{saved++;return true;}});f.clock.t+=100000;
   f.ctx.sessionStorage.setItem('f123_act_sola_pendiente','1');block(f);await f.sola.intentar();
   assert.equal(saved,0);assert.equal(f.reloads.length,0);assert.equal(f.body.length,0);
  }
 });
}