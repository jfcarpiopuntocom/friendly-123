const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const block=src.slice(src.indexOf('  function _frame('),src.indexOf('  // Carga perezosa'));
const tick=()=>new Promise(r=>setImmediate(r));
async function fixture(data=new Map(),locks){
 const sockets=[],timers=[];
 class Socket{constructor(){this.readyState=1;this.sent=[];sockets.push(this)}send(x){this.sent.push(x)}}
 const p={get:async k=>structuredClone(data.get(k)),set:async(k,v)=>{data.set(k,structuredClone(v))}};
 const ctx={API:{clave:'synthetic',roomId:'synthetic'},RELAY_URL:'fixture:',WebSocket:Socket,
  window:{dispatchEvent(){}},navigator:locks?{locks}:undefined,CustomEvent:class{},log(){},Date,Math,JSON,Uint8Array,ArrayBuffer,
  setTimeout(fn,ms){timers.push({fn,ms});return timers.length},clearTimeout(){},
  btoa:s=>Buffer.from(s,'binary').toString('base64'),
  cifrarBin:async(_,b)=>b.slice().buffer,descifrarBin:async(_,b)=>new Uint8Array(b)};
 vm.createContext(ctx);vm.runInContext(block+'\nthis.make=crearCanal;',ctx);
 const Y={encodeStateAsUpdate:()=>Uint8Array.from({length:20},(_,i)=>i),encodeStateVector:()=>new Uint8Array([1]),applyUpdate(){}};
 const channel=ctx.make(Y,{},'-y','fixture',true,null,p);channel.conectar();
 sockets[0].onopen();await tick();await tick();
 return {data,timers,channel,socket:sockets[0],p};
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
 await tick();await tick();await tick();
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
