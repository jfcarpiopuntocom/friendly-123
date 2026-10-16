const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const source=fs.readFileSync(process.env.YJS_SOURCE||path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const block=source.slice(source.indexOf('  function _frame('),source.indexOf('  // Carga perezosa'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('real WebRTC transfers encrypted updates directly and falls back when a peer disconnects',async()=>{
 const server=http.createServer((q,r)=>{r.writeHead(200,{'Content-Type':'text/html'});r.end('<!doctype html><title>Synthetic direct sync</title>')});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const web=await chromium.launch({headless:true});
 try{
  const pages=[];
  for(let n=0;n<2;n++){
   const ctx=await web.newContext(),page=await ctx.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
   await page.evaluate(async source=>{
    const native=RTCPeerConnection;window.pcs=[];
    window.RTCPeerConnection=class extends native{constructor(){super({iceServers:[]});pcs.push(this)}};
    window.socket=null;class SyntheticRelay{constructor(){this.readyState=1;this.sent=[];socket=this}send(x){this.sent.push(x)}};
    window.F123Relay={connect:()=>new SyntheticRelay()};
    window.WebSocket=class{constructor(){throw Error("Raw relay fallback forbidden")}};
    window.API={roomId:'synthetic-direct',clave:await crypto.subtle.importKey('raw',new Uint8Array(32).fill(17),'AES-GCM',false,['encrypt','decrypt'])};
    window.RELAY_URL='fixture:';window.log=()=>{};
    window.cifrarBin=async(k,p)=>{const iv=crypto.getRandomValues(new Uint8Array(12)),c=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},k,p)),r=new Uint8Array(12+c.length);r.set(iv);r.set(c,12);return r.buffer};
    window.descifrarBin=async(k,p)=>{p=new Uint8Array(p);return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:p.subarray(0,12)},k,p.subarray(12)))};
    window.received=[];window.Y={encodeStateVector:()=>new Uint8Array([0]),encodeStateAsUpdate:()=>new Uint8Array([0,0]),applyUpdate:(_,b)=>received.push(Array.from(b))};
    const data=new Map();window.persist={get:async k=>structuredClone(data.get(k)),set:async(k,v)=>data.set(k,structuredClone(v))};
    (0,eval)(source+'\nwindow.channel=crearCanal(Y,{},"-test","fixture",false,null,persist);');
    channel.conectar();socket.onopen();socket.onmessage({data:JSON.stringify({k:'peer-count',n:2})});
   },block);pages.push(page);
  }
  let relayBinary=0;
  async function flush(){
   for(let i=0;i<2;i++){
    const frames=await pages[i].evaluate(()=>socket.sent.splice(0).map(x=>typeof x==='string'?{s:x}:{b:btoa(String.fromCharCode(...new Uint8Array(x)))}));
    for(const frame of frames){
     if(frame.s){const msg=JSON.parse(frame.s);if(msg.k==='op'||msg.k==='ckpt')await pages[i].evaluate(m=>socket.onmessage({data:JSON.stringify({k:'persist-result',id:m.id,kind:m.k,ok:true})}),msg);continue;}
     relayBinary++;await pages[1-i].evaluate(f=>socket.onmessage({data:Uint8Array.from(atob(f.b),c=>c.charCodeAt(0)).buffer}),frame);
    }
   }
  }
  for(let i=0;i<60;i++){await flush();if((await Promise.all(pages.map(p=>p.evaluate(()=>channel.paresDirectos||0)))).every(x=>x===1))break;await pause(50)}
  assert.deepEqual(await Promise.all(pages.map(p=>p.evaluate(()=>channel.paresDirectos||0))),[1,1]);
  await flush();const before=relayBinary;
  await pages[0].evaluate(()=>channel.enviarUpdate(new Uint8Array([1,4,9])));
  for(let i=0;i<20;i++){await flush();if(await pages[1].evaluate(()=>received.some(x=>x.join(',')==='1,4,9')))break;await pause(20)}
  assert.equal(relayBinary,before,'business update goes over the real direct data channel');
  assert.equal(await pages[1].evaluate(()=>received.filter(x=>x.join(',')==='1,4,9').length),1);
  await pages[0].evaluate(()=>pcs.forEach(p=>p.close()));await pause(80);
  await pages[0].evaluate(()=>channel.enviarUpdate(new Uint8Array([9,8])));
  for(let i=0;i<20;i++){await flush();if(await pages[1].evaluate(()=>received.some(x=>x.join(',')==='9,8')))break;await pause(20)}
  assert.ok(relayBinary>before,'relay fallback remains available when direct transport fails');
  assert.equal(await pages[1].evaluate(()=>received.filter(x=>x.join(',')==='9,8').length),1);
 }finally{await web.close();await new Promise(r=>server.close(r))}
});
