'use strict';
// v594: Chromium keeps RTCDataChannel.bufferedAmount as a cached copy of the SCTP queue
// (third_party/webrtc pc/sctp_data_channel.cc, MaybeSendOnBufferedAmountChanged). The copy is
// refreshed after every send() and by a threshold callback. Real Chromium runs (CPU x6, 3 of 7
// runs) froze it at the total bytes sent while the receiver already had every byte, and a tiny
// send() refreshed it at once. The fake below reproduces exactly that: the counter is stale until
// the next send(), and the native queue is already empty.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

function load(){
  const window=new EventTarget(),document=new EventTarget();document.hidden=false;
  class WS{constructor(){this.readyState=0;}close(){this.readyState=3;}}
  Object.assign(window,{WebSocket:WS,RTCPeerConnection:function(){},crypto:require('node:crypto').webcrypto});
  const ctx={window,document,EventTarget,MessageEvent,Event,DOMException,Blob,ArrayBuffer,Uint8Array,Map,Set,Promise,queueMicrotask,TextEncoder,setTimeout,clearTimeout,
    btoa:value=>Buffer.from(value,'binary').toString('base64'),atob:value=>Buffer.from(value,'base64').toString('binary')};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/peer-sync.js'),'utf8'),ctx);
  return window;
}
function staleChannel(stale){
  // `cached` is what JS reads; the native queue is empty. Only send() recomputes it.
  const dc={readyState:'open',bufferedAmount:stale,frames:[],send(raw){this.frames.push(raw);this.bufferedAmount=0;}};
  return dc;
}
function attachPeer(window,dc){
  const factory=window.F123Peer.create(),room='a'.repeat(40),socket=factory.connect('wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+room);
  const peer={id:'b'.repeat(32),dc,groups:new Map(),pc:{close(){}}};socket.hub.peers.set(peer.id,peer);socket.open();
  return {factory,socket,peer};
}

test('a frozen cached bufferedAmount above the cap is refreshed so delivery resumes',async()=>{
  const window=load(),dc=staleChannel(527889),{factory,socket,peer}=attachPeer(window,dc);
  try{
    const started=Date.now();
    const outcome=await Promise.race([
      socket.hub.deliver(peer,{v:1,topic:'',type:'text',data:'synthetic'}),
      new Promise(resolve=>setTimeout(()=>resolve('still blocked'),3500))
    ]);
    assert.equal(outcome,true,'delivery must resume well before the 5 s abandon deadline (stale counter refreshed)');
    assert.ok(Date.now()-started<3500);
    assert.ok(dc.frames.some(raw=>raw==='{}'),'the refresh is a 2-byte frame that receivers already ignore');
  }finally{dc.readyState='closed';factory.closeAll();window.F123Relay.closeAll();}
});

test('the refresh frame never reaches application code and counters that move are left alone',async()=>{
  const window=load(),dc=staleChannel(0),{factory,socket,peer}=attachPeer(window,dc);
  try{
    let delivered=0;socket.onmessage=event=>{if(event.relaySource)delivered++;};
    await socket.hub.receive(peer,'{}');
    assert.equal(delivered,0);assert.equal(peer.groups.size,0);
    // Idle channel (0) and a draining channel (value changes) must not be nudged.
    // Poll like the sync-yjs pump does (every 100 ms through the Socket.bufferedAmount getter).
    const poll=async ms=>{for(let t=0;t<ms;t+=100){void socket.bufferedAmount;await new Promise(resolve=>setTimeout(resolve,100));}};
    dc.bufferedAmount=0;await poll(1500);
    assert.equal(dc.frames.length,0,'idle channel gets no refresh frames');
    for(let i=0;i<8;i++){dc.bufferedAmount=100000-i*1000;await poll(300);}
    assert.equal(dc.frames.length,0,'a counter that keeps moving is not nudged');
  }finally{dc.readyState='closed';factory.closeAll();window.F123Relay.closeAll();}
});

test('a frozen counter read only through the Socket.bufferedAmount getter is refreshed (sync-yjs pump path)',async()=>{
  const window=load(),dc=staleChannel(527889),{factory,socket}=attachPeer(window,dc);
  try{
    for(let t=0;t<2500&&socket.bufferedAmount>0;t+=100)await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(socket.bufferedAmount,0,'pump polling alone clears a frozen counter within ~2.5 s');
  }finally{dc.readyState='closed';factory.closeAll();window.F123Relay.closeAll();}
});
