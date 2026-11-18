'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const read=p=>fs.readFileSync(require('node:path').join(__dirname,'..',p),'utf8');
test('RED: dashboard encrypted transient broadcast delivers exact bytes to same room, rejects other room',async()=>{
 const source=read('docs/dashboard-broadcast.js');
 const peers=new Map(),published=[];
 const fake={channel(topic){
  const handlers=[];const item={topic,handlers,closed:false};
  if(!peers.has(topic))peers.set(topic,[]);
  peers.get(topic).push(item);
  return {
   on(type,filter,fn){assert.equal(type,'broadcast');handlers.push({event:filter.event,fn});return this},
   subscribe(fn){queueMicrotask(()=>fn('SUBSCRIBED'));return this},
   async send(message){assert.equal(message.type,'broadcast');published.push(message);for(const x of peers.get(topic)){if(x===item||x.closed)continue;for(const h of x.handlers)if(h.event===message.event)h.fn({payload:message.payload})}return 'ok'},
   async unsubscribe(){item.closed=true}
  }
 }};
 const context={window:{F123DashboardRealtime:fake},EventTarget,Event,MessageEvent,TextEncoder,Uint8Array,ArrayBuffer,crypto:crypto.webcrypto,console,Promise,Map,Set,JSON,Date,Math,atob,btoa,setTimeout,clearTimeout,queueMicrotask,DOMException};
 vm.runInNewContext(source,context);
 const bus=context.window.F123DashboardBroadcast;
 assert.equal(typeof bus.connect,'function');
 const a=bus.connect('wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+'a'.repeat(40));
 const b=bus.connect('wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+'a'.repeat(40));
 const wrong=bus.connect('wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+'b'.repeat(40));
 await new Promise(r=>setTimeout(r,10));
 assert.equal(a.readyState,1);assert.equal(b.readyState,1);assert.equal(wrong.readyState,1);
 let bytes=null,wrongHit=0;
 b.addEventListener('message',e=>{bytes=Array.from(new Uint8Array(e.data));});
 wrong.addEventListener('message',()=>{wrongHit++});
 const secret=Uint8Array.from([15,0,127,255,1,2,3,4]);
 a.send(secret.buffer);
 await new Promise(r=>setTimeout(r,10));
 assert.deepEqual(bytes,Array.from(secret));assert.equal(wrongHit,0);
 assert.ok(published.every(x=>typeof x.payload?.c==='string'&&!JSON.stringify(x).includes('15,0,127')),'wire only base64 ciphertext');
 assert.throws(()=>a.send('plaintext'),/binary|cipher|ArrayBuffer/);
 a.close();b.close();wrong.close();
});
test('RED: real index loads dashboard bus after vendor and before legacy sync; dashboard selects encrypted bus',()=>{
 const index=read('docs/index.html'),dash=read('docs/dashboard.html'),legacy=read('docs/sync-realtime.js'),vendor=read('docs/vendor/supabase-relay.min.js');
 assert.ok(index.includes('dashboard-broadcast.js')&&index.indexOf('dashboard-broadcast.js')<index.indexOf('sync-realtime.js'));
 assert.ok(dash.includes('dashboard-broadcast.js')&&dash.indexOf('dashboard-broadcast.js')<dash.indexOf('dashboard-main.min.js'));
 assert.ok(dash.includes('dashboard-broadcast.js\" data-f123-dashboard'),'dashboard-only transport selector is script attribute');
 assert.ok(read('docs/dashboard-broadcast.js').includes('window.F123Relay = window.F123DashboardRealtime'),'client selector uses already-loaded ephemeral SDK');
 assert.ok(vendor.includes('window.F123DashboardRealtime=mn'),'SDK instance exported, no duplicate SDK');
 assert.ok(legacy.includes('dashboard-broadcast')&&legacy.includes('ev.relaySource === "dashboard-broadcast"'),'existing Owner PIN verification re-used by app');
});
