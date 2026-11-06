'use strict';
// RED A y RED B (hallazgos de OpenCode sobre el timeout de test/peer-sync-browser.test.js:167).
// Sin navegador: se ejercita la ruta REAL publicar()/manejar() de docs/sync-yjs.js con un socket
// falso peerOnly que cuenta lo que se escribe en la linea. Todo sintetico; sin red ni datos de clientes.
//   A: en peerOnly, el mismo ciphertext no debe salir por dos carriles (binary vivo + op durable).
//   B: el mismo vector de estado no debe recibir el estado completo mas de una vez en el handshake.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const block=src.slice(src.indexOf('  function _frame('),src.indexOf('  // Carga perezosa'));
const tick=()=>new Promise(r=>setImmediate(r));
async function settle(n=12){for(let i=0;i<n;i++){await tick();await new Promise(r=>setTimeout(r,0));}}
async function fixture(prepare){
  const sockets=[],timers=[],data=new Map();
  class Socket{constructor(){this.readyState=1;this.sent=[];this.peerOnly=true;sockets.push(this)}
    get bufferedAmount(){return 0}send(x){this.sent.push(x)}close(){this.readyState=3;this.onclose?.()}}
  const db={objectStoreNames:{contains:k=>k==='updates'},transaction(){const tx={};queueMicrotask(()=>tx.oncomplete?.());return tx}};
  const p={whenSynced:Promise.resolve(),db,get:async k=>structuredClone(data.get(k)),set:async(k,v)=>{data.set(k,structuredClone(v))}};
  const ctx={API:{clave:'synthetic',roomId:'synthetic'},RELAY_URL:'fixture:',crypto:crypto.webcrypto,
    WebSocket:class{constructor(){throw Error('raw relay fallback forbidden')}},
    window:{dispatchEvent(){},F123Relay:{connect:()=>new Socket()}},
    document:{hidden:false,visibilityState:'visible',addEventListener(){}},CustomEvent:class{},log(){},
    Date,Math,JSON,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder,setInterval,clearInterval,
    setTimeout(fn,ms){timers.push({fn,ms});return timers.length},clearTimeout(id){if(timers[id-1])timers[id-1].cancelled=true},
    btoa:s=>Buffer.from(s,'binary').toString('base64'),
    cifrarBin:async(_,b)=>b.slice().buffer,descifrarBin:async(_,b)=>new Uint8Array(b)};
  vm.createContext(ctx);vm.runInContext(block+'\nthis.make=crearCanal;',ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8'),ctx);
  const Y=ctx.Y,doc=new Y.Doc();if(prepare)prepare(Y,doc,ctx);
  const channel=ctx.make(Y,doc,'-y','fixture',true,null,p);channel.conectar();
  const ws=sockets[0];ws.onopen();await settle();
  return {Y,doc,channel,ws,ctx};
}
const sha=b=>crypto.createHash('sha1').update(Buffer.from(b)).digest('hex');
const SEED=()=>({id:'synthetic-sale',total:42.75,stock:7,history:['sale','payment'],photo:'synthetic-photo-'+'x'.repeat(220000)});

test('RED A: en peerOnly el mismo ciphertext no sale por el carril vivo Y por el durable',async()=>{
  const f=await fixture();
  const payload=new Uint8Array(220130);for(let i=0;i<payload.length;i++)payload[i]=(i*31+7)&255; // ~update de 220 KB (2 piezas)
  f.channel.enviarUpdate(payload);await settle(30);
  const live=f.ws.sent.filter(x=>typeof x!=='string').map(x=>new Uint8Array(x));
  const ops=f.ws.sent.filter(x=>typeof x==='string').map(x=>{try{return JSON.parse(x)}catch(_){return null}}).filter(m=>m&&m.k==='op');
  assert.ok(live.length>0||ops.length>0,'el fixture debe haber emitido algo');
  const liveHashes=new Set(live.map(sha)),opHashes=ops.map(o=>sha(Buffer.from(o.c,'base64')));
  const both=opHashes.filter(h=>liveHashes.has(h));
  const wireBytes=live.reduce((n,b)=>n+b.length,0)+ops.reduce((n,o)=>n+Buffer.from(o.c,'base64').length,0);
  assert.equal(both.length,0,`peerOnly envia ${both.length} pieza(s) por AMBOS carriles (binary vivo + op durable): `+
    `${wireBytes} bytes de ciphertext por un payload de ${payload.length} (${(wireBytes/payload.length).toFixed(2)}x)`);
  assert.ok(wireBytes<=payload.length*1.15,`bytes por la linea ${wireBytes} > 1.15x el payload ${payload.length}`);
});


test('P0: one-fragment business update keeps live priority and durable ACK path',async()=>{
  const f=await fixture();
  const payload=new Uint8Array(128);for(let i=0;i<payload.length;i++)payload[i]=(i*13+17)&255;
  f.channel.enviarUpdate(payload);await settle(20);
  const live=f.ws.sent.filter(x=>typeof x!=='string').map(x=>new Uint8Array(x));
  const ops=f.ws.sent.filter(x=>typeof x==='string').map(x=>{try{return JSON.parse(x)}catch(_){return null}}).filter(x=>x&&x.k==='op');
  const liveHashes=new Set(live.map(sha));
  const opHashes=ops.map(x=>sha(Buffer.from(x.c,'base64')));
  assert.ok(opHashes.some(x=>liveHashes.has(x)),'small one-piece business sale must retain immediate live delivery');
  assert.equal(ops.length,1,'the sale still requires a durable outbox and receipt');
});
