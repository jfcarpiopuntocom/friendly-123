'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../docs/adaptive-relay.js'),'utf8');
const URL='wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+'a'.repeat(40);
const Message=global.MessageEvent||class extends Event{constructor(type,opts){super(type);this.data=opts.data}};
class FakeSocket extends EventTarget {
  constructor(url){super();this.url=url;this.readyState=0;this.bufferedAmount=0;this.sent=[];this.binaryType='arraybuffer';this.confirmed=0;}
  open(){this.readyState=1;this.dispatchEvent(new Event('open'))}
  fail(){this.readyState=3;this.dispatchEvent(new Event('error'));this.dispatchEvent(new Event('close'))}
  message(data){this.dispatchEvent(new Message('message',{data}))}
  send(x){if(this.readyState!==1)throw Error('not open');this.sent.push(x)}
  close(){this.readyState=3;this.dispatchEvent(new Event('close'))}
  confirmPeerReceipt(){this.confirmed++;return true}
  acceptPeerAck(){return true}
}
function fixture(options={}){
 const natives=[],peers=[],listeners=[];
 const window={addEventListener(name,cb){listeners.push({name,cb})},
   F123Relay:{connect(url){const x=new FakeSocket(url);natives.push(x);return x}},
   F123Peer:{create(){return {connect(url){const x=new FakeSocket(url);peers.push(x);return x},closeAll(){}}}}};
 const context={window,document:{addEventListener(){}},EventTarget,Event,MessageEvent:Message,DOMException,Promise,queueMicrotask,console,setTimeout:options.setTimeout||setTimeout,clearTimeout:options.clearTimeout||clearTimeout};
 vm.runInNewContext(source,context,{filename:'adaptive-relay.js'});
 return {window,natives,peers};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('P0 provider HTTP 402 falls back to the same peer transport across all room suffixes',async()=>{
 const f=fixture(),a=f.window.F123Relay.connect(URL+'-y'),b=f.window.F123Relay.connect(URL+'-ops');
 assert.equal(f.natives.length,1,'one native route decision for the whole notebook');
 f.natives[0].fail();await tick();
 assert.equal(f.peers.length,2,'fallback opens both channels with shared room selection');
 assert.equal(a.peerOnly,true);assert.equal(b.peerOnly,true);
 assert.equal(a.readyState,0);
 let opens=0,messages=0;
 a.onopen=()=>opens++;
 a.onmessage=e=>{assert.equal(e.data,'ciphertext');messages++};
 f.peers[0].open();f.peers[0].message('ciphertext');
 f.peers[1].open();
 assert.equal(a.readyState,1);assert.equal(b.readyState,1);
 assert.equal(opens,1);assert.equal(messages,1);
 a.send('op-id-once');
 assert.deepEqual(f.peers[0].sent,['op-id-once']);
 assert.equal(a.confirmPeerReceipt(),true);
 a.close();b.close();
 assert.equal(a.readyState,3);assert.equal(b.readyState,3);
});
test('P0 native durable route selects all suffixes and does not open WebRTC',async()=>{
 const f=fixture(),a=f.window.F123Relay.connect(URL+'-y'),b=f.window.F123Relay.connect(URL+'-ops');
 f.natives[0].open();await tick();
 assert.equal(f.natives.length,2,'one native socket per lane');
 assert.equal(f.peers.length,0,'native service must not initiate a second transport');
 f.natives[1].open();
 assert.equal(a.readyState,1);assert.equal(b.readyState,1);
 assert.equal(a.peerOnly,false);assert.equal(b.peerOnly,false);
 a.send('ciphertext');
 assert.deepEqual(f.natives[0].sent,['ciphertext']);
 a.close();b.close();
});
test('P0 bad notebook locators are rejected and cannot create backend sockets',()=>{
 const f=fixture();
 assert.throws(()=>f.window.F123Relay.connect('wss://not-friendly.example/sala/a'),/Unsupported notebook/);
 assert.equal(f.natives.length,0);assert.equal(f.peers.length,0);
});

test('P0 silent native connection times out, closes and opens peer for every lane',async()=>{
 let timeout;
 const f=fixture({setTimeout(fn,ms){assert.equal(ms,4000);timeout=fn;return 1},clearTimeout(){}});
 const a=f.window.F123Relay.connect(URL+'-y');
 const b=f.window.F123Relay.connect(URL+'-ops');
 assert.equal(f.natives.length,1);
 assert.equal(f.peers.length,0);
 timeout();
 await tick();
 assert.equal(f.natives[0].readyState,3);
 assert.equal(f.peers.length,2);
 assert.equal(a.peerOnly,true);
 assert.equal(b.peerOnly,true);
 f.peers[0].open();
 f.peers[1].open();
 assert.equal(a.readyState,1);
 assert.equal(b.readyState,1);
 a.close();b.close();
});
