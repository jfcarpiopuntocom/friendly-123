'use strict';
// P0 RED: a best-effort binary frame must not kill the logical peer socket
// merely because every active receiver's *bounded* FIFO is occupied.
// No production network. This fixture exercises the actual adapter.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function setup(){
  const window=new EventTarget(),document=new EventTarget(); document.hidden=false;
  class WS{constructor(){this.readyState=0;}close(){this.readyState=3;}}
  class RTC{constructor(){this.connectionState='connected';this.signalingState='stable';}close(){this.connectionState='closed';}}
  Object.assign(window,{WebSocket:WS,RTCPeerConnection:RTC,crypto:require('node:crypto').webcrypto});
  const c={window,document,EventTarget,MessageEvent,Event,DOMException,Blob,ArrayBuffer,Uint8Array,Map,Set,Promise,queueMicrotask,TextEncoder,setTimeout,clearTimeout,
    btoa:x=>Buffer.from(x,'binary').toString('base64'),atob:x=>Buffer.from(x,'base64').toString('binary')};
  vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/peer-sync.js'),'utf8'),c);
  const factory=window.F123Peer.create(),socket=factory.connect('wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+'a'.repeat(40));
  const cleanup=()=>{factory.closeAll();window.F123Relay.closeAll();};
  return {socket,cleanup};
}
function peer(socket,id,saturated=false){
  const frames=[];
  const p=socket.hub.peer(id.repeat(32));
  p.dc={readyState:'open',bufferedAmount:0,send:raw=>{if(raw!=='{}')frames.push(JSON.parse(raw));}};
  if(saturated){p.pendingFrames=256;p.pendingBytes=0;}
  return {p,frames};
}
test('RED: all peer queues full may drop LIVE binary but cannot close socket or purge durable debt',async()=>{
  const {socket,cleanup}=setup();const slow=peer(socket,'b',true);socket.open();
  try{
    const debt={packet:{v:1,topic:'',type:'durable',kind:'op',id:'test',hash:'a'.repeat(64),data:''},
      peers:new Map([[slow.p.id,slow.p.dc]]),acknowledged:new Map(),nextRetryAt:Date.now()+60000};
    socket.sent.set('op:test',debt);
    socket.send(new Uint8Array([7,8,9]).buffer);
    await socket.serial;
    assert.equal(socket.readyState,1,'a saturated best-effort live lane must not close the adapter');
    assert.equal(socket.hub.peers.has(slow.p.id),true,'the congestion should not tear down the peer hub');
    assert.equal(socket.sent.get('op:test'),debt,'unsatisfied durable ACK debt must survive the live drop');
    assert.equal(debt.acknowledged.size,0,'no fabricated receipt');
  }finally{slow.p.dc.readyState='closed';cleanup();}
});
test('a single congested recipient cannot prevent a healthy recipient receiving LIVE frame',async()=>{
  const {socket,cleanup}=setup(),slow=peer(socket,'b',true),fast=peer(socket,'c',false);socket.open();
  try{
    socket.send(new Uint8Array([1,2,3]).buffer);await socket.serial;
    await fast.p.sendSerial;
    assert.equal(socket.readyState,1);
    assert.ok(fast.frames.length>0,'healthy receiver must get binary frame');
    assert.equal(slow.frames.length,0,'no bypass around per-peer frame limit');
  }finally{slow.p.dc.readyState=fast.p.dc.readyState='closed';cleanup();}
});
