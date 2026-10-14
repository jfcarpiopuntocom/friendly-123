// v514 (JFC 2026-10-14, "fix fix fix"): los cuatro fallos que Codex reprodujo en v512.
// 1) caer el relay cerraba la conexion directa que seguia viva entre aparatos;
// 2) si fallaba la huella (SHA-256) el cambio no quedaba pendiente;
// 3) si el envio por la red fallaba justo en ese momento, tampoco quedaba pendiente;
// 4) si fallaba la cache local, el service worker contestaba "Offline" aunque hubiera red.
// Montaje copiado de test/yjs-durable-outbox.test.js (Codex), con opciones extra.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const block=src.slice(src.indexOf('  function _frame('),src.indexOf('  // Carga perezosa'));
const tick=()=>new Promise(r=>setImmediate(r));
async function fixture(opts={}){
 const data=new Map(),sockets=[],timers=[];
 class Socket{constructor(){this.readyState=1;this.sent=[];sockets.push(this)}send(x){if(opts.sendThrows&&typeof x!=='string')throw Error('socket closing');this.sent.push(x)}}
 const p={get:async k=>structuredClone(data.get(k)),set:async(k,v)=>{data.set(k,structuredClone(v))}};
 const ctx={API:{clave:'synthetic',roomId:'synthetic'},RELAY_URL:'fixture:',WebSocket:Socket,
  window:{dispatchEvent(){}},CustomEvent:class{},log(){},Date,Math,JSON,Uint8Array,ArrayBuffer,
  setTimeout(fn,ms){timers.push({fn,ms});return timers.length},clearTimeout(){},
  btoa:s=>Buffer.from(s,'binary').toString('base64'),
  cifrarBin:async(_,b)=>b.slice().buffer,descifrarBin:async(_,b)=>new Uint8Array(b),...(opts.ctx||{})};
 vm.createContext(ctx);vm.runInContext(block+'\nthis.make=crearCanal;',ctx);
 const Y={encodeStateAsUpdate:()=>Uint8Array.from({length:20},(_,i)=>i),encodeStateVector:()=>new Uint8Array([1]),applyUpdate(){}};
 const channel=ctx.make(Y,{},'-y','fixture',true,null,p);channel.conectar();
 sockets[0].onopen();await tick();await tick();
 return {data,timers,channel,socket:sockets[0]};
}
const pendientes=(f)=>((f.data.get('f123_relay_outbox_v1-y')||{}).pending||[]).filter(x=>x.k==='op');

test('2) si falla la huella SHA-256, el cambio igual queda pendiente para el relay',async()=>{
 const f=await fixture({ctx:{crypto:{subtle:{digest:async()=>{throw Error('digest unavailable')}}},TextEncoder}});
 f.channel.enviarUpdate(new Uint8Array([7,7,7]));for(let i=0;i<6;i++)await tick();
 assert.equal(pendientes(f).length,1);
});
test('3) si el envio por la red falla en ese instante, el cambio igual queda pendiente',async()=>{
 const f=await fixture({sendThrows:true});
 f.channel.enviarUpdate(new Uint8Array([8,8,8]));for(let i=0;i<6;i++)await tick();
 assert.equal(pendientes(f).length,1);
});
test('1) caer el relay no cierra las conexiones directas que siguen vivas',()=>{
 const onclose=src.slice(src.indexOf('      ws.onclose = function () {'),src.indexOf('      ws.onerror'));
 assert.ok(onclose.length>50);
 assert.doesNotMatch(onclose,/pc\.close\(\)/,'onclose del relay no debe cerrar pares directos');
});
test('4) si falla la cache local, el archivo del shell se pide a la red y no se responde Offline',async()=>{
 const sw=fs.readFileSync(path.join(__dirname,'../docs/sw.js'),'utf8');
 const a=sw.indexOf('      if (esArchivoDelShell) {'),b=sw.indexOf('        return;',a);
 const rama=sw.slice(a,b);
 let red=0,offline=0,respuesta;
 const ctx={caches:{open:async()=>{throw Error('cache broken')}},CACHE_LOCAL:'x',
  fetch:async()=>{red++;return {ok:true,clone(){return this}}},guardar:r=>r,respuestaOffline:()=>{offline++;return 'OFFLINE'},
  evento:{request:{},respondWith(p){respuesta=p}}};
 vm.createContext(ctx);vm.runInContext(rama.replace('      if (esArchivoDelShell) {','{')+'}',ctx);
 await respuesta;
 assert.equal(red,1,'hay red: se pide el archivo');assert.equal(offline,0,'no se responde Offline con red disponible');
});
