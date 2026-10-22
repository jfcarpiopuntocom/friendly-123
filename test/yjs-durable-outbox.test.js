const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const block=src.slice(src.indexOf('  function _frame('),src.indexOf('  // Carga perezosa'));
const tick=()=>new Promise(r=>setImmediate(r));
async function esperar(condicion,mensaje){
 const limite=Date.now()+2000;
 while(!condicion()&&Date.now()<limite)await new Promise(r=>setTimeout(r,1));
 assert.ok(condicion(),mensaje);
}
async function fixture(data=new Map(),locks,adapterMissing=false,realY=false){
 const sockets=[],timers=[];let rawCalls=0;
 class Socket{constructor(){this.readyState=1;this.sent=[];sockets.push(this)}send(x){this.sent.push(x)}close(){this.readyState=3;this.onclose?.()}}
 // Synthetic IDB hydration proof + transaction barrier; no customer storage.
 const db={objectStoreNames:{contains:k=>k==='updates'},transaction(){
  const tx={};queueMicrotask(()=>tx.oncomplete?.());return tx;
 }};
 const p={whenSynced:Promise.resolve(),db,
  get:async k=>structuredClone(data.get(k)),set:async(k,v)=>{data.set(k,structuredClone(v))}};
 const ctx={API:{clave:'synthetic',roomId:'synthetic'},RELAY_URL:'fixture:',crypto:require('node:crypto').webcrypto,WebSocket:class{constructor(){rawCalls++;throw Error('Raw relay fallback forbidden')}},
  window:{dispatchEvent(){},F123Relay:{connect:()=>new Socket()}},navigator:locks?{locks}:undefined,
  document:{hidden:false,visibilityState:'visible',addEventListener(){}},
  CustomEvent:class{},log(){},Date,Math,JSON,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder,setInterval,clearInterval,
  setTimeout(fn,ms){timers.push({fn,ms});return timers.length},clearTimeout(id){if(timers[id-1])timers[id-1].cancelled=true},
  btoa:s=>Buffer.from(s,'binary').toString('base64'),
  cifrarBin:async(_,b)=>b.slice().buffer,descifrarBin:async(_,b)=>new Uint8Array(b)};
 if(adapterMissing)delete ctx.window.F123Relay;
 vm.createContext(ctx);vm.runInContext(block+'\nthis.make=crearCanal;',ctx);
 if(realY)vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),ctx);
 const Y=realY?ctx.Y:{encodeStateAsUpdate:()=>Uint8Array.from({length:20},(_,i)=>i),encodeStateVector:()=>new Uint8Array([1]),applyUpdate(){}};
 const doc=realY?new Y.Doc():{};
 const channel=ctx.make(Y,doc,'-y','fixture',true,null,p);channel.conectar();
 if(sockets[0]){
  sockets[0].onopen();await tick();await tick();
  // This fixture simulates an older relay without HEAD support; real catch-up
  // must explicitly fall back to the durable pull-page protocol.
  sockets[0].onmessage({data:JSON.stringify({k:"head-result",unsupported:true})});await tick();await tick();
  sockets[0].onmessage({data:JSON.stringify({k:"pull-page",rev:0,seq:0,more:false})});await tick();await tick();
 }
 return {Y,doc,data,timers,channel,socket:sockets[0],sockets,p,ctx,get rawCalls(){return rawCalls},restoreAdapter(){ctx.window.F123Relay={connect:()=>new Socket()}}};
}
test('unacknowledged encrypted update survives reload and is removed only after durable ack',async()=>{
 const a=await fixture();a.channel.enviarUpdate(new Uint8Array([4,5,6]));await esperar(()=>controls(a.socket,"op").length===1,"encrypted operation reaches the durable relay");
 const sent=a.socket.sent.filter(x=>typeof x==='string').map(JSON.parse).find(x=>x.k==='op');
 assert.ok(sent);assert.equal(sent.ack,1);
 const b=await fixture(a.data);
 const retried=b.socket.sent.filter(x=>typeof x==='string').map(JSON.parse).find(x=>x.k==='op');
 assert.equal(retried?.id,sent.id,'reload retries the same id and ciphertext');
 b.socket.onmessage({data:JSON.stringify({k:'persist-result',id:sent.id,kind:'op',ok:false})});await tick();
 const c=await fixture(a.data);assert.ok(c.socket.sent.some(x=>typeof x==='string'&&JSON.parse(x).id===sent.id),'rejection retains the pending operation');
 c.socket.onmessage({data:JSON.stringify({k:'persist-result',id:sent.id,kind:'op',ok:true})});await tick();await tick();
 const d=await fixture(a.data);assert.ok(!d.socket.sent.some(x=>typeof x==='string'&&JSON.parse(x).id===sent.id));
});
test('failed local outbox write never reports a remote durable send',async()=>{
 const a=await fixture();a.p.set=async()=>{throw Error('disk full')};
 a.channel.enviarUpdate(new Uint8Array([9]));await tick();await tick();
 assert.ok(!a.socket.sent.some(x=>typeof x==='string'&&JSON.parse(x).k==='op'),'do not discard a durable pending record on local failure');
});
test('two tabs retain each others unacknowledged updates under the shared lock',async()=>{
 const data=new Map();let queue=Promise.resolve();
 const locks={request(_name,fn){const next=queue.then(fn);queue=next.catch(()=>{});return next}};
 const a=await fixture(data,locks),b=await fixture(data,locks);
 a.channel.enviarUpdate(new Uint8Array([1]));b.channel.enviarUpdate(new Uint8Array([2]));
 // Real WebCrypto finishes on the worker pool, not after a fixed tick count.
 await esperar(()=>data.get('f123_relay_outbox_v1-y')?.pending.length===2,'both tab updates must reach durable storage');
 const saved=data.get('f123_relay_outbox_v1-y');assert.equal(saved.pending.length,2);
 const op=saved.pending[0];
 a.socket.onmessage({data:JSON.stringify({k:'persist-result',id:op.id,kind:'op',ok:true})});await tick();await tick();
 assert.equal(data.get('f123_relay_outbox_v1-y').pending.length,1,'one ack cannot erase the other tab');
});
test('acknowledged unchanged checkpoint is not rewritten after reload',async()=>{
 const a=await fixture();await a.timers.find(t=>t.ms===2500).fn();await tick();await tick();
 const ck=a.socket.sent.filter(x=>typeof x==='string').map(JSON.parse).find(x=>x.k==='ckpt');assert.ok(ck);
 a.socket.onmessage({data:JSON.stringify({k:'persist-result',id:ck.id,kind:'ckpt',ok:true})});await tick();await tick();
 const b=await fixture(a.data);await b.timers.find(t=>t.ms===2500).fn();await tick();await tick();
 assert.ok(!b.socket.sent.some(x=>typeof x==='string'&&JSON.parse(x).k==='ckpt'));
});

for (const next of [{rev:0,seq:2},{rev:1,seq:0}]) {
 test('checkpoint freezes the recovery cursor before encryption: '+JSON.stringify(next),async()=>{
  const a=await fixture();
  a.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:1,more:false})});await tick();
  let encrypted,finish;
  a.ctx.cifrarBin=(_key,bytes)=>new Promise(resolve=>{encrypted=bytes.slice();finish=()=>resolve(encrypted.buffer)});
  a.timers.find(t=>t.ms===2500).fn();
  assert.ok(finish,'encryption is in flight');
  a.socket.onmessage({data:JSON.stringify({k:'pull-page',...next,more:false})});await tick();await tick();
  finish();await tick();await tick();
  const ck=a.socket.sent.filter(x=>typeof x==='string').map(JSON.parse).find(x=>x.k==='ckpt');
  assert.ok(ck);
  assert.equal(ck.rev,0,'the encrypted snapshot cannot claim a later recovery generation');
  assert.equal(ck.seq,1,'the encrypted snapshot cannot compact operations received during encryption');
 });
}
test('an incomplete chunk group cannot be compacted by a checkpoint',async()=>{
 const a=await fixture();
 const chunk=new Uint8Array(24);chunk[0]=3;chunk[1]=0;chunk.fill(65,2,18);chunk[21]=2;
 a.socket.onmessage({data:chunk.buffer,relaySource:"pull"});
 a.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:1,more:false})});await tick();await tick();
 a.timers.find(t=>t.ms===2500).fn();await tick();await tick();
 assert.ok(!a.socket.sent.some(x=>typeof x==='string'&&JSON.parse(x).k==='ckpt'),
  'a received chunk is not yet part of the Yjs snapshot');
});
test('incomplete chunk pages replay after reload, then advance durable cursor only after reassembly',async()=>{
 const a=await fixture();
 const chunk=new Uint8Array(24);chunk[0]=3;chunk[1]=0;chunk.fill(65,2,18);chunk[21]=2;
 a.socket.onmessage({data:chunk.buffer,relaySource:"pull"});
 a.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:1,more:true})});await tick();await tick();
 assert.equal(a.data.get('f123_yjs_pull_cursor_v2-y').seq,0,
  'a reload must refetch a partial update because fragments are only in memory');
 const currentPull=a.socket.sent.filter(x=>typeof x==='string').map(JSON.parse).filter(x=>x.k==='pull').at(-1);
 assert.equal(currentPull.seq,1,'the live session still moves forward to fetch remaining chunks');
 const b=await fixture(new Map(a.data));
 const resumed=b.socket.sent.filter(x=>typeof x==='string').map(JSON.parse).find(x=>x.k==='pull');
 assert.equal(resumed.seq,0);
 const last=chunk.slice();last[19]=1;
 a.socket.onmessage({data:last.buffer,relaySource:"pull"});
 a.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:2,more:false})});await tick();await tick();
 assert.equal(a.data.get('f123_yjs_pull_cursor_v2-y').seq,2);
});


test('missing native adapter preserves durable outbox through reload and reconnect without a raw socket',async()=>{
 const a=await fixture(new Map(),undefined,true);
 assert.equal(a.sockets.length,0);assert.equal(a.channel.ws,null);assert.equal(a.rawCalls,0);
 assert.equal(a.timers.length,1,'failed connection schedules backoff');
 a.channel.enviarUpdate(new Uint8Array([7,8,9]));await esperar(()=>a.data.get("f123_relay_outbox_v1-y")?.pending.length===1,"encrypted operation persists while offline");
 const before=structuredClone(a.data.get('f123_relay_outbox_v1-y'));
 assert.equal(before.pending.length,1);assert.equal(a.channel.pendientesRelay,1);
 const b=await fixture(a.data,undefined,true);await tick();await tick();
 assert.equal(b.sockets.length,0);assert.equal(b.rawCalls,0);assert.deepEqual(b.data.get('f123_relay_outbox_v1-y'),before);
 b.restoreAdapter();b.timers[0].fn();
 assert.equal(b.sockets.length,1);b.sockets[0].onopen();await tick();await tick();
 const retried=b.sockets[0].sent.filter(x=>typeof x==='string').map(JSON.parse).find(x=>x.k==='op');
 assert.equal(retried.id,before.pending[0].id);assert.equal(retried.c,before.pending[0].c);
 assert.equal(b.data.get('f123_relay_outbox_v1-y').pending.length,1,'opening transport is not a durable acknowledgement');
 b.sockets[0].onmessage({data:JSON.stringify({k:'persist-result',kind:'op',id:retried.id,ok:true})});await tick();await tick();
 assert.equal(b.data.get('f123_relay_outbox_v1-y').pending.length,0,'only native durable acknowledgement clears the pending update');
});

function fragment(index=0,id=65){
 const bytes=new Uint8Array(24);bytes[0]=3;bytes[1]=0;bytes.fill(id,2,18);bytes[19]=index;bytes[21]=2;bytes[22]=index+1;return bytes;
}
function controls(socket,kind){return socket.sent.filter(x=>typeof x==='string').map(JSON.parse).filter(x=>x.k===kind)}
test('a fragmented update stores every sibling before the first durable send and retries the whole group',async()=>{
 const a=await fixture();let release;
 const waiting=new Promise(resolve=>{release=resolve});
 a.ctx.crypto={subtle:{digest:async(_algorithm,bytes)=>new Uint8Array([bytes[19]]).buffer}};
 a.ctx.cifrarBin=async(_key,bytes)=>{
  if(bytes[0]===3&&bytes[19]===1)await waiting;
  return bytes.slice().buffer;
 };
 const snapshots=[];const send=a.socket.send.bind(a.socket);
 a.socket.send=frame=>{if(typeof frame==='string'&&JSON.parse(frame).k==='op')snapshots.push(a.data.get('f123_relay_outbox_v1-y')?.pending.length);send(frame)};
 a.channel.enviarUpdate(new Uint8Array(350000));await tick();await tick();
 assert.equal(controls(a.socket,'op').length,0,'no durable orphan while a sibling is still being prepared');
 release();await esperar(()=>controls(a.socket,'op').length===3,'all siblings are sent');
 assert.deepEqual(snapshots,[3,3,3],'the complete group is locally durable before any fragment is sent');
 const entries=structuredClone(a.data.get('f123_relay_outbox_v1-y').pending);
 const b=await fixture(a.data);
 assert.deepEqual(controls(b.socket,'op').map(x=>[x.id,x.c]),entries.map(x=>[x.id,x.c]),'reload retries the same complete encrypted group');
});
test('an update prepared during an in-flight outbox write cannot be cleared from the next write',async()=>{
 const a=await fixture();let release,started;
 const initialLive=a.socket.sent.filter(x=>x instanceof ArrayBuffer).length;
 a.ctx.crypto={subtle:{digest:async(_algorithm,bytes)=>new Uint8Array([bytes[bytes.length-1]]).buffer}};
 const writing=new Promise(resolve=>{started=resolve}),blocked=new Promise(resolve=>{release=resolve});
 const save=a.p.set;a.p.set=async(key,value)=>{
  const snapshot=structuredClone(value);
  if(key==='f123_relay_outbox_v1-y'&&!release.done){started();await blocked;release.done=true}
  return save(key,snapshot);
 };
 a.channel.enviarUpdate(new Uint8Array([1]));await writing;
 a.channel.enviarUpdate(new Uint8Array([2]));await esperar(()=>a.socket.sent.filter(x=>x instanceof ArrayBuffer).length===initialLive+2,'both live updates finish preparation');
 release();await esperar(()=>controls(a.socket,'op').length===2,'both durable sends complete');
 assert.equal(a.data.get('f123_relay_outbox_v1-y').pending.length,2,'a later prepared update remains durably retryable');
});
test('failed fragment encryption never publishes a partial durable group',async()=>{
 const a=await fixture();let prepared=0;
 a.ctx.cifrarBin=async(_key,bytes)=>{
  prepared++;
  if(bytes[0]===3&&bytes[19]===1)throw Error('synthetic encryption failure');
  return bytes.slice().buffer;
 };
 a.channel.enviarUpdate(new Uint8Array(350000));
 await esperar(()=>prepared===3,'all fragment preparations run');await tick();await tick();
 assert.equal(controls(a.socket,'op').length,0);
 assert.equal(a.data.get('f123_relay_outbox_v1-y')?.pending.length||0,0);
});
test('abandoned live fragments cannot latch durable recovery or checkpoint creation',async()=>{
 const a=await fixture();
 a.socket.onmessage({data:fragment().buffer,relaySource:'live'});
 a.socket.onmessage({data:new Uint8Array([0,9]).buffer,relaySource:'pull'});
 a.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:1,more:false})});await tick();await tick();
 assert.equal(a.data.get('f123_yjs_pull_cursor_v2-y').seq,1);
 a.timers.find(t=>t.ms===2500).fn();await tick();await tick();
 assert.equal(controls(a.socket,'ckpt')[0]?.seq,1);
});
test('durable recovery cannot borrow live siblings to compact incomplete durable history',async()=>{
 const a=await fixture();let applied=0;a.Y.applyUpdate=()=>applied++;
 a.socket.onmessage({data:fragment().buffer,relaySource:'pull'});
 a.socket.onmessage({data:fragment(1).buffer,relaySource:'live'});
 a.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:1,more:true})});await tick();await tick();
 assert.equal(applied,0);
 assert.equal(a.data.get('f123_yjs_pull_cursor_v2-y').seq,0);
});
test('same-channel reconnection retains unfinished durable fragments and resumes after the RAM cursor',async()=>{
 const a=await fixture();let applied=0;a.Y.applyUpdate=()=>applied++;
 a.socket.onmessage({data:fragment().buffer,relaySource:'pull'});
 a.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:1,more:true})});await tick();await tick();
 assert.equal(a.data.get('f123_yjs_pull_cursor_v2-y').seq,0,'unassembled bytes never advance the durable cut');
 a.socket.onclose();a.channel.conectar();const next=a.sockets.at(-1);next.onopen();await tick();await tick();
 assert.equal(controls(next,'pull')[0]?.seq,1,'same live channel lifetime retains its RAM high-water cursor');
 next.onmessage({data:fragment(1).buffer,relaySource:'pull'});
 next.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:2,more:false})});await tick();await tick();
 assert.equal(applied,1,'the only post-reconnect sibling completes the retained first fragment');
 assert.equal(a.data.get('f123_yjs_pull_cursor_v2-y').seq,2,'durable progress advances only after the complete update is applied');
});

test('orphan durable history keeps live sync open without claiming its cursor or compacting',async()=>{
 const a=await fixture();
 let applied=0;a.Y.applyUpdate=()=>applied++;
 a.socket.onmessage({data:fragment().buffer,relaySource:'pull'});
 a.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:1,more:false})});await tick();await tick();
 assert.equal(a.socket.readyState,1);assert.equal(a.channel.ws,a.socket);
 assert.equal(a.data.get('f123_yjs_pull_cursor_v2-y').seq,0);
 a.timers.find(t=>t.ms===2500).fn();await tick();await tick();
 assert.equal(controls(a.socket,'ckpt').length,0,'orphan history cannot be compacted');
 a.socket.onmessage({data:new Uint8Array([0,9]).buffer,relaySource:'live'});await tick();await tick();
 assert.equal(applied,1,'a missing historical sibling cannot block a new live update');
 const retry=a.timers.filter(t=>t.ms===30000).at(-1);assert.ok(retry,'bounded recovery poll is scheduled');
 retry.fn();await tick();await tick();assert.equal(controls(a.socket,'pull').at(-1).seq,1,'same connection fetches only later rows');
 a.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:1,more:false})});await tick();await tick();
 const pendingRetry=a.timers.find(t=>t.ms===60000);assert.ok(pendingRetry,'unchanged incomplete history backs off instead of polling rapidly');
 a.socket.onmessage({data:fragment(1).buffer,relaySource:'pull'});
 a.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:2,more:false})});await tick();await tick();
 assert.equal(applied,2);assert.equal(a.data.get('f123_yjs_pull_cursor_v2-y').seq,2,'cursor advances only after durable sibling arrives');
 const before=controls(a.socket,'pull').length;
 assert.equal(pendingRetry.cancelled,true,'completing recovery cancels its pending timer');
 a.socket.close();pendingRetry.fn();await tick();await tick();
 assert.equal(controls(a.socket,'pull').length,before,'a delayed retry never sends to a closed socket');
});
test('real Yjs accepts fresh expenses while an older fragmented expense awaits its durable sibling',async()=>{
 const a=await fixture(new Map(),undefined,false,true),older=new a.Y.Doc(),fresh=new a.Y.Doc();
 older.getMap('gastos').set('older',vm.runInContext('({monto:18.5})',a.ctx));fresh.getMap('gastos').set('fresh',vm.runInContext('({monto:7.25})',a.ctx));
 const update=a.Y.encodeStateAsUpdate(older),middle=Math.ceil(update.length/2);
 const pieces=[update.subarray(0,middle),update.subarray(middle)].map((body,i)=>{
  const bytes=new Uint8Array(22+body.length);bytes[0]=3;bytes[1]=0;bytes.fill(80,2,18);bytes[19]=i;bytes[21]=2;bytes.set(body,22);return bytes;
 });
 a.socket.onmessage({data:pieces[0].buffer,relaySource:'pull'});
 a.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:1,more:false})});await tick();await tick();
 assert.equal(a.socket.readyState,1);assert.equal(a.doc.getMap('gastos').size,0);
 const live=a.Y.encodeStateAsUpdate(fresh),frame=new Uint8Array(live.length+1);frame[0]=0;frame.set(live,1);
 a.socket.onmessage({data:frame.buffer,relaySource:'live'});await tick();await tick();
 assert.equal(a.doc.getMap('gastos').get('fresh').monto,7.25);
 assert.equal(a.data.get('f123_yjs_pull_cursor_v2-y').seq,0);
 a.timers.filter(t=>t.ms===30000).at(-1).fn();await tick();await tick();
 a.socket.onmessage({data:pieces[1].buffer,relaySource:'pull'});
 a.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:2,more:false})});await tick();await tick();
 assert.equal(a.doc.getMap('gastos').get('older').monto,18.5);assert.equal(a.doc.getMap('gastos').get('fresh').monto,7.25);
 assert.equal(a.data.get('f123_yjs_pull_cursor_v2-y').seq,2);
 a.doc.destroy();older.destroy();fresh.destroy();
});

test('missing source metadata remains conservative and cannot authorize compaction',async()=>{
 const a=await fixture();a.socket.onmessage({data:fragment().buffer});
 a.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:1,more:true})});await tick();await tick();
 assert.equal(a.data.get('f123_yjs_pull_cursor_v2-y').seq,0);
 a.timers.find(t=>t.ms===2500).fn();await tick();assert.equal(controls(a.socket,'ckpt').length,0);
});

test('old durable fragments never expire into falsely confirmed progress, even above the live cache bound',async()=>{
 const a=await fixture();
 for(let id=1;id<=65;id++)a.socket.onmessage({data:fragment(0,id).buffer,relaySource:'pull'});
 a.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:65,more:true})});await tick();await tick();
 a.ctx.Date={now:()=>Date.now()+120001};
 a.socket.onmessage({data:new Uint8Array([0,9]).buffer,relaySource:'pull'});
 a.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:66,more:true})});await tick();await tick();
 assert.equal(a.data.get('f123_yjs_pull_cursor_v2-y').seq,0);
 for(let id=1;id<=65;id++)a.socket.onmessage({data:fragment(1,id).buffer,relaySource:'pull'});
 a.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:131,more:false})});await tick();await tick();
 assert.equal(a.data.get('f123_yjs_pull_cursor_v2-y').seq,131,'every old sibling remains available to complete its update');
});
test('live-only expired orphans release assembly capacity without obstructing durable progress',async()=>{
 const a=await fixture();let applied=0;a.Y.applyUpdate=()=>applied++;
 for(let id=1;id<=64;id++)a.socket.onmessage({data:fragment(0,id).buffer,relaySource:'live'});await tick();await tick();
 a.ctx.Date={now:()=>Date.now()+120001};
 a.socket.onmessage({data:fragment(0,66).buffer,relaySource:'live'});
 a.socket.onmessage({data:fragment(1,66).buffer,relaySource:'live'});
 a.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:1,more:false})});await tick();await tick();
 assert.equal(applied,1);assert.equal(a.data.get('f123_yjs_pull_cursor_v2-y').seq,1);
});
test('real Yjs replay after interruption retains the first payload fragment and applies duplicate remainder idempotently',async()=>{
 const a=await fixture(new Map(),undefined,false,true),source=new a.Y.Doc();
 let applied=0;a.doc.on('update',(_update,origin)=>{if(origin==='red')applied++});
 source.getMap('sales').set('synthetic-sale','x'.repeat(350000));
 const update=a.Y.encodeStateAsUpdate(source),chunks=[];
 for(let i=0;i<3;i++){
  const body=update.subarray(i*160*1024,(i+1)*160*1024),bytes=new Uint8Array(22+body.length);
  bytes[0]=3;bytes[1]=0;bytes.fill(70,2,18);bytes[19]=i;bytes[21]=3;bytes.set(body,22);chunks.push(bytes);
 }
 a.socket.onmessage({data:chunks[0].buffer,relaySource:'pull'});
 a.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:1,more:true})});await tick();await tick();
 assert.equal(a.doc.getMap('sales').size,0);
 a.socket.close();a.channel.conectar();const next=a.sockets.at(-1);next.onopen();await tick();await tick();
 assert.equal(controls(next,'pull')[0].seq,1,'the same live Y.Doc lifetime requests only rows after its in-memory cursor');
 for(const bytes of [chunks[1],chunks[1],chunks[2]])next.onmessage({data:bytes.buffer,relaySource:'pull'});
 next.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:3,more:false})});await tick();await tick();
 assert.equal(a.doc.getMap('sales').size,1);assert.equal(a.doc.getMap('sales').get('synthetic-sale'),'x'.repeat(350000));
 assert.equal(applied,1,'duplicate retained-group sibling is ignored before the remaining sibling completes the update');
 assert.equal(a.data.get('f123_yjs_pull_cursor_v2-y').seq,3);
 a.doc.destroy();source.destroy();
});

test('malformed live input during pull cannot poison a valid durable page',async()=>{
 const a=await fixture();a.ctx.descifrarBin=(_key,bytes)=>{if(bytes.byteLength===0)throw Error('bad live cipher');return Promise.resolve(new Uint8Array(bytes))};
 a.socket.onmessage({data:new ArrayBuffer(0),relaySource:'live'});
 a.socket.onmessage({data:new Uint8Array([0,9]).buffer,relaySource:'pull'});
 a.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:1,more:false})});await tick();await tick();
 assert.equal(a.data.get('f123_yjs_pull_cursor_v2-y').seq,1);
});
