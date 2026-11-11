'use strict';
// P0 #681: bounded replay GET retry against the actual Firebase adapter.
// All fetches synthetic; no network or real notebook.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const SOURCE=fs.readFileSync(path.join(__dirname,'../docs/firebase-relay.js'),'utf8');
const URL='wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+'a'.repeat(40)+'-y';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const ok=()=>({ok:true,status:200,text:async()=> 'null',json:async()=>null,headers:{get:()=>null}});
const httpError=status=>({ok:false,status,text:async()=>'',json:async()=>null,headers:{get:()=>null}});
function setup(fetchFn) {
  const w={TextEncoder,Uint8Array,ArrayBuffer,JSON,Promise,Number,String,Object,Math,
    EventTarget,Event,MessageEvent,DOMException,URLSearchParams,setTimeout,clearTimeout,btoa,atob,Date};
  w.window=w;vm.runInNewContext(SOURCE,w);
  const relay=w.F123FirebaseRelay.create({fetch:fetchFn,EventSource:null});
  const ws=relay.connect(URL),close=[],messages=[];
  ws.addEventListener('close',e=>close.push(e.code));
  ws.addEventListener('message',e=>{if(typeof e.data==='string')messages.push(JSON.parse(e.data));});
  return {ws,close,messages};
}
test('P0 RED: two transient GET failures in a row retain the live Firebase socket and finish the same pull',async()=>{
  let requests=0,checkpointGets=0;
  const {ws,close,messages}=setup(async (url,options)=>{
    requests++;
    if(url.includes('/k.json')){
      checkpointGets++;
      if(checkpointGets===2||checkpointGets===3)throw new TypeError('synthetic GET network outage');
    }
    return ok();
  });
  await wait(30);
  assert.equal(ws.readyState,1,'opened before transient read errors');
  ws.send(JSON.stringify({k:'pull',v:2,rev:0,seq:0,limit:12}));
  await wait(650);
  assert.equal(ws.readyState,1,'bounded GET retry must not close the socket/restart Yjs cursor');
  assert.deepEqual(close,[],'no 1006 or 1011 on a recovered idempotent read');
  assert.equal(checkpointGets,4,'one initial GET plus three checkpoint-read attempts');
  assert.equal(messages.filter(m=>m.k==='pull-page').length,1,'one completed page and one cursor response');
  assert.ok(requests>=5,'the fixture observed the subsequent operations-page read');
});
test('P0 RED: three exhausted GET failures still close as network, never acknowledge an unfinished pull',async()=>{
  let gets=0;
  const {ws,close,messages}=setup(async url=>{
    if(url.includes('/k.json')){
      gets++;
      if(gets>1)throw new TypeError('synthetic persistent GET outage');
    }
    return ok();
  });
  await wait(30);
  ws.send(JSON.stringify({k:'pull',v:2,rev:0,seq:0,limit:12}));
  await wait(650);
  assert.equal(gets,4,'initial GET plus at most three read attempts');
  assert.equal(ws.readyState,3);
  assert.deepEqual(close,[1006],'network error remains a short-retry close');
  assert.equal(messages.some(m=>m.k==='pull-page'),false,'never ACK or advance a failed page');
});
test('P0: writes and HTTP denials stay single-attempt fail-closed',async()=>{
  let writes=0;
  const write=setup(async (url,opts)=>{
    if(url.includes('/k.json'))return ok();
    if(opts.method!=='GET'){writes++;throw new TypeError('synthetic POST failed');}
    return ok();
  });
  await wait(30);
  write.ws.send(JSON.stringify({k:'op',id:'synthetic-1',c:'AA==',lam:1,ack:1}));
  await wait(60);
  assert.equal(writes,1,'no automatic POST retries, even if the response was lost');
  assert.deepEqual(write.close,[1006]);
  assert.equal(write.messages.some(m=>m.k==='persist-result'&&m.ok===true),false);
  let checkpointGets=0;
  const denied=setup(async url=>{
    if(url.includes('/k.json')){checkpointGets++;if(checkpointGets>1)return httpError(503);}
    return ok();
  });
  await wait(30);
  denied.ws.send(JSON.stringify({k:'pull',v:2,rev:0,seq:0,limit:12}));
  await wait(80);
  assert.equal(checkpointGets,2,'HTTP 503 is not retried as network');
  assert.deepEqual(denied.close,[1011],'HTTP refusal keeps the old safe closure');
});
