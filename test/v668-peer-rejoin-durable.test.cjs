'use strict';
// F123 direct RTC: reconnecting an arbitrary new peer must receive pending
// ciphertext with a per-peer durable ACK. All data and network objects synthetic.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
function fixture(){
  const win=new EventTarget(),document=new EventTarget();document.hidden=false;
  class WS {constructor(){this.readyState=0;}close(){this.readyState=3;}}
  Object.assign(win,{WebSocket:WS,RTCPeerConnection:function(){},crypto:webcrypto});
  const ctx={window:win,document,EventTarget,Event,MessageEvent,DOMException,Blob,
    ArrayBuffer,Uint8Array,Map,Set,Promise,queueMicrotask,TextEncoder,setTimeout,
    clearTimeout,btoa:s=>Buffer.from(s,'binary').toString('base64'),
    atob:s=>Buffer.from(s,'base64').toString('binary')};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../docs/peer-sync.js'),'utf8'),ctx);
  const factory=win.F123Peer.create();
  const socket=factory.connect('wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+'a'.repeat(40));
  const delivered=[],confirmed=[];
  socket.hub.deliver=async(peer,packet)=>{delivered.push({peer:peer.id,packet});return true;};
  socket.onmessage=e=>{if(typeof e.data==='string'){
    const m=JSON.parse(e.data);if(m.k==='persist-result')confirmed.push(m);
  }};
  socket.open();
  const peer=id=>({id,dc:{readyState:'open',bufferedAmount:0,send(){}},pc:{close(){}}});
  const send=id=>socket.send(JSON.stringify({k:'op',ack:1,id,c:Buffer.from('ciphertext-'+id).toString('base64')}));
  return {socket,delivered,confirmed,peer,send,close(){factory.closeAll();win.F123Relay.closeAll();}};
}
test('late direct receiver replays an operation originally emitted with zero peers',async()=>{
  const f=fixture();try{
    const key='op:synthetic-sale';
    f.send('synthetic-sale');await f.socket.serial;
    const rec=f.socket.sent.get(key);
    assert.ok(rec&&rec.peers.size===0,'old implementation stranded this durable update');
    assert.equal(f.delivered.length,0);
    const b=f.peer('b'.repeat(32));f.socket.hub.peers.set(b.id,b);
    f.socket.replayPendingTo(b);await f.socket.serial;
    assert.equal(f.delivered.length,1);
    assert.equal(f.delivered[0].peer,b.id);
    assert.equal(rec.peers.get(b.id),b.dc,'durable ACK must be owed by the new peer');
    const ack={id:'synthetic-sale',kind:'op',hash:rec.hash,peer:b.id};
    f.socket.ackCandidates.add(ack);
    assert.equal(f.socket.acceptPeerAck(ack),true);
    assert.equal(f.confirmed.length,1);
    assert.equal(f.socket.sent.has(key),false);
  }finally{f.close()}
});
test('new third peer cannot be skipped by ACK from first peer',async()=>{
  const f=fixture();try{
    const a=f.peer('a'.repeat(32));f.socket.hub.peers.set(a.id,a);
    f.send('synthetic-three-peer');await f.socket.serial;
    const key='op:synthetic-three-peer',rec=f.socket.sent.get(key);
    assert.equal(rec.peers.size,1);
    const b=f.peer('b'.repeat(32));f.socket.hub.peers.set(b.id,b);
    f.socket.replayPendingTo(b);await f.socket.serial;
    assert.equal(rec.peers.size,2);
    const ack=id=>({id:'synthetic-three-peer',kind:'op',hash:rec.hash,peer:id});
    const x=ack(a.id);f.socket.ackCandidates.add(x);
    assert.equal(f.socket.acceptPeerAck(x),true);
    assert.equal(f.confirmed.length,0,'new peer still owes a durable receipt');
    const y=ack(b.id);f.socket.ackCandidates.add(y);
    assert.equal(f.socket.acceptPeerAck(y),true);
    assert.equal(f.confirmed.length,1);
    assert.equal(f.socket.sent.has(key),false);
  }finally{f.close()}
});
test('opening same receiver twice does not emit duplicate retransmissions',async()=>{
  const f=fixture();try{
    f.send('same-peer');await f.socket.serial;
    const a=f.peer('c'.repeat(32));f.socket.hub.peers.set(a.id,a);
    f.socket.replayPendingTo(a);await f.socket.serial;
    f.socket.replayPendingTo(a);await f.socket.serial;
    assert.equal(f.delivered.length,1);
  }finally{f.close()}
});

test('P0: a congested direct peer must not head-of-line block an independent receiver',async()=>{
  const f=fixture();let releaseSlow=()=>{};
  try {
    const slowId='b'.repeat(32), fastId='c'.repeat(32);
    f.socket.hub.peers.set(slowId,f.peer(slowId));
    f.socket.hub.peers.set(fastId,f.peer(fastId));
    const slow=new Promise(resolve=>{releaseSlow=()=>resolve(true);});
    let firstSeen;
    const first=new Promise(resolve=>{firstSeen=resolve;});
    const reached=[];
    f.socket.hub.deliver=async(peer)=>{
      reached.push(peer.id);
      if(peer.id===slowId){firstSeen();return slow;}
      return true;
    };
    f.send('concurrent-delivery');
    await Promise.race([first,new Promise((_,reject)=>setTimeout(()=>reject(Error('sender did not start')),1000))]);
    // The slow peer is deliberately BLOCKED until after the assertion.
    // Both peer channels must be serviced independently without false ACK.
    await new Promise(resolve=>setTimeout(resolve,50));
    assert.ok(reached.includes(fastId),'healthy peer was starved behind slow peer');
    assert.equal(f.confirmed.length,0,'no durable ACK without receiver journal proof');
    const pending=f.socket.sent.get('op:concurrent-delivery');
    assert.equal(pending.peers.size,2,'both peers still owe their independent durable receipts');
    releaseSlow();await f.socket.serial;
  }finally{releaseSlow();f.close();}
});

test('P0 failed RTC sends retain durable ciphertext and keep a bounded retry timer after third refusal',async()=>{
  const f=fixture();try{
    const receiver=f.peer('d'.repeat(32));f.socket.hub.peers.set(receiver.id,receiver);
    let refusals=0;
    // Synthetic slow channel: deliver refuses before emitting any bytes to RTC.
    f.socket.hub.deliver=async()=>{refusals++;return false;};
    f.send('refused-three-times');await f.socket.serial;
    const key='op:refused-three-times',rec=f.socket.sent.get(key);
    assert.ok(rec&&rec.peers.size===1);
    assert.equal(refusals,1);
    assert.equal(f.confirmed.length,0);
    // Position exactly at the previous terminal third attempt; no wall-clock wait.
    clearTimeout(f.socket.peerRetryTimer);f.socket.peerRetryTimer=null;
    rec.retries=2;rec.nextRetryAt=Date.now()-1;
    f.socket.schedulePeerRetry();
    await new Promise(resolve=>setTimeout(resolve,350));
    await f.socket.serial;
    assert.ok(refusals>=2,'third attempt was executed');
    assert.equal(f.confirmed.length,0,'a transport refusal cannot become a durable ACK');
    assert.ok(f.socket.sent.has(key),'ciphertext must remain durably pending');
    assert.ok(f.socket.peerRetryTimer,'third failed delivery must not cause a terminal retry cap');
    // Force one more window, without waiting for the natural exponential interval.
    clearTimeout(f.socket.peerRetryTimer);f.socket.peerRetryTimer=null;
    rec.nextRetryAt=Date.now()-1;
    f.socket.schedulePeerRetry();
    await new Promise(resolve=>setTimeout(resolve,350));
    await f.socket.serial;
    assert.ok(refusals>=3,'fourth transport attempt must still be possible');
    assert.ok(f.socket.peerRetryTimer,'future retries remain paced and active');
    assert.equal(f.confirmed.length,0);
    assert.equal(rec.peers.get(receiver.id),receiver.dc);
  }finally{f.close()}
});
