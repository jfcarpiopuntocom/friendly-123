'use strict';
// (JFC 2026-10-28) Aviso inmediato (sin plazo) al frenar la recarga por recuperacion Yjs/IDB: no bloqueante, solo recarga si el
// usuario lo toca, y SIEMPRE guarda antes. Se carga el fuente Y el bundle minificado en un VM con DOM falso.
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
 test(file+' - un solo vigia de 60 s; bandera frenada se fija una vez y se registra una vez',()=>{
  const f=cargar(file);
  assert.equal(f.vigia.length,1);
  f.ctx.sessionStorage.setItem('f123_act_sola_pendiente','1');
  f.sola.vigilar();const t0=f.ctx.sessionStorage.getItem('f123_update_frenada_desde');
  assert.equal(t0,String(f.clock.t));
  f.clock.t+=60000;f.sola.vigilar();f.sola.intentar();
  assert.equal(f.ctx.sessionStorage.getItem('f123_update_frenada_desde'),t0,'no se sobrescribe');
  assert.deepEqual(f.log(),['frenada-recuperacion']);
  assert.equal(f.reloads.length,0,'nunca recarga por si solo');
 });
 test(file+' - se muestra de inmediato al frenarse (sin avanzar el reloj); no si no esta frenado',()=>{
  let f=cargar(file);
  f.ctx.sessionStorage.setItem('f123_act_sola_pendiente','1');
  f.sola.intentar(); // el rechazo de recarga dispara el chequeo
  assert.equal(f.body.filter(e=>e.id==='f123-aviso-version').length,1,'una sola tira');
  f.sola.vigilar();f.sola.intentar();
  assert.equal(f.body.filter(e=>e.id==='f123-aviso-version').length,1,'sin duplicados');
  const a=f.aviso();
  assert.equal(a.tag,'button');assert.equal(a.attrs.role,'status');assert.equal(a.attrs['aria-live'],'polite');
  assert.match(a.textContent,/Hay una versión nueva/);
  assert.equal(f.reloads.length,0);
  f=cargar(file,{recup:false}); // pendiente pero sin recuperacion: no se frena, no hay aviso
  f.ctx.sessionStorage.setItem('f123_act_sola_pendiente','1');
  f.sola.vigilar();assert.equal(f.aviso(),undefined);
  f=cargar(file); // frenada pero sin version pendiente: no hay aviso
  f.sola.vigilar();f.sola.intentar();assert.equal(f.aviso(),undefined);
 });
 test(file+' - se quita si ya no hay pendiente o termino la recuperacion',()=>{
  let f=cargar(file);
  f.ctx.sessionStorage.setItem('f123_act_sola_pendiente','1');
  f.sola.vigilar();f.sola.vigilar();assert.ok(f.aviso());
  f.ctx.sessionStorage.removeItem('f123_act_sola_pendiente');f.sola.vigilar();
  assert.equal(f.aviso(),undefined);
  assert.equal(f.ctx.sessionStorage.getItem('f123_update_frenada_desde'),null);
  f=cargar(file);
  f.ctx.sessionStorage.setItem('f123_act_sola_pendiente','1');
  f.sola.vigilar();f.sola.vigilar();assert.ok(f.aviso());
  f.yjs.canal.recuperando=false;f.sola.vigilar();
  assert.equal(f.aviso(),undefined);
  assert.equal(f.ctx.sessionStorage.getItem('f123_update_frenada_desde'),null);
 });
 test(file+' - tocar con guardado OK recarga una vez y registra aviso-usuario',async()=>{
  let guardados=0;
  const f=cargar(file,{save:async()=>{guardados++;return true;}});
  f.ctx.sessionStorage.setItem('f123_act_sola_pendiente','1');
  f.sola.vigilar();f.sola.vigilar();
  const a=f.aviso();
  await Promise.all([a.l.click(),a.l.click()]); // doble toque simultaneo: un solo guardado y una recarga
  assert.equal(guardados,1);assert.equal(f.reloads.length,1);
  assert.equal(f.log().at(-1),'aviso-usuario');
  assert.equal(f.ctx.sessionStorage.getItem('f123_act_sola_pendiente'),null);
  assert.equal(f.ctx.sessionStorage.getItem('f123_update_frenada_desde'),null);
 });
 test(file+' - guardado que falla, devuelve no-true, o se cuelga (5 s): nunca recarga',async()=>{
  const casos=[async()=>false,async()=>{throw new Error('x');},async()=>undefined,()=>new Promise(()=>{}),null];
  for(const save of casos){
   const f=cargar(file,{save:save||undefined});
   f.ctx.sessionStorage.setItem('f123_act_sola_pendiente','1');
   f.sola.vigilar();f.sola.vigilar();
   const a=f.aviso();
   const p=a.l.click();
   const tope=f.timers.find(t=>t.k==='t'&&t.ms===5000);
   if(tope)tope.fn();
   await p;
   assert.equal(f.reloads.length,0);
   assert.match(a.textContent,/Aún guardando/);
   assert.ok(!f.log().includes('aviso-usuario'));
  }
 });
 test(file+' - tocar durante PIN, editor o venta en curso: no guarda ni recarga',async()=>{
  const casos=[
   f=>{f.ctx.document.getElementById=id=>id==='oc-gate'?{style:{display:'flex'}}:(id==='f123-aviso-version'?f.aviso()||null:null);},
   f=>{f.ctx.document.querySelectorAll=s=>s==='.oc-vs-editor'?[{style:{display:'block'}}]:[];},
   f=>{f.ctx._ventasEnCurso.add('v1');}
  ];
  for(const poner of casos){
   let guardados=0;
   const f=cargar(file,{save:async()=>{guardados++;return true;}});
   f.ctx.sessionStorage.setItem('f123_act_sola_pendiente','1');
   f.sola.vigilar();f.sola.vigilar();
   const a=f.aviso();poner(f);
   await a.l.click();
   assert.equal(guardados,0);assert.equal(f.reloads.length,0);
   assert.match(a.textContent,/Termina lo que estás haciendo/);
  }
 });
 test(file+' - estilos del aviso: 16px+, #FFFFFF important, sin opacity ni rgba, z-index bajo el PIN gate',()=>{
  const f=cargar(file);
  f.ctx.sessionStorage.setItem('f123_act_sola_pendiente','1');
  f.sola.vigilar();f.sola.vigilar();
  const p=f.aviso().style.props;
  assert.deepEqual(p.get('color'),{v:'#FFFFFF',p:'important'});
  assert.deepEqual(p.get('-webkit-text-fill-color'),{v:'#FFFFFF',p:'important'});
  assert.deepEqual(p.get('background-color'),{v:'#E86040',p:'important'});
  assert.ok(parseFloat(p.get('font-size').v)>=16);
  assert.ok(parseFloat(p.get('min-height').v)>=48);
  assert.ok(Number(p.get('z-index').v)<9999);
  for(const [k,x] of p){assert.ok(!/opacity|backdrop|filter/.test(k),k);assert.ok(!/rgba/i.test(x.v),k);assert.equal(x.p,'important',k);}
 });
}
