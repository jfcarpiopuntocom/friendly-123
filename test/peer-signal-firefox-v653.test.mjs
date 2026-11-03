// v653: real Firefox output (captured 2026-11-03) was refused by the signaling relay, so the direct channel never opened with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { validSignal } from '../cloudflare-sync-relay/worker.js';

const code = fs.readFileSync(new URL('../docs/peer-sync.js', import.meta.url), 'utf8');
const SDP = ['v=0', 'o=mozilla...THIS_IS_SDPARTA-99.0 6121530470151846107 0 IN IP4 0.0.0.0', 's=-', 't=0 0', 'a=sendrecv',
  'a=fingerprint:sha-256 ' + Array(32).fill('AB').join(':'), 'a=group:BUNDLE 0', 'a=ice-options:trickle', 'a=msid-semantic:WMS *',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', 'a=sendrecv', 'a=ice-pwd:abc123', 'a=ice-ufrag:abc', 'a=mid:0', 'a=setup:actpass', 'a=sctp-port:5000', 'a=max-message-size:1073741823', ''].join('\r\n');

test('a Firefox offer passes the relay filter and its empty end-of-candidates is not sent', async () => {
  const enviados = []; let socket, pc;
  class WS { constructor() { this.readyState = 1; socket = this; } send(x) { enviados.push(JSON.parse(x)); } close() {} }
  class RTC {
    constructor() { pc = this; this.signalingState = 'stable'; }
    createDataChannel(label) { return { label }; }
    async createOffer() { return { type: 'offer', sdp: SDP }; }
    async setLocalDescription(d) { this.localDescription = { toJSON: () => d }; }
    close() {}
  }
  const window = { addEventListener() {} };
  const ctx = vm.createContext({ window, document: { addEventListener() {} }, EventTarget, Event, MessageEvent: class extends Event { constructor(t, o) { super(t); this.data = o && o.data; } }, queueMicrotask, setTimeout, clearTimeout, btoa, atob, console });
  vm.runInContext(code, ctx);
  const peer = window.F123Peer.create({ WebSocket: WS, RTCPeerConnection: RTC, crypto: globalThis.crypto });
  peer.connect('wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/' + 'a'.repeat(40) + '-fotos');
  const otro = 'f'.repeat(32);
  socket.onmessage({ data: JSON.stringify({ v: 1, k: 'peers', peers: [otro] }) });
  await new Promise(r => setTimeout(r, 20));
  pc.onicecandidate({ candidate: { type: null, candidate: '', toJSON: () => ({ candidate: '', sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'abc' }) } });
  const real = 'candidate:0 1 UDP 2122252543 192.168.1.2 62740 typ host';
  pc.onicecandidate({ candidate: { type: 'host', candidate: real, toJSON: () => ({ candidate: real, sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'abc' }) } });
  assert.deepEqual(enviados.map(m => m.k), ['offer', 'ice']);
  for (const m of enviados) assert.ok(validSignal(m), m.k + ' must pass the relay filter');
});
