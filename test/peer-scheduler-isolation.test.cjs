'use strict';
// Ponytail RED->GREEN: synthetic RTC peers. No production network/data.
const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
function setup(){
  const window=new EventTarget(),document=new EventTarget();document.hidden=false;
  class WS{constructor(){this.readyState=0;}close(){this.readyState=3;}}
  class RTC{constructor(){this.connectionState='connected';this.signalingState='stable';}close(){this.connectionState='closed';}}
  Object.assign(window,{WebSocket:WS,RTCPeerConnection:RTC,crypto:require('node:crypto').webcrypto});
  const ctx={window,document,EventTarget,MessageEvent,Event,DOMException,Blob,ArrayBuffer,Uint8Array,Map,Set,Promise,queueMicrotask,TextEncoder,setTimeout,clearTimeout,
    btoa:v=>Buffer.from(v,'binary').toString('base64'),atob:v=>Buffer.from(v,'base64').toString('binary')};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/peer-sync.js'),'utf8'),ctx);
  const factory=window.F123Peer.create(),socket=factory.connect('wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+'a'.repeat(40));
  return {socket,cleanup(){factory.closeAll();window.F123Relay.closeAll();}};
}
function attach(socket,id,opts={}){
  const peer=socket.hub.peer(id.repeat(32)),frames=[];
  const dc={label:'friendly-direct-v1',readyState:'open',bufferedAmount:0,send(raw){
    if(raw==='{}')return;
    frames.push(JSON.parse(raw));
    if(opts.freezeAfterFirst&&frames.length===1)this.bufferedAmount=512*1024+1;
  }};
  peer.dc=dc;return {peer,dc,frames};
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function messages(frames){return frames.filter(f=>f.count===1).map(f=>{
  const e=JSON.parse(f.data);return e.type==='text'?e.data:null;
}).filter(Boolean);}
test('P0: healthy peers receive three successive packets before a slow peer drains',async()=>{
  const {socket,cleanup}=setup(),a=attach(socket,'b'),b=attach(socket,'c'),slow=attach(socket,'d',{freezeAfterFirst:true});socket.open();
  try{
    for(const m of ['m1','m2','m3'])socket.send(m);
    await pause(300);
    assert.deepEqual(messages(a.frames),['m1','m2','m3'],'A must not wait for slow peer');
    assert.deepEqual(messages(b.frames),['m1','m2','m3'],'B must not wait for slow peer');
    assert.ok(slow.frames.length>=1);
  }finally{a.dc.readyState=b.dc.readyState=slow.dc.readyState='closed';cleanup();}
});
test('P0: disconnected/open RTC peer is excluded from live admission, but ACK debt survives',async()=>{
  const {socket,cleanup}=setup(),a=attach(socket,'b'),bad=attach(socket,'c');socket.open();
  try{
    const record={packet:{v:1,topic:'',type:'text',data:'debt'},peers:new Map([[bad.peer.id,bad.dc]]),acknowledged:new Map(),nextRetryAt:Date.now()+60000};
    socket.sent.set('op:synthetic',record);bad.peer.pc.connectionState='disconnected';bad.dc.bufferedAmount=512*1024+1;
    bad.peer.pc.onconnectionstatechange();await pause(50);
    assert.equal(socket.hub.connected().includes(bad.peer),false);
    assert.equal(record.acknowledged.size,0);assert.equal(record.peers.get(bad.peer.id),bad.dc);
    assert.equal(socket.hub.connected().includes(a.peer),true);
    bad.peer.pc.connectionState='connected';bad.peer.pc.onconnectionstatechange();
    assert.equal(socket.hub.connected().includes(bad.peer),true,'transient RTC recovery remains possible');
  }finally{a.dc.readyState=bad.dc.readyState='closed';cleanup();}
});
test('P0: send throwing on one peer does not close the healthy socket or forge a receipt',async()=>{
  const {socket,cleanup}=setup(),a=attach(socket,'b'),bad=attach(socket,'c');bad.dc.send=()=>{throw Error('simulated RTC failure');};socket.open();
  try{
    socket.send(JSON.stringify({k:'op',ack:1,id:'sale-failure-1',c:Buffer.from('synthetic ciphertext').toString('base64')}));
    await pause(200);assert.equal(socket.readyState,1);
    const r=socket.sent.get('op:sale-failure-1');assert.ok(r);assert.equal(r.acknowledged.size,0);
    assert.equal(r.peers.get(bad.peer.id),bad.dc);assert.ok(a.frames.length>0);
  }finally{a.dc.readyState=bad.dc.readyState='closed';cleanup();}
});
test('P0: retry against frozen recipient does not block healthy new packets',async()=>{
  const {socket,cleanup}=setup(),a=attach(socket,'b'),slow=attach(socket,'c');slow.dc.bufferedAmount=512*1024+1;socket.open();
  try{
    socket.sent.set('op:retry',{packet:{v:1,topic:'',type:'text',data:'retry-test'},peers:new Map([[slow.peer.id,slow.dc]]),
      acknowledged:new Map(),retries:0,nextRetryAt:Date.now()-1});
    socket.schedulePeerRetry();await pause(330);socket.send('after-retry');await pause(230);
    assert.ok(messages(a.frames).includes('after-retry'));
  }finally{a.dc.readyState=slow.dc.readyState='closed';cleanup();}
});
test('P0: incomplete chunk never creates ACK, full replay reassembles and hashes',async()=>{
  const {socket,cleanup}=setup(),target=attach(socket,'b'),pending=[],orig=target.dc.send;socket.open();
  try{
    const bytes=new Uint8Array(24500);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
    const hash=Buffer.from(await require('node:crypto').webcrypto.subtle.digest('SHA-256',bytes)).toString('hex');
    const packet={v:1,topic:'',type:'durable',id:'fragmented-sale',kind:'op',hash,data:Buffer.from(bytes).toString('base64')};
    let delivered=0;socket.onmessage=e=>{if(e.peerReceipt)delivered++;};
    target.dc.send=raw=>{orig.call(target.dc,raw);pending.push(socket.hub.receive(target.peer,raw));
      if(target.frames.length===1)target.dc.readyState='closed';};
    assert.equal(await socket.hub.deliver(target.peer,packet),false);
    await Promise.all(pending.splice(0));assert.equal(delivered,0);assert.equal(socket.receipts.size,0);
    target.dc.readyState='open';assert.equal(await socket.hub.deliver(target.peer,packet),true);
    await Promise.all(pending.splice(0));assert.equal(delivered,1);assert.equal(socket.receipts.size,1);
  }finally{target.dc.readyState='closed';cleanup();}
});


test('P0: independent per-peer queues have strict frame and byte memory caps', async()=>{
  const {socket,cleanup}=setup(),slow=attach(socket,'b');socket.open();
  try{
    let accepted=0;
    for(let i=0;i<300;i++)accepted+=Number(socket.hub.enqueue(slow.peer,{v:1,topic:'',type:'text',data:'m'+i}));
    assert.equal(accepted,256,'the 257th pending packet must be refused for this peer');
    assert.ok(slow.peer.pendingFrames<=256);
    assert.ok(slow.peer.pendingBytes<=512*1024);
    assert.equal(socket.readyState,1,'bounded peer refusal does not close the logical socket');
  }finally{slow.dc.readyState='closed';cleanup();}
});
