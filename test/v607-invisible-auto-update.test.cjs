'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/app/app-inline-03.js'),'utf8');
const begin=source.indexOf('(function actualizacionSola()'),end=source.indexOf('// Microcirugia 5',begin);
function setup({durable=true,recovering=false,input=false,sale=false,dialog=false,transaction=false,pin=false}={}) {
 let now=100000,saves=0,reloads=0,appended=0,resolveSave;
 const session=new Map([...(pin?[]:[['f123_sesion','1']]),['f123_act_sola_pendiente','1']]);
 const local=new Map([['f123_version_vista','shell v607|f123-shell-v607']]);
 const storage=map=>({getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)});
 const listeners=new Map();
 const sw={controller:{postMessage(){const fn=listeners.get('message');if(fn)fn({data:{tipo:'shell-actual',shell:'f123-shell-v607'}});}},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);},getRegistration:async()=>({update:async()=>{}})};
 const body={appendChild(){appended++;}};
 const gate=pin?{style:{display:'flex'},getClientRects:()=>[{}]}:null;
 const document={visibilityState:'visible',activeElement:input?{tagName:'INPUT'}:null,body,
  getElementById:id=>id==='oc-gate'?gate:(sale&&id==='vi-cliente'?{getClientRects:()=>[{}]}:null),querySelectorAll:selector=>dialog&&selector==='[role="dialog"]'?[{getClientRects:()=>[{}]}]:[],addEventListener(){},
  createElement:()=>({style:{setProperty(){}},setAttribute(){},addEventListener(){}})};
 const window={addEventListener(){},requestAnimationFrame:fn=>fn(),OCSync:{confirmarCatalogoDurable:()=>{saves++;return durable==='deferred'?new Promise(r=>{resolveSave=r;}):Promise.resolve(durable);}},
  OCYjs:recovering?{estado:'activo',canal:{recuperando:true}}:null};
 vm.runInNewContext(source.slice(begin,end),{window,navigator:{serviceWorker:sw},document,_ocActSolaOn:true,
  sessionStorage:storage(session),localStorage:storage(local),Date:{now:()=>now},setInterval(){},setTimeout(){return 1;},clearTimeout(){},
  getComputedStyle:()=>({display:'block'}),_ventasEnCurso:new Set(transaction?['sale']:[]),location:{reload(){reloads++;}},_recargarSeguroVersion(){}});
 return {window,document,session,local,sw,listeners,advance:()=>{now+=100000;},finish:()=>resolveSave(true),
  result:()=>({saves,reloads,appended})};
}
test('logged-in app never adopts automatically, even idle with durable confirmation',async()=>{
 const app=setup();app.window._ocActSola.vigilar();
 assert.equal(app.result().appended,0,'pending update must not insert an update banner');
 await app.window._ocActSola.intentar();assert.equal(app.result().reloads,0,'active work must not reload');
 app.advance();await app.window._ocActSola.intentar();await app.window._ocActSola.intentar();
 assert.equal(app.result().saves,0);assert.equal(app.result().reloads,0);
 assert.equal(app.session.get('f123_act_sola_pendiente'),'1');
});
test('PIN update defers recovery, visible sale and active transaction, but accepts focused PIN',async()=>{
 for(const options of [{recovering:true},{sale:true},{dialog:true},{transaction:true}]){
  const app=setup({...options,pin:true});app.advance();await app.window._ocActSola.intentar();
  assert.equal(app.result().reloads,0);assert.equal(app.result().appended,0);
  assert.equal(app.session.get('f123_act_sola_pendiente'),'1');
 }
 const typing=setup({pin:true,input:true,durable:false});
 await typing.window._ocActSola.intentar();
 assert.equal(typing.result().reloads,1,'PIN typing does not delay the update');
 assert.equal(typing.result().saves,0,'PIN entry requires no authenticated catalog ACK');
});
test('new controller leaves the running session intact even after idle',async()=>{
 const app=setup();app.session.delete('f123_act_sola_pendiente');
 app.sw.controller={postMessage(){const fn=app.listeners.get('message');if(fn)fn({data:{tipo:'shell-actual',shell:'f123-shell-v607'}});}};app.listeners.get('controllerchange')();
 assert.equal(app.session.get('f123_act_sola_pendiente'),'1');
 assert.equal(app.result().appended,0);assert.equal(app.result().reloads,0);
 app.advance();await app.window._ocActSola.intentar();
 assert.equal(app.result().reloads,0);assert.equal(app.session.get('f123_sesion'),'1');
});
test('backgrounding a PIN screen with a ready update adopts exactly once',async()=>{
 const app=setup({pin:true});app.document.visibilityState='hidden';
 await app.window._ocActSola.intentar();
 assert.equal(app.result().saves,0);
 assert.equal(app.result().reloads,1);assert.equal(app.session.get('f123_act_sola_pendiente'),undefined);
});
