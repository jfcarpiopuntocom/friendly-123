// P0: TURN is configured by F123Ice but both ICE sender and metadata validator
// used to discard typ relay. Probe actual source, not a rewritten algorithm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { validSignal } from '../cloudflare-sync-relay/worker.js';

const candidate = 'candidate:1234 1 UDP 1677729535 192.0.2.10 54321 typ relay raddr 198.51.100.4 rport 33333';
const ice = { v:1, k:'ice', to:'f'.repeat(32),
  data:{ candidate, sdpMid:'0', sdpMLineIndex:0, usernameFragment:'abc' } };

test('TURN candidate is accepted as validated ICE-only metadata, never arbitrary payload', () => {
  assert.equal(validSignal(ice), true, 'a legitimate typ relay is essential to TURN fallback');
  for (const bad of [
    { ...ice, data:{ ...ice.data, candidate:candidate.replace('typ relay','typ business') } },
    { ...ice, data:{ ...ice.data, candidate:candidate.replace('192.0.2.10','not-an-address') } },
    { ...ice, data:{ ...ice.data, candidate:candidate+' extra business=100' } },
    { ...ice, payload:{ sale:'do-not-transmit' } },
  ]) assert.equal(validSignal(bad), false, 'strict metadata-only border must remain');
});

test('actual peer-sync.js emits a TURN relay candidate and ignores empty ICE', async () => {
  const source=fs.readFileSync(new URL('../docs/peer-sync.js',import.meta.url),'utf8');
  const emitted=[];let signal,pc;
  class WS {
    constructor(){this.readyState=1;signal=this;}
    send(value){emitted.push(JSON.parse(value));}
    close(){}
  }
  class RTC {
    constructor(){pc=this;this.signalingState='stable';}
    createDataChannel(label){return {label};}
    async createOffer(){return {type:'offer',sdp:'fixture'};}
    async setLocalDescription(d){this.localDescription={toJSON:()=>d};}
    close(){}
  }
  const window={addEventListener(){}};
  const ctx=vm.createContext({window,document:{addEventListener(){}},EventTarget,Event,
    MessageEvent:class extends Event{constructor(type,opts){super(type);this.data=opts?.data;}},
    queueMicrotask,setTimeout,clearTimeout,btoa,atob,console});
  vm.runInContext(source,ctx);
  const adapter=window.F123Peer.create({WebSocket:WS,RTCPeerConnection:RTC,crypto:globalThis.crypto});
  adapter.connect('wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/'+'a'.repeat(40));
  signal.onmessage({data:JSON.stringify({v:1,k:'peers',peers:['f'.repeat(32)]})});
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.ok(pc?.onicecandidate,'real peer callback must be installed');
  const before=emitted.length;
  pc.onicecandidate({candidate:{type:'relay',candidate,toJSON:()=>ice.data}});
  pc.onicecandidate({candidate:{type:null,candidate:'',toJSON:()=>({candidate:''})}});
  assert.equal(emitted.length,before+1,'only one valid relay candidate is signalled');
  assert.equal(emitted.at(-1).k,'ice');
  assert.equal(validSignal(emitted.at(-1)),true);
});
