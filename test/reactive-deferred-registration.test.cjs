'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/app/app-inline-01.js'),'utf8');
const start=source.indexOf('window.OCReactivo = (function () {');
const end=source.indexOf('\n})();',start)+6;
assert.ok(start>0&&end>start,'real reactive tunnel boundaries');
function fixture(readyState,hasBus){
  const listeners=new Map(),subscriptions=new Map(),calls=[];
  const bus={on(type,fn){assert.ok(!subscriptions.has(type),'only one subscription');subscriptions.set(type,fn);},emit(type){subscriptions.get(type)?.();}};
  const window={AMG:hasBus?{EventBus:bus}:undefined,addEventListener(){}};
  const document={readyState,addEventListener(type,fn){const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list);},getElementById(){return null;}};
  const context={window,document,poblarSelectClientes:()=>calls.push('clientes'),poblarSelectClientesVentaAbierta:()=>calls.push('venta'),montarBuscadorVender:()=>calls.push('categorias')};
  vm.runInNewContext(source.slice(start,end),context);
  return {window,bus,calls,subscriptions,loaded(){window.AMG={EventBus:bus};for(const fn of listeners.get('DOMContentLoaded')||[])fn();}};
}
test('deferred app before event bus registers every reactive topic once at DOMContentLoaded',()=>{
  const x=fixture('interactive',false);x.loaded();
  assert.deepEqual([...x.subscriptions.keys()],['oc:datos:comisionistas','oc:datos:clientes','oc:datos:perchas','oc:datos:categorias','oc:datos:ventas']);
  x.window.OCReactivo.emitir('clientes');x.window.OCReactivo.emitir('categorias');
  assert.deepEqual(x.calls,['clientes','venta','categorias']);
});
test('existing bus registers immediately after load and once during parser loading',()=>{
  for(const state of ['complete','loading']){
    const x=fixture(state,true);if(state==='loading')x.loaded();
    assert.equal(x.subscriptions.size,5);x.window.OCReactivo.emitir('clientes');assert.deepEqual(x.calls,['clientes','venta']);
  }
});
