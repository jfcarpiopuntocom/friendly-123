'use strict';
// C146: execute actual basket/receipt identity path, not a regex-only illustration.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../src/app/app-inline-01.js'),'utf8');
const helpStart=app.indexOf('const _ocVentaIntentosRAM = new Map();');
const helpEnd=app.indexOf('let _sellando = false;',helpStart);
const basketStart=app.indexOf('async function _sellarVentaInterno() {');
const basketEnd=app.indexOf('document.getElementById("btnSellarVenta") &&',basketStart);
assert(helpStart>=0&&helpEnd>helpStart&&basketStart>helpEnd&&basketEnd>basketStart);
const script=app.slice(helpStart,helpEnd)+'\n'+app.slice(basketStart,basketEnd);
function item(id){return {productoId:id,nombre:'Synthetic '+id,precio:3.5,cantidad:1,stockDisponible:10};}
function fixture(items){
 const saved=new Map(),posts=[],messages={textContent:'',style:{}},button={disabled:false};
 const els={ventaCliente:{value:'client-1',selectedOptions:[{textContent:'Synthetic'}]},
   carritoMsg:messages,btnSellarVenta:button,cierreDia:{open:false}};
 let reply=()=>({ok:true,body:{producto:{id:'p1'}}}),paints=0,gridRefresh=0,counter=0;
 const cryptoApi={randomUUID:()=>('00000000-0000-4000-8000-'+String(++counter).padStart(12,'0'))};
 const ctx=vm.createContext({API:'/api',window:{},localStorage:{
   getItem:k=>saved.has(k)?saved.get(k):null,
   setItem(k,v){saved.set(k,String(v));},removeItem:k=>saved.delete(k)},
  crypto:cryptoApi,globalThis:{crypto:cryptoApi},document:{getElementById:id=>els[id]||null},
  ocConfirm:async()=>true,fmtMoney:n=>'$'+n.toFixed(2),
  pintarCarrito:()=>{paints++;},cargarGridVender:()=>{gridRefresh++;},
  infoEventoActivo:()=>({formaPago:'cash'}),setTimeout:()=>0,Map,Promise,JSON,Math,Number,Date,String,
  fetch:async(url,opts)=>{const body=JSON.parse(opts.body);posts.push({url,body});const r=reply(body,url);return {ok:r.ok,status:r.ok?200:503,json:async()=>r.body};}
 });
 vm.runInContext('let _carritoVenta='+JSON.stringify(items)+';',ctx);
 vm.runInContext(script,ctx,{filename:'app-inline-01.js'});
 return {ctx,saved,posts,messages,button,setReply:f=>{reply=f;},
   run:()=>vm.runInContext('_sellarVentaInterno()',ctx),
   remaining:()=>vm.runInContext('_carritoVenta.map(l=>l.productoId)',ctx),
   paints:()=>paints,gridRefresh:()=>gridRefresh};
}
test('C146 RED: HTTP 200 without a verifiable receipt retains basket and original sale opId',async()=>{
 const x=fixture([item('p1')]);
 await x.run();
 assert.deepEqual([...x.remaining()],['p1'],'ambiguous HTTP200 is not an economic ACK');
 assert.match(x.messages.textContent,/receipt|verified|confirm/i);
 assert.notEqual(x.messages.style.color,'#006B3C');
 assert.equal(x.posts.length,1);
 assert.equal(x.saved.size>=1,true,'pending opId remains durable for idempotent retry');
 const first=x.posts[0].body.opId;
 x.setReply(b=>({ok:true,body:{opId:b.opId,ventaId:'sale-001',producto:{id:'p1'}}}));
 await x.run();
 assert.deepEqual([...x.remaining()],[]);
 assert.equal(x.posts[1].body.opId,first,'retry uses identical economic opId');
 assert.equal(x.saved.size,0,'receipt ACK retires pending opId');
 assert.match(x.messages.textContent,/Checked out/);
});
test('C146 RED: HTTP 200 with a different opId must not consume the cart',async()=>{
 const x=fixture([item('p1')]);
 x.setReply(b=>({ok:true,body:{opId:'sale-other',ventaId:'sale-001',producto:{id:'p1'}}}));
 await x.run();
 assert.deepEqual([...x.remaining()],['p1']);
 assert.equal(x.saved.size,1);
 assert.doesNotMatch(x.messages.textContent,/Checked out/);
});
test('C146 RED: partial basket retains only uncertain lines, previous verified lines stay committed',async()=>{
 const x=fixture([item('p1'),item('p2')]);
 x.setReply((b,url)=>url.includes('/p1/')?{ok:true,body:{opId:b.opId,ventaId:'receipt1',producto:{id:'p1'}}}:
   {ok:true,body:{opId:b.opId,producto:{id:'p2'}}});
 await x.run();
 assert.deepEqual([...x.remaining()],['p2'],'verified p1 removed; unverified p2 must remain');
 assert.match(x.messages.textContent,/Everything before that IS checked out/);
 assert.equal(x.saved.size,1,'p2 opId stays, p1 was acknowledged');
 const pending=x.posts[1].body.opId;
 x.setReply(b=>({ok:true,body:{opId:b.opId,ventaId:'receipt2',producto:{id:'p2'}}}));
 await x.run();
 assert.deepEqual([...x.remaining()],[]);
 assert.equal(x.posts[2].body.opId,pending);
});
test('C146: all three live UI sale paths require exact receipt ACK before any success action',()=>{
 const helper=app.slice(helpStart,helpEnd);
 assert.match(helper,/function _ocVentaReciboVerificado\(data,intento\)/);
 assert.equal((app.match(/_ocVentaReciboVerificado\(data,\s*intento\)/g)||[]).length,4,
   'one helper and three actual sale paths');
 assert.equal((app.match(/_ocVentaIntentoConfirmado\(intento\)/g)||[]).length,3,
   'each sale action still retires its stored opId only after verified receipt');
 const quick=app.slice(app.indexOf('async function venderUno('),app.indexOf('/* PANTALLA DE DATOS DE VENTA'));
 const modal=app.slice(app.indexOf('async function confirmarVentaConInfo('),app.indexOf('async function',app.indexOf('async function confirmarVentaConInfo(')+8));
 assert(quick.includes('_ocVentaReciboVerificado(data,intento)'));
 assert(modal.includes('_ocVentaReciboVerificado(data,intento)'));
});
