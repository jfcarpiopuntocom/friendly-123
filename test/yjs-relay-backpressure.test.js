const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');

const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const block=src.slice(src.indexOf('  function _frame('),src.indexOf('  // Carga perezosa'));
const MAX_BUFFER=4*1024*1024,CHUNK=160*1024,tick=()=>new Promise(r=>setImmediate(r));
async function esperar(condicion,mensaje){const limite=Date.now()+2000;while(!condicion()&&Date.now()<limite)await new Promise(r=>setTimeout(r,1));assert.ok(condicion(),mensaje);}
function mensaje(x){try{return typeof x==='string'?JSON.parse(x):null}catch{return null}}

async function fixture(name='fixture'){
 const sockets=[],timers=[],data=new Map(),outbox={pending:Array.from({length:40},(_,i)=>({k:'op',ack:1,id:'old-'+i,lam:i,c:Buffer.alloc(48*1024,65).toString('base64')})),checkpoint:'',confirmed:[]};
 data.set('f123_relay_outbox_v1-y',outbox);
 let autoDrain=false,now=Date.now();
 class Socket{
  constructor(){this.readyState=0;this.bufferedAmount=0;this.sent=[];this.closeCode=0;sockets.push(this)}
  send(value){
   if(this.readyState!==1)throw Error('socket not open');
   const size=typeof value==='string'?Buffer.byteLength(value):value.byteLength??value.size;
   if(this.bufferedAmount+size>MAX_BUFFER){this.close(1013,'relay buffer full');throw Error('relay buffer full');}
   const copy=typeof value==='string'?value:new Uint8Array(value.slice?value.slice(0):value);
   this.sent.push(copy);this.bufferedAmount+=size;if(autoDrain)this.bufferedAmount=0;
  }
  close(code=1000){if(this.readyState>=2)return;this.closeCode=code;this.readyState=3;this.onclose?.()}
 }
 const p={get:async k=>structuredClone(data.get(k)),set:async(k,v)=>{data.set(k,structuredClone(v))}};
 const ctx={API:{clave:'synthetic',roomId:'synthetic'},RELAY_URL:'fixture:',crypto:require('node:crypto').webcrypto,
  window:{dispatchEvent(){},F123Relay:{connect:()=>new Socket()}},navigator:{},CustomEvent:class{},log(){},Date:class extends Date{static now(){return now}},Math,JSON,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder,setInterval,clearInterval,
  setTimeout(fn,ms){timers.push({fn,ms,cancelled:false,ran:false});return timers.length},clearTimeout(id){if(timers[id-1])timers[id-1].cancelled=true},
  btoa:s=>Buffer.from(s,'binary').toString('base64'),cifrarBin:async(_,b)=>b.slice().buffer,descifrarBin:async(_,b)=>new Uint8Array(b)};
 vm.createContext(ctx);vm.runInContext(block+'\nthis.make=crearCanal;',ctx);
 const Y={encodeStateAsUpdate:()=>new Uint8Array(20),encodeStateVector:()=>new Uint8Array([1]),applyUpdate(){}};
 const doc={store:{}};const channel=ctx.make(Y,doc,'-y',name,true,null,p);channel.conectar();
 for(let i=0;i<80;i++){const frame=new Uint8Array(CHUNK);frame[0]=3;channel.pend.push(frame)}
 return {channel,sockets,timers,data,doc,api:ctx.API,setAutoDrain(v){autoDrain=v},advance(ms){now+=ms},p};
}

test('PIN eligibility waits for the terminal page and ignores a replaced socket after persistence',async()=>{
 const a=await fixture('catalogo');a.setAutoDrain(true);a.channel.pend.length=0;
 let applied=0;a.api._store={aplicar(){applied++}};
 const socket=a.sockets[0];socket.readyState=1;socket.onopen();await tick();await tick();
 assert.equal(a.channel.recuperando,true);
 socket.onmessage({data:JSON.stringify({k:'pull-page',rev:1,seq:1,more:true})});await tick();await tick();
 assert.equal(a.channel.recuperando,true,'an intermediate page cannot unlock PIN adoption');
 let release;const originalSet=a.p.set;a.p.set=(key,value)=>key.includes('pull_cursor')?new Promise(resolve=>{release=resolve}):originalSet(key,value);
 socket.onmessage({data:JSON.stringify({k:'pull-page',rev:1,seq:2,more:false})});await tick();await tick();
 assert.equal(typeof release,'function','terminal cursor persistence is pending');
 a.channel.ws={readyState:1};release();await tick();await tick();
 assert.equal(a.channel.recuperando,true,'old sockets cannot finish a new recovery');assert.equal(applied,0);
 a.channel.ws=socket;a.p.set=originalSet;
 socket.onmessage({data:JSON.stringify({k:'pull-page',rev:1,seq:3,more:false})});await tick();await tick();
 assert.equal(a.channel.recuperando,false);assert.equal(applied,1,'final metadata is applied without requiring another update');
});

test('a terminal page with missing fragments or Yjs dependencies cannot unlock PIN adoption',async()=>{
 for(const incomplete of ['fragment','struct','delete']){
  const a=await fixture('catalogo');a.setAutoDrain(true);a.channel.pend.length=0;
  let applied=0;a.api._store={aplicar(){applied++}};
  const socket=a.sockets[0];socket.readyState=1;socket.onopen();await tick();await tick();
  if(incomplete==='fragment'){
   const frame=new Uint8Array(23);frame[0]=3;frame[1]=0;frame.fill(65,2,18);frame[21]=2;frame[22]=1;
   socket.onmessage({data:frame.buffer});
  }else a.doc.store[incomplete==='struct'?'pendingStructs':'pendingDs']={};
  socket.onmessage({data:JSON.stringify({k:'pull-page',rev:1,seq:1,more:false})});await tick();await tick();
  assert.equal(a.channel.recuperando,true,incomplete+' must keep access recovery protected');assert.equal(applied,0);
 }
});

test('backpressure drains live chunks and durable replay without closing, duplicate inflight IDs, or starving a new small update',async()=>{
 const a=await fixture(),first=a.sockets[0];first.readyState=1;
 let firstOpenError=false;try{first.onopen()}catch{firstOpenError=true}
 const small=Uint8Array.from([0x71,0x72,0x73]);a.channel.enviarUpdate(small);
 await esperar(()=>a.data.get('f123_relay_outbox_v1-y').pending.length===41,'the small live update remains durably queued');
 const smallEntry=a.data.get('f123_relay_outbox_v1-y').pending.find(e=>{const b=Buffer.from(e.c,'base64');return b[0]===0&&b[1]===small[0]&&b[2]===small[1]&&b[3]===small[2]});
 assert.ok(smallEntry,'the small update has a durable outbox identity');

 // Recovery is driven locally: force a new connection if the current source closed,
 // then let the fake network drain on each send so every retained frame can progress.
 let pumpRounds=0;
 if(a.channel.ws?.readyState!==1){
  a.setAutoDrain(true);a.channel.conectar();const retry=a.sockets.at(-1);retry.readyState=1;try{retry.onopen()}catch{}
 }
 else {
  for(let round=0;round<80&&a.channel.pend.length;round++){
   a.channel.ws.bufferedAmount=0;
   const pumps=a.timers.filter(t=>!t.cancelled&&!t.ran&&t.ms<=500);if(pumps.length)pumpRounds++;pumps.forEach(t=>{t.ran=true;t.fn()});
   await tick();
  }
 }
 await esperar(()=>a.sockets.some(s=>s.sent.some(x=>x instanceof Uint8Array&&x.length===4&&x[0]===0&&x[1]===small[0]&&x[2]===small[1]&&x[3]===small[2])),
  'the new small update is sent while older chunks remain queued');
 const liveSent=a.sockets.reduce((n,s)=>n+s.sent.filter(x=>x instanceof Uint8Array&&x.length===CHUNK).length,0);

 const socket=a.channel.ws;assert.ok(socket&&socket.readyState===1,'retry leaves a connected relay socket');
 // Transport buffering drops when the network finishes a send, independently of durable ACKs.
 socket.bufferedAmount=0;a.setAutoDrain(true);
 const sentIds=()=>socket.sent.map(mensaje).filter(m=>m?.k==='op').map(m=>m.id);
 await esperar(()=>sentIds().length>=4,'durable replay starts after reconnect');
 const batch=sentIds().slice();
 const smallPrioritized=batch.includes(smallEntry.id);
 const durableTimers=a.timers.filter(t=>!t.cancelled&&!t.ran&&t.ms>=1600&&t.ms<=2400);
 if(durableTimers.length){durableTimers[0].ran=true;durableTimers[0].fn();await tick();await tick()}
 const duplicateInflight=sentIds().some((id,i,ids)=>ids.indexOf(id)!==i);
 const initialIds=new Set(sentIds());
 for(const id of initialIds)socket.onmessage({data:JSON.stringify({k:'persist-result',kind:'op',id,ok:true})});
 await esperar(()=>a.data.get('f123_relay_outbox_v1-y').pending.length===41-initialIds.size,'durable ACKs release the first replay batch');
 for(let round=0;round<20&&a.data.get('f123_relay_outbox_v1-y').pending.length;round++){
  const pending=a.data.get('f123_relay_outbox_v1-y').pending;
  const controls=new Set(sentIds());
  const deliverable=pending.filter(entry=>controls.has(entry.id));
  if(deliverable.length){
   const before=pending.length;
   for(const entry of deliverable)socket.onmessage({data:JSON.stringify({k:'persist-result',kind:'op',id:entry.id,ok:true})});
   await esperar(()=>a.data.get('f123_relay_outbox_v1-y').pending.length===before-deliverable.length,'durable ACKs release each replay batch');
   continue;
  }
  const timer=a.timers.filter(t=>!t.cancelled&&!t.ran&&t.ms<=500).sort((x,y)=>x.ms-y.ms)[0] || a.timers.filter(t=>!t.cancelled&&!t.ran&&t.ms>=1600&&t.ms<30000&&t.ms!==2500).sort((x,y)=>x.ms-y.ms)[0];
  if(!timer)break;timer.ran=true;timer.fn();await tick();await tick();
 }
 const allDurableSent=new Set(sentIds());
 assert.equal(a.data.get('f123_relay_outbox_v1-y').pending.length,0,'only true durable ACKs remove replay entries');
 assert.equal(allDurableSent.size,41,'all original and new durable entries were replayed');
 assert.equal(first.readyState,1,'the initial backlog must not overflow and close the socket');
 assert.equal(firstOpenError,false,'the open handler must survive bounded queue draining');
 assert.equal(liveSent,80,'every queued live chunk survives repeated buffer-full drain rounds');
 assert.ok(pumpRounds>=2,'the connected socket resumes the queue over multiple short pump rounds');
 assert.equal(duplicateInflight,false,'an unacknowledged durable ID is sent only once per connection');
 assert.equal(smallPrioritized,true,'the newest small update gets a replay slot ahead of historical backlog');
});

test('lost ACKs retry exact identities, wrong-kind and stale-socket ACKs cannot confirm data',async()=>{
 const a=await fixture();a.setAutoDrain(true);const socket=a.sockets[0];socket.readyState=1;socket.onopen();
 const operations=s=>s.sent.map(mensaje).filter(m=>m?.k==='op');
 await esperar(()=>operations(socket).length===4,'the durable window is bounded');
 const first=operations(socket).slice();
 socket.onmessage({data:JSON.stringify({k:'persist-result',kind:'ckpt',id:first[0].id,ok:true})});await tick();await tick();
 assert.equal(a.data.get('f123_relay_outbox_v1-y').pending.length,40,'the wrong ACK kind cannot erase an operation');
 assert.equal(operations(socket).length,4,'wrong-kind ACK cannot release an in-flight slot');
 const watch=a.timers.find(t=>!t.cancelled&&!t.ran&&t.ms===10000);assert.ok(watch,'missing ACK has a bounded watchdog');
 a.advance(10001);watch.ran=true;watch.fn();
 await esperar(()=>operations(socket).length===8,'an absent ACK retries rather than stranding the outbox');
 assert.deepEqual(operations(socket).slice(4).map(o=>[o.id,o.c]),first.map(o=>[o.id,o.c]),'retry preserves exact IDs and ciphertext');
 assert.equal(a.data.get('f123_relay_outbox_v1-y').pending.length,40,'watchdog cannot fake an ACK');
 socket.close();a.channel.conectar();const next=a.sockets.at(-1);next.readyState=1;next.onopen();
 await esperar(()=>operations(next).length===4,'reconnection retries preserved operations');
 socket.onmessage({data:JSON.stringify({k:'persist-result',kind:'op',id:first[0].id,ok:true})});await tick();await tick();
 assert.equal(a.data.get('f123_relay_outbox_v1-y').pending.length,40,'a replaced socket cannot acknowledge this connection');
 const acknowledged=operations(next)[0];next.onmessage({data:JSON.stringify({k:'persist-result',kind:'op',id:acknowledged.id,ok:true})});
 await esperar(()=>a.data.get('f123_relay_outbox_v1-y').pending.length===39,'only the exact ACK on the current socket confirms an operation');
 assert(!a.data.get('f123_relay_outbox_v1-y').pending.some(e=>e.id===acknowledged.id));
});

test('an open socket with a stalled buffer reconnects without discarding queued data',async()=>{
 const a=await fixture(),socket=a.sockets[0];socket.readyState=1;socket.onopen();await tick();await tick();
 const pendingBefore=a.channel.pend.length,storedBefore=JSON.stringify(a.data.get('f123_relay_outbox_v1-y'));
 assert(pendingBefore>0,'backpressure retains the unsent live queue');
 a.advance(10001);const pump=a.timers.find(t=>!t.cancelled&&!t.ran&&t.ms===100);assert.ok(pump);pump.ran=true;pump.fn();
 assert.equal(socket.readyState,3,'a half-open stalled socket cannot poll forever');
 assert.equal(a.channel.pend.length,pendingBefore,'reconnection retains every unsent live frame');
 assert.equal(JSON.stringify(a.data.get('f123_relay_outbox_v1-y')),storedBefore,'stalled transport cannot clear persisted updates');
 assert(a.timers.some(t=>!t.cancelled&&!t.ran&&t.ms!==100),'existing reconnect backoff remains available');
});
