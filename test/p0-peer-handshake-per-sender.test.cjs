'use strict';
// RED A y RED B (hallazgos de OpenCode sobre el timeout de test/peer-sync-browser.test.js:167).
// Sin navegador: se ejercita la ruta REAL publicar()/manejar() de docs/sync-yjs.js con un socket
// falso peerOnly que cuenta lo que se escribe en la linea. Todo sintetico; sin red ni datos de clientes.
//   A: en peerOnly, el mismo ciphertext no debe salir por dos carriles (binary vivo + op durable).
//   B: el mismo vector de estado no debe recibir el estado completo mas de una vez en el handshake.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const block=src.slice(src.indexOf('  function _frame('),src.indexOf('  // Carga perezosa'));
const tick=()=>new Promise(r=>setImmediate(r));
async function settle(n=12){for(let i=0;i<n;i++){await tick();await new Promise(r=>setTimeout(r,0));}}
async function fixture(prepare){
  const sockets=[],timers=[],data=new Map();
  class Socket{constructor(){this.readyState=1;this.sent=[];this.peerOnly=true;sockets.push(this)}
    get bufferedAmount(){return 0}send(x){this.sent.push(x)}close(){this.readyState=3;this.onclose?.()}}
  const db={objectStoreNames:{contains:k=>k==='updates'},transaction(){const tx={};queueMicrotask(()=>tx.oncomplete?.());return tx}};
  const p={whenSynced:Promise.resolve(),db,get:async k=>structuredClone(data.get(k)),set:async(k,v)=>{data.set(k,structuredClone(v))}};
  const ctx={API:{clave:'synthetic',roomId:'synthetic'},RELAY_URL:'fixture:',crypto:crypto.webcrypto,
    WebSocket:class{constructor(){throw Error('raw relay fallback forbidden')}},
    window:{dispatchEvent(){},F123Relay:{connect:()=>new Socket()}},
    document:{hidden:false,visibilityState:'visible',addEventListener(){}},CustomEvent:class{},log(){},
    Date,Math,JSON,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder,setInterval,clearInterval,
    setTimeout(fn,ms){timers.push({fn,ms});return timers.length},clearTimeout(id){if(timers[id-1])timers[id-1].cancelled=true},
    btoa:s=>Buffer.from(s,'binary').toString('base64'),
    cifrarBin:async(_,b)=>b.slice().buffer,descifrarBin:async(_,b)=>new Uint8Array(b)};
  vm.createContext(ctx);vm.runInContext(block+'\nthis.make=crearCanal;',ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),ctx);
  const Y=ctx.Y,doc=new Y.Doc();if(prepare)prepare(Y,doc,ctx);
  const channel=ctx.make(Y,doc,'-y','fixture',true,null,p);channel.conectar();
  const ws=sockets[0];ws.onopen();await settle();
  return {Y,doc,channel,ws,ctx};
}
const sha=b=>crypto.createHash('sha1').update(Buffer.from(b)).digest('hex');
const SEED=()=>({id:'synthetic-sale',total:42.75,stock:7,history:['sale','payment'],photo:'synthetic-photo-'+'x'.repeat(220000)});

test('RED A: en peerOnly el mismo ciphertext no sale por el carril vivo Y por el durable',async()=>{
  const f=await fixture();
  const payload=new Uint8Array(220130);for(let i=0;i<payload.length;i++)payload[i]=(i*31+7)&255; // ~update de 220 KB (2 piezas)
  f.channel.enviarUpdate(payload);await settle(30);
  const live=f.ws.sent.filter(x=>typeof x!=='string').map(x=>new Uint8Array(x));
  const ops=f.ws.sent.filter(x=>typeof x==='string').map(x=>{try{return JSON.parse(x)}catch(_){return null}}).filter(m=>m&&m.k==='op');
  assert.ok(live.length>0||ops.length>0,'el fixture debe haber emitido algo');
  const liveHashes=new Set(live.map(sha)),opHashes=ops.map(o=>sha(Buffer.from(o.c,'base64')));
  const both=opHashes.filter(h=>liveHashes.has(h));
  const wireBytes=live.reduce((n,b)=>n+b.length,0)+ops.reduce((n,o)=>n+Buffer.from(o.c,'base64').length,0);
  assert.equal(both.length,0,`peerOnly envia ${both.length} pieza(s) por AMBOS carriles (binary vivo + op durable): `+
    `${wireBytes} bytes de ciphertext por un payload de ${payload.length} (${(wireBytes/payload.length).toFixed(2)}x)`);
  assert.ok(wireBytes<=payload.length*1.15,`bytes por la linea ${wireBytes} > 1.15x el payload ${payload.length}`);
});

test('RED B: el mismo vector de estado no recibe el estado completo mas de una vez en el handshake',async()=>{
  // El objeto debe crearse DENTRO del contexto vm: Yjs rechaza objetos de otro realm ('Unexpected content type').
  const f=await fixture((Y,doc,ctx)=>{doc.getMap('business').set('record',vm.runInContext('('+JSON.stringify(SEED())+')',ctx))});
  const empty=f.Y.encodeStateVector(new f.Y.Doc()),full=f.Y.encodeStateVector(f.doc);
  const frame=(tag,sv)=>{const b=new Uint8Array(1+sv.length);b[0]=tag;b.set(sv,1);return b.buffer};
  const from=(buf,peer)=>f.ws.onmessage({data:buf,relaySource:'peer',peerSenderId:peer});
  // Secuencia observada al entrar el 3er navegador: 'c' (vacio) y 'reopened' (completo) saludan (tag 1)
  // y luego contestan con su vector (tag 2). 'c' todavia no aplico nada, asi que su SV sigue vacio.
  from(frame(1,empty),'c'.repeat(32));await settle();from(frame(1,full),'b'.repeat(32));await settle();
  from(frame(2,empty),'c'.repeat(32));await settle();from(frame(2,full),'b'.repeat(32));await settle(30);
  const frames=f.ws.sent.filter(x=>typeof x!=='string').map(x=>new Uint8Array(x));
  const groups=new Map(); // emision = grupo de piezas (tag 3) o frame unico con tag 6
  for(const b of frames){
    if(b[0]===3&&b[1]===6){const id=Buffer.from(b.subarray(2,18)).toString('latin1');groups.set(id,(groups.get(id)||0)+b.length-22);}
    else if(b[0]===6)groups.set('single-'+groups.size,b.length-1);
  }
  const fullStates=[...groups.values()].filter(n=>n>=200000);
  assert.ok(fullStates.length>=1,'debe existir al menos una emision de estado completo para quien lo pide');
  assert.ok(fullStates.length<=1,`el estado completo (~220 KB) se emitio ${fullStates.length} veces para el mismo SV vacio; `+
    'cada emision se difunde ademas a TODOS los peers conectados (peer-sync Socket.send)');
});
test('P0: two different empty receivers both request and receive a complete state',async()=>{
  const f=await fixture((Y,doc,ctx)=>{doc.getMap('business').set('record',vm.runInContext('('+JSON.stringify(SEED())+')',ctx))});
  const empty=f.Y.encodeStateVector(new f.Y.Doc()),sv=Buffer.concat([Buffer.from([1]),Buffer.from(empty)]);
  const snapshot=()=>f.ws.sent.filter(x=>typeof x!=='string').map(x=>new Uint8Array(x)).filter(x=>x[0]===3&&x[1]===6).reduce((n,x)=>n+x.length-22,0);
  f.ws.onmessage({data:sv.buffer.slice(sv.byteOffset,sv.byteOffset+sv.length),relaySource:'peer',peerSenderId:'c'.repeat(32)});await settle(30);
  const first=snapshot();assert.ok(first>=200000,'first peer receives full state');
  f.ws.onmessage({data:sv.buffer.slice(sv.byteOffset,sv.byteOffset+sv.length),relaySource:'peer',peerSenderId:'d'.repeat(32)});await settle(30);
  assert.ok(snapshot()>=first+200000,'second distinct peer needs its own recovery regardless of duplicate SV');
});
test('P0: repeated hello from a peer is a recovery request and must not be suppressed',async()=>{
  const f=await fixture((Y,doc,ctx)=>{doc.getMap('business').set('record',vm.runInContext('('+JSON.stringify(SEED())+')',ctx))});
  const empty=f.Y.encodeStateVector(new f.Y.Doc()),sv=Buffer.concat([Buffer.from([1]),Buffer.from(empty)]);
  const from=()=>f.ws.onmessage({data:sv.buffer.slice(sv.byteOffset,sv.byteOffset+sv.length),relaySource:'peer',peerSenderId:'c'.repeat(32)});
  const responses=()=>f.ws.sent.filter(x=>typeof x!=='string').map(x=>new Uint8Array(x)).filter(x=>(x[0]===3&&x[1]===6)||x[0]===6).length;
  from();await settle(30);const one=responses();
  from();await settle(30);const two=responses();
  assert.ok(one>=2&&two===one*2,'repeated hello after prior best-effort snapshot needs a new full response');
});

test('P0: local document changed after hello, matching tag2 still receives a new diff',async()=>{
  const f=await fixture((Y,doc,ctx)=>{doc.getMap('business').set('record',vm.runInContext('('+JSON.stringify(SEED())+')',ctx))});
  const empty=f.Y.encodeStateVector(new f.Y.Doc()),frame=tag=>new Uint8Array([tag,...empty]).buffer;
  const origin='c'.repeat(32);
  const snapshots=()=>f.ws.sent.filter(x=>typeof x!=='string').map(x=>new Uint8Array(x)).filter(b=>b[0]===3&&b[1]===6).length;
  f.ws.onmessage({data:frame(1),relaySource:'peer',peerSenderId:origin});await settle(30);
  const before=snapshots();assert.ok(before>=2);
  f.doc.getMap('business').set('new-fact','recorded-after-hello');
  f.ws.onmessage({data:frame(2),relaySource:'peer',peerSenderId:origin});await settle(30);
  assert.ok(snapshots()>=before+2,'state-vector advancement must invalidate one-shot duplicate guard');
});
test('P0: legacy peer source metadata absent preserves unconditional handshake responses',async()=>{
  const f=await fixture((Y,doc,ctx)=>{doc.getMap('business').set('record',vm.runInContext('('+JSON.stringify(SEED())+')',ctx))});
  const empty=f.Y.encodeStateVector(new f.Y.Doc()),frame=tag=>new Uint8Array([tag,...empty]).buffer;
  const snapshots=()=>f.ws.sent.filter(x=>typeof x!=='string').map(x=>new Uint8Array(x)).filter(b=>b[0]===3&&b[1]===6).length;
  f.ws.onmessage({data:frame(1),relaySource:'peer'});await settle(30);
  const before=snapshots();assert.ok(before>=2);
  f.ws.onmessage({data:frame(2),relaySource:'peer'});await settle(30);
  assert.ok(snapshots()>=before+2,'old adapter without sender identity must never skip a potentially necessary reply');
});
test('P0: RTC adapter attaches real sender ID to reassembled binary event without wire change',async()=>{
  const win=new EventTarget(),document=new EventTarget();document.hidden=false;
  class WS{constructor(){this.readyState=0;}close(){this.readyState=3;}}
  class RTC{constructor(){this.connectionState='connected';this.signalingState='stable';}close(){this.connectionState='closed';}}
  Object.assign(win,{WebSocket:WS,RTCPeerConnection:RTC,crypto:crypto.webcrypto});
  const ctx={window:win,document,EventTarget,MessageEvent,Event,DOMException,Blob,ArrayBuffer,Uint8Array,Map,Set,Promise,queueMicrotask,TextEncoder,setTimeout,clearTimeout,
    btoa:x=>Buffer.from(x,'binary').toString('base64'),atob:x=>Buffer.from(x,'base64').toString('binary')};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/peer-sync.js'),'utf8'),ctx);
  const factory=win.F123Peer.create(),socket=factory.connect('wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+'a'.repeat(40));
  const peer=socket.hub.peer('b'.repeat(32));peer.dc={readyState:'open',bufferedAmount:0,send(){}};
  socket.open();let source=null,received=null;
  socket.onmessage=e=>{if(e.data instanceof ArrayBuffer){source=e.peerSenderId;received=Buffer.from(e.data);}};
  try {
    const data=Buffer.from([1,9,7]),packet={v:1,topic:socket.topic,type:'binary',data:data.toString('base64')};
    const wire=JSON.stringify({v:1,id:'f'.repeat(32),i:0,count:1,data:JSON.stringify(packet)});
    await socket.hub.receive(peer,wire);
    assert.equal(source,peer.id);
    assert.deepEqual(received,data);
  } finally {peer.dc.readyState='closed';factory.closeAll();win.F123Relay.closeAll();}
});

test('P0: deletion between hello and tag2 must not disappear behind unchanged Yjs state vector',async()=>{
  const f=await fixture((Y,doc,ctx)=>{doc.getMap('business').set('record',vm.runInContext('('+JSON.stringify(SEED())+')',ctx))});
  const empty=f.Y.encodeStateVector(new f.Y.Doc()),make=tag=>new Uint8Array([tag,...empty]).buffer;
  const origin='c'.repeat(32);
  f.ws.onmessage({data:make(1),relaySource:'peer',peerSenderId:origin});await settle(30);
  const localSvBefore=f.Y.encodeStateVector(f.doc);
  f.doc.getMap('business').delete('record');
  const localSvAfter=f.Y.encodeStateVector(f.doc);
  assert.deepEqual(Buffer.from(localSvAfter),Buffer.from(localSvBefore),'Yjs delete set can advance without new struct clocks');
  const n=f.ws.sent.filter(x=>typeof x!=='string').length;
  f.ws.onmessage({data:make(2),relaySource:'peer',peerSenderId:origin});await settle(30);
  assert.ok(f.ws.sent.filter(x=>typeof x!=='string').length>n,
    'tag2 after deletion requires an updated delete-set diff even when both state vectors are unchanged');
});
