const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const block=src.slice(src.indexOf('  function _frame('),src.indexOf('  // Carga perezosa'));
const tick=()=>new Promise(r=>setImmediate(r));
async function esperar(condicion,mensaje){
 const limite=Date.now()+2000;
 while(!condicion()&&Date.now()<limite)await new Promise(r=>setTimeout(r,1));
 assert.ok(condicion(),mensaje);
}
async function fixture(data=new Map(),locks,adapterMissing=false){
 const sockets=[],timers=[];let rawCalls=0;
 class Socket{constructor(){this.readyState=1;this.sent=[];sockets.push(this)}send(x){this.sent.push(x)}}
 const p={get:async k=>structuredClone(data.get(k)),set:async(k,v)=>{data.set(k,structuredClone(v))}};
 const ctx={API:{clave:'synthetic',roomId:'synthetic'},RELAY_URL:'fixture:',crypto:require('node:crypto').webcrypto,WebSocket:class{constructor(){rawCalls++;throw Error('Raw relay fallback forbidden')}},
  window:{dispatchEvent(){},F123Relay:{connect:()=>new Socket()}},navigator:locks?{locks}:undefined,CustomEvent:class{},log(){},Date,Math,JSON,Uint8Array,ArrayBuffer,
  setTimeout(fn,ms){timers.push({fn,ms});return timers.length},clearTimeout(){},
  btoa:s=>Buffer.from(s,'binary').toString('base64'),
  cifrarBin:async(_,b)=>b.slice().buffer,descifrarBin:async(_,b)=>new Uint8Array(b)};
 if(adapterMissing)delete ctx.window.F123Relay;
 vm.createContext(ctx);vm.runInContext(block+'\nthis.make=crearCanal;',ctx);
 const Y={encodeStateAsUpdate:()=>Uint8Array.from({length:20},(_,i)=>i),encodeStateVector:()=>new Uint8Array([1]),applyUpdate(){}};
 const channel=ctx.make(Y,{},'-y','fixture',true,null,p);channel.conectar();
 if(sockets[0]){
  sockets[0].onopen();await tick();await tick();
  sockets[0].onmessage({data:JSON.stringify({k:"pull-page",rev:0,seq:0,more:false})});await tick();await tick();
 }
 return {data,timers,channel,socket:sockets[0],sockets,p,ctx,get rawCalls(){return rawCalls},restoreAdapter(){ctx.window.F123Relay={connect:()=>new Socket()}}};
}
test('unacknowledged encrypted update survives reload and is removed only after durable ack',async()=>{
 const a=await fixture();a.channel.enviarUpdate(new Uint8Array([4,5,6]));await tick();await tick();
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
 a.socket.onmessage({data:chunk.buffer});
 a.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:1,more:false})});await tick();await tick();
 a.timers.find(t=>t.ms===2500).fn();await tick();await tick();
 assert.ok(!a.socket.sent.some(x=>typeof x==='string'&&JSON.parse(x).k==='ckpt'),
  'a received chunk is not yet part of the Yjs snapshot');
});
test('incomplete chunk pages replay after reload, then advance durable cursor only after reassembly',async()=>{
 const a=await fixture();
 const chunk=new Uint8Array(24);chunk[0]=3;chunk[1]=0;chunk.fill(65,2,18);chunk[21]=2;
 a.socket.onmessage({data:chunk.buffer});
 a.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:1,more:true})});await tick();await tick();
 assert.equal(a.data.get('f123_yjs_pull_cursor_v2-y').seq,0,
  'a reload must refetch a partial update because fragments are only in memory');
 const currentPull=a.socket.sent.filter(x=>typeof x==='string').map(JSON.parse).filter(x=>x.k==='pull').at(-1);
 assert.equal(currentPull.seq,1,'the live session still moves forward to fetch remaining chunks');
 const b=await fixture(new Map(a.data));
 const resumed=b.socket.sent.filter(x=>typeof x==='string').map(JSON.parse).find(x=>x.k==='pull');
 assert.equal(resumed.seq,0);
 const last=chunk.slice();last[19]=1;
 a.socket.onmessage({data:last.buffer});
 a.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:2,more:false})});await tick();await tick();
 assert.equal(a.data.get('f123_yjs_pull_cursor_v2-y').seq,2);
});


test('missing native adapter preserves durable outbox through reload and reconnect without a raw socket',async()=>{
 const a=await fixture(new Map(),undefined,true);
 assert.equal(a.sockets.length,0);assert.equal(a.channel.ws,null);assert.equal(a.rawCalls,0);
 assert.equal(a.timers.length,1,'failed connection schedules backoff');
 a.channel.enviarUpdate(new Uint8Array([7,8,9]));await tick();await tick();
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
