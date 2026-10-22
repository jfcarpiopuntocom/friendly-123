const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');

const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const block=src.slice(src.indexOf('  function _frame('),src.indexOf('  // Carga perezosa'));
const tick=()=>new Promise(r=>setImmediate(r));
async function esperar(condicion){const limite=Date.now()+2000;while(!condicion()&&Date.now()<limite)await new Promise(r=>setTimeout(r,1));assert.ok(condicion(),'timed out waiting for durable pull cursor');}

async function fixture(){
 const sockets=[],timers=[],data=new Map();
 class Socket{constructor(){this.readyState=1;this.sent=[];sockets.push(this)}send(x){this.sent.push(x)}close(){this.readyState=3;this.onclose?.()}}
 const p={get:async k=>structuredClone(data.get(k)),set:async(k,v)=>{data.set(k,structuredClone(v))}};
 const ctx={API:{clave:'synthetic',roomId:'synthetic'},RELAY_URL:'fixture:',crypto:require('node:crypto').webcrypto,WebSocket:class{constructor(){throw Error('Raw relay fallback forbidden')}},
  window:{dispatchEvent(){},F123Relay:{connect:()=>new Socket()}},navigator:{},
  document:{hidden:false,visibilityState:'visible',addEventListener(){}},
  CustomEvent:class{},log(){},Date,Math,JSON,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder,setInterval,clearInterval,
  setTimeout(fn,ms){timers.push({fn,ms});return timers.length},clearTimeout(id){if(timers[id-1])timers[id-1].cancelled=true},
  btoa:s=>Buffer.from(s,'binary').toString('base64'),cifrarBin:async(_,b)=>b.slice().buffer,descifrarBin:async(_,b)=>new Uint8Array(b)};
 vm.createContext(ctx);vm.runInContext(block+'\nthis.make=crearCanal;',ctx);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),ctx);
 const Y=ctx.Y,doc=new Y.Doc(),channel=ctx.make(Y,doc,'-y','fixture',true,null,p);channel.conectar();
 sockets[0].onopen();await tick();await tick();
 // Model the old relay's explicit HEAD-unsupported reply before pulling.
 sockets[0].onmessage({data:JSON.stringify({k:'head-result',unsupported:true})});await tick();await tick();
 sockets[0].onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:0,more:false})});await tick();await tick();
 return {Y,doc,data,timers,channel,socket:sockets[0]};
}

function pull(socket,update,seq){
 const frame=new Uint8Array(update.length+1);frame[0]=0;frame.set(update,1);
 socket.onmessage({data:frame.buffer,relaySource:'pull'});
 socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq,more:false})});
}

test('unresolved Yjs structs and deletes cannot be compacted before their parent history arrives',async()=>{
 const a=await fixture(),Y=a.Y;
 const base=new Y.Doc();base.getArray('records').push(['parent']);
 const child=new Y.Doc();Y.applyUpdate(child,Y.encodeStateAsUpdate(base));child.getArray('records').insert(1,['child']);
 const childUpdate=Y.encodeStateAsUpdate(child,Y.encodeStateVector(base));
 const deleter=new Y.Doc();Y.applyUpdate(deleter,Y.encodeStateAsUpdate(base));deleter.getArray('records').delete(0,1);
 const deleteUpdate=Y.encodeStateAsUpdate(deleter,Y.encodeStateVector(base));

 pull(a.socket,childUpdate,1);pull(a.socket,deleteUpdate,2);await tick();await tick();
 assert.ok(a.doc.store.pendingStructs,'child update must remain pending without its parent struct');
 assert.ok(a.doc.store.pendingDs,'delete must remain pending without its target struct');
 const checkpointTimer=a.timers.find(t=>t.ms===2500);assert.ok(checkpointTimer);
 checkpointTimer.fn();await tick();await tick();
 const earlyCheckpoint=a.socket.sent.filter(x=>typeof x==='string').map(JSON.parse).find(x=>x.k==='ckpt');
 if(earlyCheckpoint){
  a.socket.onmessage({data:JSON.stringify({k:'persist-result',id:earlyCheckpoint.id,kind:'ckpt',ok:true})});await tick();await tick();
 }

 pull(a.socket,Y.encodeStateAsUpdate(base),3);await tick();await tick();
 await esperar(()=>a.data.get('f123_yjs_pull_cursor_v2-y')?.seq===3);
 assert.equal(a.doc.store.pendingStructs,null);assert.equal(a.doc.store.pendingDs,null);
 assert.deepEqual(Array.from(a.doc.getArray('records').toArray()),['child'],
  'once dependencies arrive the delete and child operation recover to the expected record');
 checkpointTimer.fn();await tick();await tick();
 const ck=a.socket.sent.filter(x=>typeof x==='string').map(JSON.parse).filter(x=>x.k==='ckpt').at(-1);assert.ok(ck);
 assert.equal(ck.seq,3,'the complete snapshot covers the recovered durable cut');
 const restored=new Y.Doc();const packed=Buffer.from(ck.c,'base64');
 Y.applyUpdate(restored,packed.subarray(1));
 assert.deepEqual(Array.from(restored.getArray('records').toArray()),['child'],
  'the recovered checkpoint retains the expected record after compaction');
 assert.equal(earlyCheckpoint,undefined,
  'a snapshot omitting unresolved dependencies must not compact the durable source history');
});
