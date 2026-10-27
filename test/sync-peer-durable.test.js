'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const block=source.slice(source.indexOf('  function _frame('),source.indexOf('  // Carga perezosa'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function settle(){for(let i=0;i<8;i++)await tick();}
async function until(condition,message){const deadline=Date.now()+2000;while(!condition()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,1));assert.ok(condition(),message);}

test('catalog receipt waits for real PIN persistence and rejects a superseded application',async()=>{
  let releasePins,releaseStore,stores=0;
  const ctx={Promise,API:{meta:new Map(),get:()=>({one:{id:'one'}})},COLECCIONES:['productos'],_aplicando:false,_tAplica:null,
    window:{OCSync:{aplicarCatalogo:()=>({ok:true,pinsConfirmados:new Promise(resolve=>{releasePins=resolve;})}),confirmarCatalogoDurable(){stores++;return new Promise(resolve=>{releaseStore=resolve;});}}},log(){},clearTimeout(){}};
  vm.createContext(ctx);
  const start=source.indexOf('    var ultimaAplicacionVisible ='),end=source.indexOf('\n    // Cambios locales del catálogo',start);
  vm.runInContext(source.slice(start,end)+'\nthis.apply=aplicar;',ctx);
  ctx.apply();let done=false;const pending=ctx.API.confirmarCatalogoDurable().then(ok=>{done=true;return ok;});await settle();
  assert.equal(done,false);assert.equal(stores,0,'PIN write must finish before the full store snapshot');
  releasePins(true);await settle();assert.equal(stores,1);assert.equal(done,false);
  ctx.apply();releaseStore(true);assert.equal(await pending,false,'a newer application invalidates the old receipt');
  const rejected=ctx.API.confirmarCatalogoDurable();releasePins(false);assert.equal(await rejected,false);assert.equal(stores,1);
  ctx.apply();const accepted=ctx.API.confirmarCatalogoDurable();releasePins(true);await settle();releaseStore(true);assert.equal(await accepted,true);
});

test('direct adapter bounds its JS queue and binds legacy retries to the new ciphertext',async()=>{
  const win=new EventTarget(),document=new EventTarget();document.hidden=false;
  class WS{constructor(){this.readyState=0;}close(){this.readyState=3;}}
  Object.assign(win,{WebSocket:WS,RTCPeerConnection:function(){},crypto:require('node:crypto').webcrypto});
  const ctx={window:win,document,EventTarget,MessageEvent,Event,DOMException,Blob,ArrayBuffer,Uint8Array,Map,Set,Promise,queueMicrotask,TextEncoder,crypto:win.crypto,setTimeout,clearTimeout,
    btoa:value=>Buffer.from(value,'binary').toString('base64'),atob:value=>Buffer.from(value,'base64').toString('binary')};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/peer-sync.js'),'utf8'),ctx);
  const factory=win.F123Peer.create(),socket=factory.connect('wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+'a'.repeat(40));
  const peer={id:'b'.repeat(32),dc:{readyState:'open',bufferedAmount:0,send(){}},pc:{close(){}}};socket.hub.peers.set(peer.id,peer);socket.open();
  try{
    socket.send('x'.repeat(300000));assert.ok(socket.bufferedAmount>=300000);
    assert.throws(()=>socket.send('x'.repeat(300000)),/queue is full/);await socket.serial;assert.equal(socket.bufferedAmount,0);
    const send=bytes=>socket.send(JSON.stringify({k:'op',ack:1,id:'retry',c:Buffer.from(bytes).toString('base64')}));
    send('cipher-1');await socket.serial;const old={id:'retry',kind:'op',hash:socket.sent.get('op:retry').hash,peer:peer.id};socket.ackCandidates.add(old);
    send('cipher-2');await socket.serial;assert.equal(socket.readyState,1);assert.notEqual(socket.sent.get('op:retry').hash,old.hash);
    assert.equal(socket.acceptPeerAck(old),false,'old encrypted receipt cannot confirm a retry ciphertext');
    const current={...old,hash:socket.sent.get('op:retry').hash};socket.ackCandidates.add(current);assert.equal(socket.acceptPeerAck(current),true);
    socket.hub.attempts=5;win.dispatchEvent(new Event('online'));assert.equal(socket.hub.attempts,0);
  }finally{factory.closeAll();win.F123Relay.closeAll();}
});

async function fixture(name='catalogo',initialSaved=[]){
  const receipts=[],sent=[],transactions=[],saved=new Map(initialSaved),timers=[];let storeResult=true,failNextSave=false,failReadAfterWrite=false,failNextRead=false;
  const socket={peerOnly:true,readyState:1,send:value=>sent.push(value),close(code){if(code!==undefined&&code!==1000&&(!Number.isInteger(code)||code<3000||code>4999))throw new DOMException('Invalid WebSocket close code','InvalidAccessError');this.readyState=3;},
    confirmPeerReceipt(receipt,proof){receipts.push({receipt,proof});},acceptPeerAck(meta){this.onmessage({data:JSON.stringify({k:'persist-result',kind:meta.kind,id:meta.id,ok:true}),peerAccepted:true});}};
  const persistence={whenSynced:Promise.resolve(),get:async key=>{if(failNextRead){failNextRead=false;throw Error('synthetic outbox read rejected');}return structuredClone(saved.get(key));},set:async(key,value)=>{if(failNextSave){failNextSave=false;failNextRead=failReadAfterWrite;throw Error('synthetic outbox write rejected');}saved.set(key,structuredClone(value));},
    db:{objectStoreNames:{contains:key=>key==='updates'},transaction(){const tx={};transactions.push(tx);return tx;}}};
  const ctx={API:{clave:'synthetic',roomId:'synthetic',_store:{aplicar(){}},confirmarCatalogoDurable:async()=>storeResult},
    RELAY_URL:'fixture:',window:{dispatchEvent(){},F123Relay:{connect:()=>socket},OCSync:{confirmarCatalogoDurable:async()=>storeResult}},
    document:{hidden:false,visibilityState:'visible',addEventListener(){}},CustomEvent:class{},log(){},crypto:require('node:crypto').webcrypto,
    Date,Math,JSON,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder,
    setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(id){if(timers[id-1])timers[id-1].cancelled=true;},setInterval(){return 1;},clearInterval(){},
    btoa:value=>Buffer.from(value,'binary').toString('base64'),atob:value=>Buffer.from(value,'base64').toString('binary'),
    cifrarBin:async(_key,bytes)=>bytes.slice().buffer,descifrarBin:async(_key,bytes)=>new Uint8Array(bytes)};
  vm.createContext(ctx);vm.runInContext(block+'\nthis.make=crearCanal;',ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),ctx);
  const doc=new ctx.Y.Doc(),remote=new ctx.Y.Doc();
  const channel=ctx.make(ctx.Y,doc,'-y',name,false,null,persistence);channel.conectar();socket.onopen();await settle();
  function send(bytes,id='synthetic-op'){
    const receipt={id,kind:'op',peer:'synthetic-peer',hash:require('node:crypto').createHash('sha256').update(bytes).digest('hex')};
    socket.onmessage({data:bytes.slice().buffer,relaySource:'peer',peerReceipt:receipt});return receipt;
  }
  function update(value='value'){remote.getMap('items').set('synthetic',value);const bytes=ctx.Y.encodeStateAsUpdate(remote),frame=new Uint8Array(bytes.length+1);frame[0]=0;frame.set(bytes,1);return frame;}
  return {ctx,socket,receipts,sent,transactions,saved,timers,doc,remote,channel,send,update,setStoreResult(value){storeResult=value;},failNextSave(alsoFailRead=false){failNextSave=true;failReadAfterWrite=alsoFailRead;},close(){doc.destroy();remote.destroy();}};
}

function bootstrapPiece(full,index,id='old-snapshot-001') {
  const payload=full.subarray(1),cut=Math.ceil(payload.length/2),data=index===0?payload.subarray(0,cut):payload.subarray(cut);
  const frame=new Uint8Array(22+data.length);frame[0]=3;frame[1]=6;
  for(let i=0;i<16;i++)frame[2+i]=id.charCodeAt(i);
  frame[19]=index;frame[21]=2;frame.set(data,22);return frame;
}
test('late abandoned bootstrap fragments cannot block a newer confirmed snapshot',async()=>{
  const f=await fixture();try{
    const full=f.update('synthetic-late-snapshot');full[0]=6;
    const deliver=bytes=>f.socket.onmessage({data:bytes.buffer,relaySource:'peer'});
    deliver(bootstrapPiece(full,0));await settle();
    f.timers.find(timer=>timer.ms===1000&&!timer.cancelled).fn();await settle();
    deliver(bootstrapPiece(full,1));await settle();deliver(full);await settle();
    assert.equal(f.channel.recuperando,true,'new snapshot still requires its journal barrier');
    assert.ok(f.transactions.length,'obsolete bootstrap pieces cannot prevent the new journal barrier');
    f.transactions.at(-1).oncomplete();await settle();
    assert.equal(f.doc.getMap('items').get('synthetic'),'synthetic-late-snapshot');
    assert.equal(f.channel.recuperando,false);
  }finally{f.close();}
});
test('retiring a bootstrap ID never discards a fragment carrying a durable receipt',async()=>{
  const f=await fixture();try{
    const full=f.update('synthetic-durable-bootstrap');full[0]=6;
    f.socket.onmessage({data:bootstrapPiece(full,0).buffer,relaySource:'peer'});await settle();
    f.timers.find(timer=>timer.ms===1000&&!timer.cancelled).fn();await settle();
    f.send(bootstrapPiece(full,1),'synthetic-durable-one');await settle();
    f.socket.onmessage({data:full.buffer,relaySource:'peer'});await settle();
    assert.equal(f.channel.recuperando,true);assert.equal(f.receipts.length,0,'partial durable group cannot borrow a newer snapshot ACK');
    f.send(bootstrapPiece(full,0),'synthetic-durable-zero');await settle();
    assert.equal(f.receipts.length,0,'complete durable group still waits for journal commit');
    f.transactions.at(-1).oncomplete();await settle();
    assert.equal(f.channel.recuperando,false);assert.equal(f.receipts.length,2,'both exact durable siblings retain their receipts');
  }finally{f.close();}
});
test('retired bootstrap tracking is bounded by reconnecting rather than forgetting live-socket tombstones',async()=>{
  const f=await fixture();try{
    const full=f.update('synthetic-bounded-retries');full[0]=6;
    for(let i=0;i<=64;i++){
      const id='retired-'+String(i).padStart(8,'0');
      f.socket.onmessage({data:bootstrapPiece(full,0,id).buffer,relaySource:'peer'});await settle();
      const retry=f.timers.at(-1);retry.cancelled=true;retry.fn();await settle();
    }
    assert.equal(f.socket.readyState,3,'capacity exhaustion closes this peer socket instead of admitting forgotten stale IDs');
    assert.equal(f.channel.recuperando,true);assert.equal(f.receipts.length,0);
  }finally{f.close();}
});

test('peer receipt waits for journal commit and actual catalog persistence',async()=>{
  const f=await fixture();try{
    const receipt=f.send(f.update());await settle();
    assert.equal(f.receipts.length,0,'no ACK before local journal commit');
    assert.ok(f.transactions.length,'peer update must enter the Yjs transaction barrier');
    f.transactions.at(-1).oncomplete();await settle();
    assert.equal(f.receipts.length,1,'journal plus catalog confirmation allows ACK');
    assert.equal(f.channel.recuperando,true,'a live business operation alone is not a complete first catch-up');
    assert.equal(f.receipts[0].receipt,receipt);
    const proof=new Uint8Array(f.receipts[0].proof);assert.equal(proof[0],5);
    assert.equal(JSON.parse(new TextDecoder().decode(proof.subarray(1))).hash,receipt.hash);
  }finally{f.close();}
});

test('catalog persistence rejection never acknowledges a peer update',async()=>{
  const f=await fixture();try{
    f.setStoreResult(false);f.send(f.update());await settle();
    assert.ok(f.transactions.length);f.transactions.at(-1).oncomplete();await settle();assert.equal(f.receipts.length,0);
  }finally{f.close();}
});

test('all fragment receipts wait for complete update assembly',async()=>{
  const f=await fixture('fotos');try{
    const bytes=f.update('x'.repeat(300)),body=bytes.subarray(1),cut=Math.floor(body.length/2);
    function fragment(index,payload){const out=new Uint8Array(22+payload.length);out[0]=3;out[1]=0;out.fill(65,2,18);out[19]=index;out[21]=2;out.set(payload,22);return out;}
    f.send(fragment(0,body.subarray(0,cut)),'part-0');await settle();assert.equal(f.receipts.length,0);assert.equal(f.transactions.length,0);
    f.send(fragment(1,body.subarray(cut)),'part-1');await settle();assert.equal(f.receipts.length,0);assert.equal(f.doc.getMap('items').get('synthetic'),'x'.repeat(300));
    assert.ok(f.transactions.length);f.transactions.at(-1).oncomplete();await settle();assert.deepEqual(f.receipts.map(item=>item.receipt.id),['part-0','part-1']);
  }finally{f.close();}
});

test('an isolated sibling retry needs its complete group replayed after one ACK was lost',async()=>{
  const f=await fixture('fotos');try{
    const bytes=f.update('committed-fragment-group'),body=bytes.subarray(1),cut=Math.floor(body.length/2);
    function fragment(index,payload){const out=new Uint8Array(22+payload.length);out[0]=3;out[1]=0;out.fill(68,2,18);out[19]=index;out[21]=2;out.set(payload,22);return out;}
    const first=fragment(0,body.subarray(0,cut)),second=fragment(1,body.subarray(cut));
    f.send(first,'committed-0');f.send(second,'committed-1');await settle();
    f.transactions.at(-1).oncomplete();await settle();
    assert.deepEqual(f.receipts.map(item=>item.receipt.id),['committed-0','committed-1']);
    // The sender received only the first ACK, so only the second durable operation is retried.
    let committed=f.transactions.length;
    f.send(second,'committed-1');await settle();
    for(let i=0;i<3;i++){while(committed<f.transactions.length)f.transactions[committed++].oncomplete?.();await settle();}
    assert.deepEqual(f.receipts.map(item=>item.receipt.id),['committed-0','committed-1'],
      'a fragment alone must not borrow a completed group confirmation');
    f.send(first,'committed-0');await settle();f.transactions.at(-1).oncomplete();await settle();
    assert.deepEqual(f.receipts.map(item=>item.receipt.id),['committed-0','committed-1','committed-1','committed-0']);
    assert.equal(f.doc.getMap('items').get('synthetic'),'committed-fragment-group');
  }finally{f.close();}
});

test('partial group ACK retains every sibling for watchdog retry and restart',async()=>{
  const f=await fixture('fotos');let restarted;
  const operations=x=>x.sent.filter(v=>typeof v==='string').map(JSON.parse).filter(v=>v.k==='op');
  const ack=(x,entry)=>x.socket.onmessage({data:JSON.stringify({k:'persist-result',kind:'op',id:entry.id,ok:true}),peerAccepted:true});
  try{
    f.channel.enviarUpdate(new Uint8Array(160*1024+100));
    await until(()=>operations(f).length===2,'both siblings are sent');
    const original=operations(f);assert.ok(original.every(op=>!('group' in op)),'group metadata remains local');
    ack(f,original[0]);await settle();
    assert.equal(operations(f).length,2,'one ACK must not immediately resend the accepted sibling');
    const retained=f.saved.get('f123_relay_outbox_v1-y').pending;
    assert.equal(retained.length,2,'one ACK must not remove the sibling needed to reassemble after restart');
    assert.ok(retained[0].group&&retained.every(op=>op.group===retained[0].group));
    restarted=await fixture('fotos',structuredClone([...f.saved]));
    await until(()=>operations(restarted).length===2,'restart replays both retained siblings');
    assert.deepEqual(operations(restarted).map(op=>op.id),original.map(op=>op.id));
    ack(restarted,original[0]);await settle();
    restarted.channel.pausar();restarted.channel.reanudar();restarted.socket.readyState=1;restarted.socket.onopen();
    await until(()=>operations(restarted).length===4,'pause and resume clear session ACKs and replay both siblings');
    f.ctx.Date={now:()=>Date.now()+11000};
    const watchdog=f.timers.find(t=>t.ms>9000&&t.ms<=10000&&!t.cancelled);assert.ok(watchdog);watchdog.fn();await settle();
    await until(()=>operations(f).length===4,'watchdog replays the entire group when a sibling ACK is lost');
    ack(f,original[0]);ack(f,original[1]);
    await until(()=>f.saved.get('f123_relay_outbox_v1-y').pending.length===0,'all sibling ACKs atomically retire the group');
  }finally{f.close();restarted?.close();}
});

for(const alsoFailRead of [false,true])test('failed group retirement retains siblings and retries even with read failure: '+alsoFailRead,async()=>{
  const f=await fixture('fotos');try{
    const operations=()=>f.sent.filter(v=>typeof v==='string').map(JSON.parse).filter(v=>v.k==='op');
    const ack=entry=>f.socket.onmessage({data:JSON.stringify({k:'persist-result',kind:'op',id:entry.id,ok:true}),peerAccepted:true});
    f.channel.enviarUpdate(new Uint8Array(160*1024+100));await until(()=>operations().length===2,'group sent');
    const original=operations();ack(original[0]);await settle();f.failNextSave(alsoFailRead);ack(original[1]);await settle();
    assert.equal(f.saved.get('f123_relay_outbox_v1-y').pending.length,2,'failed retirement cannot delete persisted ciphertext');
    assert.equal(f.channel.pendientesRelay,2,'storage failure cannot report an empty pending queue');
    for(let i=0;i<3;i++){for(const timer of f.timers.filter(t=>!t.cancelled&&!t.fired&&t.ms>=1500&&t.ms<60000)){timer.fired=true;timer.fn();}await settle();}
    await until(()=>operations().length===4,'failed retirement must replay all siblings rather than suppressing them with volatile ACKs');
  }finally{f.close();}
});

test('peer-only sender rejects unauthenticated persist-result',async()=>{
  const f=await fixture('fotos');try{
    f.channel.enviarUpdate(new Uint8Array([1,2,3]));await until(()=>f.saved.get('f123_relay_outbox_v1-y')?.pending.length===1,'ciphertext enters the actual durable outbox');
    const pending=f.saved.get('f123_relay_outbox_v1-y').pending;assert.equal(pending.length,1);
    f.socket.onmessage({data:JSON.stringify({k:'persist-result',kind:'op',id:pending[0].id,ok:true})});await settle();
    assert.equal(f.saved.get('f123_relay_outbox_v1-y').pending.length,1,'plain peer messages cannot delete pending ciphertext');
  }finally{f.close();}
});

test('journal abort and tab handoff do not acknowledge a received operation',async()=>{
  for(const interrupt of ['abort','handoff']){
    const f=await fixture('fotos');try{
      f.send(f.update());await settle();assert.ok(f.transactions.length);
      if(interrupt==='abort')f.transactions.at(-1).onabort();
      else {f.ctx.document.hidden=true;f.transactions.at(-1).oncomplete();}
      await settle();assert.equal(f.receipts.length,0,interrupt);
    }finally{f.close();}
  }
});

test('missing causal parent retains child receipt until both are durable',async()=>{
  const f=await fixture('fotos');try{
    f.remote.getMap('items').set('synthetic','first');
    const parent=f.ctx.Y.encodeStateAsUpdate(f.remote),vector=f.ctx.Y.encodeStateVector(f.remote);
    f.remote.getMap('items').set('synthetic','second');const child=f.ctx.Y.encodeStateAsUpdate(f.remote,vector);
    function frame(bytes){const out=new Uint8Array(1+bytes.length);out.set(bytes,1);return out;}
    f.send(frame(child),'child');await settle();assert.ok(f.doc.store.pendingStructs);assert.equal(f.transactions.length,0);assert.equal(f.receipts.length,0);
    f.send(frame(parent),'parent');await settle();assert.equal(f.doc.store.pendingStructs,null);assert.ok(f.transactions.length);
    f.transactions.at(-1).oncomplete();await settle();assert.deepEqual(f.receipts.map(item=>item.receipt.id),['child','parent']);
    assert.equal(f.doc.getMap('items').get('synthetic'),'second');
  }finally{f.close();}
});

test('duplicate fragment retransmission does not multiply receipt callbacks',async()=>{
  const f=await fixture('fotos');try{
    const body=f.update().subarray(1),cut=Math.floor(body.length/2);
    function fragment(index,payload){const out=new Uint8Array(22+payload.length);out[0]=3;out[1]=0;out.fill(66,2,18);out[19]=index;out[21]=2;out.set(payload,22);return out;}
    for(let i=0;i<4;i++)f.send(fragment(0,body.subarray(0,cut)),'part-0');await settle();
    f.send(fragment(1,body.subarray(cut)),'part-1');await settle();f.transactions.at(-1).oncomplete();await settle();
    assert.deepEqual(f.receipts.map(item=>item.receipt.id),['part-0','part-1']);
  }finally{f.close();}
});

test('a conflicting duplicate fragment cannot borrow the accepted group receipt',async()=>{
  const f=await fixture('fotos');try{
    const body=f.update().subarray(1),cut=Math.floor(body.length/2);
    function fragment(index,payload){const out=new Uint8Array(22+payload.length);out[0]=3;out[1]=0;out.fill(67,2,18);out[19]=index;out[21]=2;out.set(payload,22);return out;}
    const first=fragment(0,body.subarray(0,cut)),conflict=first.slice();conflict[22]^=1;
    f.send(first,'accepted-0');f.send(conflict,'conflicting-0');f.send(fragment(1,body.subarray(cut)),'accepted-1');await settle();
    f.transactions.at(-1).oncomplete();await settle();
    assert.deepEqual(f.receipts.map(item=>item.receipt.id),['accepted-0','accepted-1']);
  }finally{f.close();}
});

test('encrypted receipt must match the exact pending ciphertext before outbox removal',async()=>{
  const f=await fixture('fotos');try{
    f.channel.enviarUpdate(new Uint8Array([7,8,9]));await until(()=>f.saved.get('f123_relay_outbox_v1-y')?.pending.length===1,'ciphertext enters the actual durable outbox');
    const pending=f.saved.get('f123_relay_outbox_v1-y').pending[0];
    const hash=require('node:crypto').createHash('sha256').update(Buffer.from(pending.c,'base64')).digest('hex');
    const meta={id:pending.id,kind:pending.k,peer:'synthetic-peer',hash};
    function proof(fields){const data=new TextEncoder().encode(JSON.stringify(fields)),out=new Uint8Array(data.length+1);out[0]=5;out.set(data,1);return out.buffer;}
    const wrong={...meta,hash:'a'.repeat(64)};
    f.socket.onmessage({data:proof(wrong),relaySource:'peer-ack',peerAck:wrong});await settle();
    assert.equal(f.saved.get('f123_relay_outbox_v1-y').pending.length,1,'even a decryptable proof cannot ACK different ciphertext');
    f.socket.onmessage({data:proof(meta),relaySource:'peer-ack',peerAck:meta});await until(()=>f.saved.get('f123_relay_outbox_v1-y').pending.length===0,'exact encrypted receipt completes confirmation');
    assert.equal(f.saved.get('f123_relay_outbox_v1-y').pending.length,0,'authenticated exact proof allows the adapter to confirm');
  }finally{f.close();}
});

test('a group larger than the old four-operation window can deliver every sibling',async()=>{
  const f=await fixture('fotos');try{
    f.channel.enviarUpdate(new Uint8Array(160*1024*5));await until(()=>f.sent.filter(value=>typeof value==='string').map(JSON.parse).filter(value=>value.k==='op').length===5,'every encrypted fragment reaches the sender');
    const operations=f.sent.filter(value=>typeof value==='string').map(JSON.parse).filter(value=>value.k==='op');
    assert.equal(operations.length,5,'receiver must obtain every sibling before it can ACK any fragment');
  }finally{f.close();}
});

test('peer readiness requires an explicit state-vector snapshot and durable store proof',async()=>{
  const f=await fixture();try{
    assert.equal(f.sent.filter(value=>typeof value==='string').map(JSON.parse).filter(value=>['head','pull'].includes(value.k)).length,0);
    f.socket.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:0,more:false})});await settle();
    assert.equal(f.channel.recuperando,true,'an empty synthetic central page cannot prove peer catch-up');
    const bytes=f.update();bytes[0]=6;
    f.socket.onmessage({data:bytes.buffer,relaySource:'peer'});await settle();
    assert.equal(f.channel.recuperando,true);assert.ok(f.transactions.length);
    f.transactions.at(-1).oncomplete();await settle();
    assert.equal(f.channel.recuperando,false,'explicit snapshot journal and store are confirmed');
  }finally{f.close();}
});

test('peer snapshot with failed catalog storage stays in recovery',async()=>{
  const f=await fixture();try{
    f.setStoreResult(false);const bytes=f.update();bytes[0]=6;
    f.socket.onmessage({data:bytes.buffer,relaySource:'peer'});await settle();f.transactions.at(-1).oncomplete();await settle();
    assert.equal(f.channel.recuperando,true);
  }finally{f.close();}
});

test('transient snapshot persistence failure retries direct catch-up on the same connection',async()=>{
  const f=await fixture();try{
    f.setStoreResult(false);const bytes=f.update();bytes[0]=6;
    f.socket.onmessage({data:bytes.buffer,relaySource:'peer'});await settle();f.transactions.at(-1).oncomplete();await settle();
    assert.equal(f.channel.recuperando,true);
    const before=f.sent.filter(value=>value instanceof ArrayBuffer&&new Uint8Array(value)[0]===1).length;
    const retry=f.timers.find(timer=>timer.ms===1000&&!timer.cancelled);assert.ok(retry);retry.fn();await settle();
    assert.ok(f.sent.filter(value=>value instanceof ArrayBuffer&&new Uint8Array(value)[0]===1).length>before,'automatic retry sends only a direct hydrated state vector');
    f.setStoreResult(true);f.socket.onmessage({data:bytes.buffer,relaySource:'peer'});await settle();f.transactions.at(-1).oncomplete();await settle();
    assert.equal(f.channel.recuperando,false);
  }finally{f.close();}
});
