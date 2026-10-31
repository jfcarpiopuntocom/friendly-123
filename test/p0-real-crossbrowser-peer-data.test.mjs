import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {chromium,webkit} from 'playwright';

test('P0 real RTCDataChannel exchanges business packets between Chromium and Safari/WebKit',async()=>{
 const html='<!doctype html><title>RTC cross-browser</title>';
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(html)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const peers=new Map();let a,b;const instances=[];
 function deliver(p,msg){setImmediate(()=>{p.evaluate(m=>window.__testRecv?.(m),msg).catch(()=>{});});}
 async function register(page,id) {
   peers.set(id,page);
   const identities=[...peers.keys()];
   for(const p of peers.values())deliver(p,{v:1,k:'peers',peers:identities});
 }
 async function signal(page,m) {
   if(m.kind==='register')return register(page,m.id);
   if(m.kind==='close'){for(const [id,p] of peers)if(p===page)peers.delete(id);return}
   if(m.kind==='send'){const remote=peers.get(m.value.to);if(remote)deliver(remote,{...m.value,from:m.from});}
 }
 async function open(browser,kind) {
   const context=await browser.newContext();
   const page=await context.newPage();await page.goto(origin);
   await page.exposeBinding('signalMock',({page},data)=>signal(page,data));
   await page.addScriptTag({content:fs.readFileSync(new URL('../docs/peer-sync.js',import.meta.url),'utf8')});
   await page.evaluate(()=>{
     class Signal {
       constructor(url){
         this.readyState=0;this.id=decodeURIComponent(url.split('peer=')[1]||'');window.__testRecv=m=>this.onmessage?.({data:JSON.stringify(m)});
         queueMicrotask(()=>{this.readyState=1;this.onopen?.();window.signalMock({kind:'register',id:this.id});});
       }
       send(s){window.signalMock({kind:'send',from:this.id,value:JSON.parse(s)})}
       close(){if(this.readyState===3)return;this.readyState=3;this.onclose?.();window.signalMock({kind:'close'})}
     }
     window.F123Relay=window.F123Peer.create({WebSocket:Signal,iceServers:[]});
     window.socket=window.F123Relay.connect('wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+ 'a'.repeat(40)+'-y');
     window.accepted=[];window.socket.onmessage=e=>{if(typeof e.data==='string')window.accepted.push(e.data)};
   });
   instances.push(context);return page;
 }
 try{
   a=await chromium.launch({headless:true});b=await webkit.launch({headless:true});
   const [pa,pb]=await Promise.all([open(a,'chromium'),open(b,'webkit')]);
   async function wait(pred,timeout=14000){
     const started=Date.now();
     for(;Date.now()-started<timeout;){
       if(await pred())return;
       await new Promise(resolve=>setTimeout(resolve,100));
     }
     throw Error('RTC cross-browser timeout');
   }
   await wait(async()=>{const both=await Promise.all([pa,pb].map(p=>p.evaluate(()=>socket.readyState)));return both.every(x=>x===1)});
   await pa.evaluate(()=>socket.send(JSON.stringify({v:1,k:'synthetic',id:'rtc-smoke-p0'})));
   await wait(()=>pb.evaluate(()=>accepted.some(s=>s.includes('rtc-smoke-p0'))));
   assert.equal(await pb.evaluate(()=>accepted.filter(s=>s.includes('rtc-smoke-p0')).length),1);
 }finally{
   for(const c of instances)try{await c.close()}catch{}
   await a?.close();await b?.close();await new Promise(r=>server.close(r));
 }
});
