'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const peerSource=fs.readFileSync(path.join(__dirname,'../docs/peer-sync.js'),'utf8');
const realTimeSource=fs.readFileSync(path.join(__dirname,'../docs/sync-realtime.js'),'utf8');
const locator='wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+'a'.repeat(40);
class FakeSignal {
 constructor(url){this.url=url;this.readyState=0;FakeSignal.all.push(this);}
 open(){this.readyState=1;this.onopen?.();}
 close(){this.readyState=3;this.onclose?.();}
 send(){}
}
FakeSignal.all=[];
function fixture(){
 FakeSignal.all.length=0;
 const window={crypto:webcrypto,WebSocket:FakeSignal,RTCPeerConnection:class {
  constructor(){this.connectionState='connecting'}
  close(){this.connectionState='closed'}
 }};
 window.addEventListener=()=>{};window.removeEventListener=()=>{};
 const document={hidden:false,addEventListener(){},removeEventListener(){}};
 vm.runInNewContext(peerSource,{
   window,document,Event,EventTarget,MessageEvent,DOMException,
   TextEncoder,TextDecoder,Uint8Array,ArrayBuffer,Blob,Promise,Map,Set,
   URL,console,queueMicrotask,setTimeout,clearTimeout,btoa,atob
 },{filename:'peer-sync.js'});
 return {window,signal:()=>FakeSignal.all[0],all:FakeSignal.all};
}
test('P0 actual peer adapter exposes connected signaling without claiming remote persisted data',()=>{
 const f=fixture();const sock=f.window.F123Relay.connect(locator);
 assert.equal(f.all.length,1);
 assert.equal(sock.signalingReady,false);
 assert.equal(sock.readyState,0);
 f.signal().open();
 assert.equal(sock.signalingReady,true);
 assert.equal(sock.readyState,0,'no synthetic peer ACK or false remote sync status');
 for(let i=0;i<15;i++){
   if(sock.readyState===0&&!(sock.peerOnly&&sock.signalingReady))sock.close();
 }
 assert.equal(sock.readyState,0,'remain in room after 15 watchdog cycles waiting for mobile');
 assert.equal(f.all.length,1,'no repeated signaling websockets and no quota storm');
 assert.equal(f.signal().readyState,1);
 sock.close();
 assert.equal(f.signal().readyState,3,'real user close releases room');
});
test('P0 peer may join AFTER initial watchdog deadline and enable actual channel',()=>{
 const f=fixture();const sock=f.window.F123Relay.connect(locator);
 f.signal().open();
 const peer=sock.hub.peer('b'.repeat(32));
 assert.ok(peer);
 const dc={label:'friendly-direct-v1',readyState:'open',bufferedAmount:0,send(){},close(){}};
 sock.hub.attach(peer,dc);
 dc.onopen();
 assert.equal(sock.readyState,1,'direct RTC becomes available without recreated browser login');
 assert.equal(sock.signalingReady,true);
 sock.close();
});
test('P0 a signal connection that never opens still closes via existing handshake watchdog',()=>{
 const f=fixture();const sock=f.window.F123Relay.connect(locator);
 assert.equal(sock.signalingReady,false);
 if(sock.readyState===0&&!(sock.peerOnly&&sock.signalingReady))sock.close();
 assert.equal(sock.readyState,3);
 assert.equal(f.signal().readyState,3);
});
test('P0 production watchdog preserves rendezvous and does not fake WebSocket OPEN',()=>{
 assert.match(realTimeSource,/ws\.peerOnly\s*&&\s*ws\.signalingReady/);
 assert.match(realTimeSource,/ws\.readyState === WebSocket\.CONNECTING/);
 assert.doesNotMatch(peerSource,/get signalingReady\(\).*?return true;/);
});
