'use strict';
// C205: the server copy of a big catalog has causal holes (a prefix of one author's history is gone) and no checkpoint can
// cover it (> cap). A COMPLETE device must put its full state back on the durable layer, once, within budget.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const block=src.slice(src.indexOf('  function _frame('),src.indexOf('  // Carga perezosa'));
const yjs=fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
async function settle(n=20){for(let i=0;i<n;i++)await tick();}
const ops=s=>s.sent.filter(x=>typeof x==='string').map(JSON.parse).filter(x=>x.k==='op');

// Server log with a hole: three authors write; the FIRST update of author "b" never reached the server.
function build(Y){
 const authors=[0,1,2].map(()=>new Y.Doc()),log=[];
 authors.forEach((d,i)=>{
  d.on('update',u=>log.push({i,u}));
  for(let n=0;n<150;n++)d.getMap('productos').set('p'+i+'_'+n,'x'.repeat(500)+n);
 });
 const full=new Y.Doc();
 authors.forEach(d=>Y.applyUpdate(full,Y.encodeStateAsUpdate(d)));
 const bFirst=log.findIndex(x=>x.i===1);
 const holed=log.filter((x,k)=>k!==bFirst).map(x=>x.u);
 return {full,holed,bytes:Y.encodeStateAsUpdate(full).length};
}
async function device(fullDoc,opts={}){
 const sockets=[],timers=[],data=new Map(),ls=opts.sharedStorage||new Map();
 class Socket{constructor(){this.readyState=1;this.sent=[];sockets.push(this)}send(x){this.sent.push(x)}close(){this.readyState=3;this.onclose?.()}}
 const db={objectStoreNames:{contains:k=>k==='updates'},transaction(){const tx={};queueMicrotask(()=>tx.oncomplete?.());return tx;}};
 const p={whenSynced:Promise.resolve(),db,get:async k=>structuredClone(data.get(k)),set:async(k,v)=>{data.set(k,structuredClone(v))}};
 const ctx={API:{clave:'synthetic',roomId:opts.roomId||'synthetic'},RELAY_URL:'fixture:',crypto:require('node:crypto').webcrypto,
  localStorage:{getItem:k=>ls.has(k)?ls.get(k):null,setItem:(k,v)=>{ls.set(k,String(v))}},
  WebSocket:class{constructor(){throw Error('raw relay forbidden')}},
  window:{dispatchEvent(){},F123Relay:{connect:()=>new Socket()}},
  document:{hidden:false,visibilityState:'visible',addEventListener(){},getElementById(){return null},createElement(){return {style:{},setAttribute(){}}},body:{appendChild(){}}},
  CustomEvent:class{},log(){},Date,Math,JSON,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder,setInterval,clearInterval,
  setTimeout(fn,ms){timers.push({fn,ms});return timers.length},clearTimeout(id){if(timers[id-1])timers[id-1].cancelled=true},
  btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),
  cifrarBin:async(_,b)=>b.slice().buffer,descifrarBin:async(_,b)=>new Uint8Array(b)};
 vm.createContext(ctx);vm.runInContext(yjs,ctx);vm.runInContext(block+'\nthis.make=crearCanal;',ctx);
 const Y=ctx.Y,doc=new Y.Doc();
 Y.applyUpdate(doc,fullDoc(Y)); // complete device: holds every change
 const channel=ctx.make(Y,doc,'-y','catalogo',true,null,p);channel.conectar();
 const s=sockets[0];s.onopen();await settle(4);
 s.onmessage({data:JSON.stringify({k:'head-result',unsupported:true})});await settle(4);
 s.onmessage({data:JSON.stringify({k:'pull-page',rev:0,seq:0,more:false})});await settle(4);
 return {Y,doc,channel,socket:s,ls,
  async ckpt(){for(let r=0;r<3;r++){timers.filter(t=>!t.cancelled&&!t.done&&(t.ms===2500||t.ms===250)).forEach(t=>{t.done=true;t.fn()});await settle(30);}},
  async drain(){for(let r=0;r<3;r++){timers.filter(t=>!t.cancelled&&!t.done&&t.ms>=1000&&t.ms<=72000&&t.ms!==30000&&t.ms!==2500).forEach(t=>{t.done=true;t.fn();});await settle();}}};
}
function assemble(list){
 const frames=list.map(o=>Buffer.from(o.c,'base64'));
 if(frames.length===1&&frames[0][0]===0)return frames[0].subarray(1);
 frames.sort((a,b)=>(a[18]*256+a[19])-(b[18]*256+b[19]));
 assert.ok(frames.every(f=>f[0]===3&&f[1]===0&&f[20]*256+f[21]===frames.length),'one complete group');
 return Buffer.concat(frames.map(f=>f.subarray(22)));
}

test('C205 RED->GREEN: complete device repairs a server log with a causal hole; new device finishes; zero data lost; once only',async()=>{
 let fx;
 const a=await device(Y=>{fx=build(Y);return Y.encodeStateAsUpdate(fx.full)});
 assert.ok(fx.bytes>200*1024,'state is over the no-checkpoint size: '+fx.bytes);
 // Baseline: the server log alone leaves a new device with unresolved ancestors (recuperando would stay true).
 const joinerA=new a.Y.Doc();fx.holed.forEach(u=>a.Y.applyUpdate(joinerA,u));
 assert.ok(joinerA.store.pendingStructs,'precondition: holed log leaves pendingStructs');
 const bin0=a.socket.sent.filter(x=>typeof x!=='string').length;
 await a.ckpt();await a.drain();await settle(40);
 const sent=ops(a.socket),groups=new Map();sent.forEach(o=>{if(!groups.has(o.id))groups.set(o.id,o)});
 assert.ok(groups.size>=2,'a full-state fragment group was published to the durable layer (got '+groups.size+')');
 assert.equal(new Set([...groups.values()].map(o=>o.group)).size,1,'a single group');
 assert.ok(sent.every(o=>!('rep' in o)&&!('abs' in o)),'no local-only fields on the wire');
 assert.equal(a.socket.sent.filter(x=>typeof x!=='string').length,bin0,'no live broadcast of the repair');
 // The seven-day cooldown must be earned only by the full durable ACK; otherwise a crash before outbox commit locks recovery.
 const cooldownBeforeAck=JSON.parse(a.ls.get('f123_huecos_v1:synthetic-y')||'{}');
 assert.equal(cooldownBeforeAck.local,undefined,'C205 RED: publishing before ACK must not start seven-day cooldown');
 // New device: holed log + the repair group => recovery can finish.
 const joinerB=new a.Y.Doc();fx.holed.forEach(u=>a.Y.applyUpdate(joinerB,u));
 a.Y.applyUpdate(joinerB,assemble([...groups.values()]));
 assert.equal(joinerB.store.pendingStructs,null,'no pending ancestors after the repair');
 assert.equal(joinerB.store.pendingDs,null);
 assert.deepEqual(joinerB.getMap('productos').toJSON(),a.doc.getMap('productos').toJSON(),'same products, nothing deleted');
 // Limiter: ACK everything and retrigger: no second group within 7 days.
 for(const id of groups.keys())a.socket.onmessage({data:JSON.stringify({k:'persist-result',id,kind:'op',ok:true})});
 await settle(40);const before=new Set(ops(a.socket).map(o=>o.group).filter(Boolean)).size;
 a.socket.onopen();await a.ckpt();await a.drain();await settle(30);
 assert.equal(new Set(ops(a.socket).map(o=>o.group).filter(Boolean)).size,before,'at most once per layer per 7 days');
 assert.ok(JSON.parse(a.ls.get('f123_huecos_v1:synthetic-y')||'{}')['local'],'limiter persisted');
});

test('C205: budget exhausted (QuotaExceeded) keeps the group queued, nothing lost',async()=>{
 const a=await device(Y=>Y.encodeStateAsUpdate(build(Y).full));
 a.socket.send=()=>{const e=new Error('cupo');e.name='QuotaExceededError';throw e};
 await a.ckpt();await a.drain();await settle(40);
 assert.equal(a.socket.readyState,1,'socket stays up on a budget refusal');
 assert.ok(a.channel.pendientesRelay>=2,'group waits in the outbox for another day');
});

test('C205: photos channel never repairs (source guard)',()=>{
 const i=src.indexOf('function repararHuecosServidor(full) {');
 assert.match(src.slice(i,i+300),/nombre === "fotos"/);
});

// Source-executed test: stale cooldown of license A in the same browser must not block clean license B.
test('C205: license A cooldown never blocks repair for B using the same localStorage',async()=>{
 const shared=new Map([
  ['f123_huecos_v1-y',JSON.stringify({local:Date.now()})], // obsolete global key must be ignored
  ['f123_huecos_v1:A-y',JSON.stringify({local:Date.now()})]
 ]);
 const b=await device(Y=>Y.encodeStateAsUpdate(build(Y).full),{roomId:'B',sharedStorage:shared});
 await b.ckpt();await b.drain();await settle(40);
 assert.ok(ops(b.socket).length>=2,'B must publish its repair even though A already has a cooldown');
 assert.equal(JSON.parse(shared.get('f123_huecos_v1:B-y')||'{}').local,undefined,'B cooldown starts only after its own durable ACK');
});
