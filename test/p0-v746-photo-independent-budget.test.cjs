// JFC/Fable 5.2, 12 Nov: photo history must have its own bounded daily band.
// Uses the real relay-selector in a sandbox, never a customer's data or license.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../docs/relay-selector.js'),'utf8');
const room='a'.repeat(40);
const businessUrl='wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+room+'-y';
const photoUrl='wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+room+'-fotos';
const MiB=1024*1024;

function fixture({business,photos,wireDown}={}) {
  const db=new Map();
  const day=new Date().toISOString().slice(0,10);
  const root='f123_relay_cupo_v1';
  if(business)db.set(root,JSON.stringify({dia:day,up:0,down:0,...business}));
  if(photos)db.set(root+'_fotos',JSON.stringify({dia:day,up:0,down:0,...photos}));
  const localStorage={getItem:k=>db.has(k)?db.get(k):null,setItem:(k,v)=>db.set(k,String(v)),removeItem:k=>db.delete(k)};
  const opened=[];
  const real={connect(url){
    const listeners={};
    const ws={url,readyState:1,peerOnly:false,bufferedAmount:0,sent:[],relayLayer:'test',
      addEventListener(type,fn){(listeners[type] ||= []).push(fn);},
      removeEventListener(){},send(v){this.sent.push(v);},
      close(){this.readyState=3;},
      emit(type,ev){(listeners[type]||[]).forEach(f=>f(ev));}
    };opened.push(ws);return ws;
  }};
  if(wireDown)real.wireDown=wireDown;
  const peer={connect(url){return {url,peerOnly:true,readyState:1,addEventListener(){},send(){},close(){}};}};
  const window={F123Relay:real,F123FirebaseRelay:null,F123Peer:{create:()=>peer},OCCanarios:null};
  const ctx={window,localStorage,Date,Math,JSON,Promise,DOMException,EventTarget,Event,
    setInterval:()=>0,clearInterval:()=>{},console:{log(){},warn(){}}};
  vm.runInNewContext(src,ctx,{filename:'relay-selector.js'});
  return {relay:window.F123Relay,db,opened,root};
}
test('photo pull has its own down quota even after catalog consumed 20 MiB',()=>{
  const f=fixture({business:{up:2*MiB,down:20*MiB}});
  const socket=f.relay.connect(photoUrl);
  assert.equal(socket.peerOnly,false,'photo lane may still use durable relay');
});
test('photo quota exhaustion never starves inventory and money',()=>{
  const f=fixture({photos:{up:MiB,down:10*MiB}});
  assert.equal(f.relay.connect(photoUrl).peerOnly,true,'photos fall back to peers at their own limit');
  assert.equal(f.relay.connect(businessUrl).peerOnly,false,'catalog lane retains full budget');
});
test('sending an encrypted photo is charged only against photo upload band',()=>{
  const f=fixture();
  const s=f.relay.connect(photoUrl);
  s.send(JSON.stringify({k:'op',c:'ciphertext',id:'private-test'}));
  const b=f.relay.estadoCupo()[0];
  assert.equal(b.up,0,'photo bytes cannot consume business upload quota');
  assert.ok(b.fotos && b.fotos.up>0,'photo bytes are billed explicitly');
  assert.equal(b.fotos.limiteUp,MiB);
  assert.equal(b.fotos.limiteDown,10*MiB);
});
test('photo downloads charge the photo band, never the catalog band',()=>{
  let photoWire=700, catalogWire=200;
  const f=fixture({wireDown:url=>url===photoUrl?photoWire:catalogWire});
  const s=f.relay.connect(photoUrl);
  s.emit('message',{data:JSON.stringify({k:'pull-page',v:2})});
  const c=f.relay.estadoCupo()[0];
  assert.equal(c.down,0);
  assert.equal(c.fotos.down,700);
  photoWire+=100;
  s.emit('message',{data:JSON.stringify({k:'pull-page',v:2})});
  assert.equal(f.relay.estadoCupo()[0].fotos.down,800);
});
test('photo pause cannot erase already consumed daily bytes',()=>{
  const f=fixture({photos:{up:12345,down:22222}});
  const s=f.relay.connect(photoUrl);
  s.emit('error',{});
  s.close(1013,'relay unavailable');
  const c=f.relay.estadoCupo()[0].fotos;
  assert.equal(c.up,12345);
  assert.equal(c.down,22222);
});
