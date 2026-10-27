'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

test('JSON wrapper escaping preserves valid bounded text fragments',async()=>{
  const window=new EventTarget(),document=new EventTarget();document.hidden=false;
  class WS{constructor(){this.readyState=0;}close(){this.readyState=3;}}
  Object.assign(window,{WebSocket:WS,RTCPeerConnection:function(){},crypto:require('node:crypto').webcrypto});
  const ctx={window,document,EventTarget,MessageEvent,Event,DOMException,Blob,ArrayBuffer,Uint8Array,Map,Set,Promise,queueMicrotask,TextEncoder,setTimeout,clearTimeout,
    btoa:value=>Buffer.from(value,'binary').toString('base64'),atob:value=>Buffer.from(value,'base64').toString('binary')};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/peer-sync.js'),'utf8'),ctx);
  const factory=window.F123Peer.create(),room='a'.repeat(40),socket=factory.connect('wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+room);
  const frames=[];
  const dc={readyState:'open',bufferedAmount:0,send(raw){
    this.bufferedAmount+=Buffer.byteLength(raw);frames.push(JSON.parse(raw));
    setImmediate(()=>{this.bufferedAmount=0;});
  }};
  const peer={id:'b'.repeat(32),dc,groups:new Map(),pc:{close(){}}};socket.hub.peers.set(peer.id,peer);socket.open();
  try{
    let received;
    socket.onmessage=event=>{if(event.relaySource==='peer')received=event.data;};
    const quoted=JSON.stringify({v:1,topic:'',type:'text',data:JSON.stringify({products:Array.from({length:200},(_,i)=>({id:i,name:'quoted "name"',path:'a\\b'}))})});
    const count=Math.ceil(quoted.length/12000);
    for(let i=0;i<count;i++)await socket.hub.receive(peer,JSON.stringify({v:1,id:'c'.repeat(32),i,count,data:quoted.slice(i*12000,(i+1)*12000)}));
    assert.ok(received===JSON.parse(quoted).data,'valid JSON-escaped fragments survive the raw wrapper bound');
    assert.equal(peer.groups.size,0,'accepted fragments finish without retained groups');
    await socket.hub.receive(peer,JSON.stringify({v:1,id:'d'.repeat(32),i:0,count:1,data:'x'.repeat(12001)}));
    await socket.hub.receive(peer,'x'.repeat(12000*6+257));
    assert.equal(peer.groups.size,0,'decoded fragment and raw wrapper limits remain enforced');
    const packets=[{v:1,topic:'-y',type:'text',data:'a'.repeat(36000)},{v:1,topic:'-fotos',type:'text',data:'b'.repeat(36000)}];
    assert.deepEqual(await Promise.all(packets.map(packet=>socket.hub.deliver(peer,packet))),[true,true]);
    const complete=[...new Set(frames.map(frame=>frame.id))].map(id=>JSON.parse(frames.filter(frame=>frame.id===id).sort((a,b)=>a.i-b.i).map(frame=>frame.data).join('')));
    assert.deepEqual(complete,packets,'concurrent delivery preserves every fragment and topic');
  }finally{factory.closeAll();window.F123Relay.closeAll();}
});
