import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium, webkit } from 'playwright';
import { validSignal } from '../cloudflare-sync-relay/worker.js';

test('P0 actual Chromium and Safari/WebKit SDP passes production signaling filter', async () => {
  const server=http.createServer((q,r)=>{r.writeHead(200,{'content-type':'text/html'});r.end('<!doctype html><meta charset="utf-8"><title>WebRTC production filter QA</title>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  try {
    for (const [name,engine] of [['Chromium',chromium],['Safari/WebKit',webkit]]) {
      const browser=await engine.launch({headless:true});
      try {
        const page=await browser.newPage();await page.goto(url);
        const generated=await page.evaluate(async()=>{
          const pc=new RTCPeerConnection({iceServers:[]});
          pc.createDataChannel('friendly-direct-v1');
          const ice=[];pc.onicecandidate=e=>{if(e.candidate)ice.push(e.candidate.toJSON())};
          await pc.setLocalDescription(await pc.createOffer());
          for(let i=0;i<45&&pc.iceGatheringState!=='complete';i++)await new Promise(r=>setTimeout(r,20));
          const result={offer:pc.localDescription.toJSON(),ice,lines:pc.localDescription.sdp.trim().split(/\\r?\\n/)};
          pc.close();return result;
        });
        assert.equal(generated.offer.type,'offer');
        const result=validSignal({v:1,k:'offer',to:'a'.repeat(32),data:generated.offer});
        if(!result) console.log(name+' REJECTED SDP LINE TYPES: '+JSON.stringify(generated.lines.map(x=>x.split(':')[0]).filter((x,i,a)=>a.indexOf(x)===i)));
        assert.equal(result,true,name+' genuine datachannel SDP must be accepted');
        for(const c of generated.ice.filter(c=>c.candidate&&!c.candidate.includes(' typ relay '))) {
          assert.equal(validSignal({v:1,k:'ice',to:'a'.repeat(32),data:c}),true,name+' genuine ICE candidate must be accepted');
        }
      } finally {await browser.close();}
    }
  } finally {await new Promise(resolve=>server.close(resolve))}
});
