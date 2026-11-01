'use strict';
// Oversized legacy outbox: absorbed by ONE durable full-state update, never by replaying every envelope.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const block=src.slice(src.indexOf('  function _frame('),src.indexOf('  // Carga perezosa'));
const yjs=fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
const KEY='f123_relay_outbox_v1-y';
async function settle(n=20){for(let i=0;i<n;i++)await tick();}
function controls(socket,kind){return socket.sent.filter(x=>typeof x==='string').map(JSON.parse).filter(x=>x.k===kind);}

// Synthetic only: a device whose Y.Doc already holds every change its legacy envelopes carry.
async function device(nLegacy){
 const sockets=[],timers=[],data=new Map();
 class Socket{constructor(){this.readyState=1;this.sent=[];sockets.push(this)}send(x){this.sent.push(x)}close(){this.readyState=3;this.onclose?.()}}
 const db={objectStoreNames:{contains:k=>k==='updates'},transaction(){const tx={};queueMicrotask(()=>tx.oncomplete?.());return tx;}};
 const p={whenSynced:Promise.resolve(),db,get:async k=>structuredClone(data.get(k)),set:async(k,v)=>{data.set(k,structuredClone(v))}};
 const ctx={API:{clave:'synthetic',roomId:'synthetic'},RELAY_URL:'fixture:',crypto:require('node:crypto').webcrypto,
  WebSocket:class{constructor(){throw Error('raw relay forbidden')}},
  window:{dispatchEvent(){},F123Relay:{connect:()=>new Socket()}},
  document:{hidden:false,visibilityState:'visible',addEventListener(){}},
  CustomEvent:class{},log(){},Date,Math,JSON,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder,setInterval,clearInterval,
  setTimeout(fn,ms){timers.push({fn,ms});return timers.length},clearTimeout(id){if(timers[id-1])timers[id-1].cancelled=true},
  btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),
  cifrarBin:async(_,b)=>b.slice().buffer,descifrarBin:async(_,b)=>new Uint8Array(b)};
 vm.createContext(ctx);vm.runInContext(yjs,ctx);vm.runInContext(block+'\nthis.make=crearCanal;',ctx);
 const Y=ctx.Y,doc=new Y.Doc(),pending=[];
 doc.on('update',u=>{ // the production order: Yjs applies first, the envelope is queued after
  const frame=Buffer.concat([Buffer.from([0]),Buffer.from(u)]);
  pending.push({k:'op',ack:1,id:(Date.now()-60000).toString(36)+'-'+String(pending.length).padStart(6,'0'),lam:pending.length,c:frame.toString('base64')});
 });
 for(let i=0;i<nLegacy;i++)doc.getMap('productos').set('p'+i,'x'.repeat(600)+i);
 data.set(KEY,{pending,confirmed:[],checkpoint:''});
 const channel=ctx.make(Y,doc,'-y','catalogo',true,null,p);channel.conectar();
 const s=sockets[0];s.onopen();await settle(4);
 s.onmessage({data:JSON.stringify({k:'head-result',unsupported:true})});await settle(4);
 s.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:0,more:false})});await settle(4);
 const legacyIds=new Set(pending.map(x=>x.id)),acked=new Set();
 return {Y,doc,data,timers,channel,socket:s,legacyIds,
  async drain(){for(let r=0;r<3;r++){timers.filter(t=>!t.cancelled&&!t.done&&t.ms<=60000*1.2&&t.ms>=1000&&t.ms!==30000).forEach(t=>{t.done=true;t.fn();});await settle();}},
  async ackInitial(){ // the in-flight window was filled with legacy envelopes before recovery ended
   const first=controls(s,'op').map(x=>x.id).filter(id=>legacyIds.has(id));first.forEach(id=>acked.add(id));
   for(const id of first){s.onmessage({data:JSON.stringify({k:'persist-result',id,kind:'op',ok:true})});await settle();}
   return first;},
  acked,absOps(){return controls(s,'op').filter(x=>!legacyIds.has(x.id));},
  queue(){return data.get(KEY).pending;}};
}
function assemble(ops){ // receiver side: join the fragmented tag-0 group exactly like manejar()
 const frames=ops.map(o=>Buffer.from(o.c,'base64'));
 if(frames.length===1&&frames[0][0]===0)return frames[0].subarray(1);
 frames.sort((a,b)=>(a[18]*256+a[19])-(b[18]*256+b[19]));
 assert.ok(frames.every(f=>f[0]===3&&f[1]===0&&f[20]*256+f[21]===frames.length),'one complete group');
 return Buffer.concat(frames.map(f=>f.subarray(22)));
}

test('(a)+(c) 600 legacy envelopes: one full-state group goes first; its durable ACK retires exactly them; receiver converges',async()=>{
 const a=await device(600);await a.ackInitial();await settle(40); // absorption starts once recovery ended
 const initial=await a.ackInitial();await a.drain();
 assert.ok(a.queue().filter(x=>x.abs).length>=2,'full state is published as one fragmented durable group');
 const order=controls(a.socket,'op').map(x=>a.legacyIds.has(x.id)?'L':'A').join(''),nAbs=a.queue().filter(x=>x.abs).length;
 assert.equal(order.slice(order.indexOf('A'),order.indexOf('A')+nAbs),'A'.repeat(nAbs),'absorbing group drains before the legacy backlog: '+order);
 const marca=a.queue().find(x=>x.abs).abs;
 assert.ok(a.queue().filter(x=>x.abs).every(x=>x.abs.n===marca.n&&marca.n>590&&marca.n<=600),'marker records the absorbed count');
 // A change made after the encode must survive retirement.
 const sv=a.Y.encodeStateVector(a.doc);a.doc.getMap('productos').set('posterior','nuevo');
 a.channel.enviarUpdate(a.Y.encodeStateAsUpdate(a.doc,sv));await settle();
 const later=a.queue().filter(x=>!a.legacyIds.has(x.id)&&!x.abs);
 assert.equal(later.length,1);
 const absIds=new Set(a.queue().filter(x=>x.abs).map(x=>x.id)),absTotal=absIds.size;
 for(let i=0;i<10&&new Set(a.absOps().map(x=>x.id)).size<absTotal;i++){
  for(const id of new Set(a.absOps().map(x=>x.id)))a.socket.onmessage({data:JSON.stringify({k:'persist-result',id,kind:'op',ok:true})});
  await settle();await a.drain();}
 const ids=[...new Set(a.absOps().map(x=>x.id))];
 for(const id of ids){a.socket.onmessage({data:JSON.stringify({k:'persist-result',id,kind:'op',ok:true})});await settle();await a.drain();}
 await settle(40);
 const q=a.queue();
 assert.equal(q.filter(x=>a.legacyIds.has(x.id)).length,0,'legacy envelopes retired after the whole group ACK');
 assert.ok(q.some(x=>x.id===later[0].id),'envelope created after the encode is never retired');
 const ev=a.data.get('f123_relay_absorcion-y');
 assert.equal(ev.n,600-a.acked.size,'every legacy envelope is either ACKed itself or absorbed');assert.equal(ev.absorbidoHasta,marca.hasta);assert.match(ev.sha256,/^[0-9a-f]{64}$/);assert.ok(ev.primero&&ev.ultimo&&ev.at&&ev.absorbidoHasta);
 assert.ok(JSON.stringify(ev).length<1024,'evidence never copies ciphertexts');
 // (c) a fresh receiver applying only the absorbing update converges to the sender's legacy state.
 const groups=new Map();for(const o of a.absOps()){if(absIds.has(o.id)&&!groups.has(o.id))groups.set(o.id,o);}
 const r=new a.Y.Doc();a.Y.applyUpdate(r,assemble([...groups.values()]));
 const sent=r.getMap('productos').toJSON(),own=a.doc.getMap('productos').toJSON();delete own.posterior;
 assert.equal(Object.keys(sent).length,600);assert.deepEqual(sent,own);
});

test('(b) failed ACK or disconnect leaves the legacy queue intact',async()=>{
 const a=await device(600);await a.ackInitial();await settle(40);const initial=await a.ackInitial();await a.drain();
 const ids=[...new Set(a.absOps().map(x=>x.id))];assert.ok(ids.length);
 for(const id of ids)a.socket.onmessage({data:JSON.stringify({k:'persist-result',id,kind:'op',ok:false})});
 await settle(40);
 assert.equal(a.queue().filter(x=>a.legacyIds.has(x.id)).length,600-initial.length,'rejected absorption retires nothing');
 a.socket.onmessage({data:JSON.stringify({k:'persist-result',id:ids[0],kind:'op',ok:true})});a.socket.close();await settle(40);
 assert.equal(a.queue().filter(x=>a.legacyIds.has(x.id)).length,600-initial.length,'a partial group ACK plus disconnect retires nothing');
 assert.ok(a.queue().some(x=>x.abs),'the absorbing group stays queued for retry');
});

test('(d) a queue of 512 or fewer envelopes is not absorbed',async()=>{
 const a=await device(500);await a.drain();
 assert.equal(a.absOps().length,0);assert.equal(a.queue().filter(x=>x.abs).length,0);
 assert.equal(a.queue().length,500);
});
test('photos channel never absorbs by full state (owner priority: inventory, money, movements)',()=>{
 const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'../docs/sync-yjs.js'),'utf8');
 const i=src.indexOf('function absorberHeredado() {');
 require('node:assert/strict').match(src.slice(i,i+400),/if \(nombre === "fotos"\) return;/);
});
