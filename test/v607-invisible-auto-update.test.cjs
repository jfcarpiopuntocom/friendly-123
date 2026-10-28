'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/app/app-inline-03.js'),'utf8');
const begin=source.indexOf('(function actualizacionSola()'),end=source.indexOf('// Microcirugia 5',begin);
function setup({durable=true,recovering=false,input=false,sale=false,dialog=false,transaction=false}={}) {
 let now=100000,saves=0,reloads=0,appended=0,resolveSave;
 const session=new Map([['f123_sesion','1'],['f123_act_sola_pendiente','1']]);
 const local=new Map([['f123_version_vista','shell v607|f123-shell-v607']]);
 const storage=map=>({getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)});
 const listeners=new Map();
 const sw={controller:{},addEventListener:(name,fn)=>listeners.set(name,fn),getRegistration:async()=>({update:async()=>{}})};
 const body={appendChild(){appended++;}};
 const document={visibilityState:'visible',activeElement:input?{tagName:'INPUT'}:null,body,
  getElementById:id=>sale&&id==='vi-cliente'?{}:null,querySelectorAll:selector=>dialog&&selector==='[role="dialog"]'?[{getClientRects:()=>[{}]}]:[],addEventListener(){},
  createElement:()=>({style:{setProperty(){}},setAttribute(){},addEventListener(){}})};
 const window={addEventListener(){},OCSync:{confirmarCatalogoDurable:()=>{saves++;return durable==='deferred'?new Promise(r=>{resolveSave=r;}):Promise.resolve(durable);}},
  OCYjs:recovering?{estado:'activo',canal:{recuperando:true}}:null};
 vm.runInNewContext(source.slice(begin,end),{window,navigator:{serviceWorker:sw},document,_ocActSolaOn:true,
  sessionStorage:storage(session),localStorage:storage(local),Date:{now:()=>now},setInterval(){},setTimeout(){return 1;},clearTimeout(){},
  getComputedStyle:()=>({display:'block'}),_ventasEnCurso:new Set(transaction?['sale']:[]),location:{reload(){reloads++;}},_recargarSeguroVersion(){}});
 return {window,document,session,local,sw,listeners,advance:()=>{now+=100000;},finish:()=>resolveSave(true),
  result:()=>({saves,reloads,appended})};
}
test('pending update inserts no banner and adopts only after safe idle durable save',async()=>{
 const app=setup();app.window._ocActSola.vigilar();
 assert.equal(app.result().appended,0,'pending update must not insert an update banner');
 await app.window._ocActSola.intentar();assert.equal(app.result().reloads,0,'active work must not reload');
 app.advance();await app.window._ocActSola.intentar();await app.window._ocActSola.intentar();
 assert.equal(app.result().saves,1);assert.equal(app.result().reloads,1);
 assert.equal(app.session.has('f123_act_sola_pendiente'),false);
});
test('recovery, focused input and failed durable save preserve pending update',async()=>{
 for(const options of [{recovering:true},{input:true},{sale:true},{dialog:true},{transaction:true},{durable:false}]){
  const app=setup(options);app.advance();await app.window._ocActSola.intentar();
  assert.equal(app.result().reloads,0);assert.equal(app.result().appended,0);
  assert.equal(app.session.get('f123_act_sola_pendiente'),'1');
 }
});
test('new controller schedules invisible adoption without interrupting current work',async()=>{
 const app=setup();app.session.delete('f123_act_sola_pendiente');
 app.sw.controller={};app.listeners.get('controllerchange')();
 assert.equal(app.session.get('f123_act_sola_pendiente'),'1');
 assert.equal(app.result().appended,0);assert.equal(app.result().reloads,0);
 app.advance();await app.window._ocActSola.intentar();
 assert.equal(app.result().reloads,1);assert.equal(app.session.get('f123_sesion'),'1');
});
test('input opened during durable save defers reload and simultaneous attempts share one save',async()=>{
 const app=setup({durable:'deferred'});app.advance();
 const saving=app.window._ocActSola.intentar();await app.window._ocActSola.intentar();
 assert.equal(app.result().saves,1);app.document.activeElement={tagName:'TEXTAREA'};app.finish();await saving;
 assert.equal(app.result().reloads,0);assert.equal(app.session.get('f123_act_sola_pendiente'),'1');
});
