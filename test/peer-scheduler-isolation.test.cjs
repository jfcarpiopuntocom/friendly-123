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
    if(opts.fre¶»§q«^