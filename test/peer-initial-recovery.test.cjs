'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../docs/peer-sync.js'), 'utf8');

function fixture() {
  const window = new EventTarget(), document = new EventTarget(); document.hidden = false;
  const sockets = [], pcs = [], timers = []; let now = 1000;
  class WS {
    constructor() { this.readyState = 0; sockets.push(this); }
    close(code) {
      if (code !== undefined && code !== 1000 && (!Number.isInteger(code) || code < 3000 || code > 4999))
        throw new DOMException('Invalid WebSocket close code', 'InvalidAccessError');
      this.readyState = 3; this.onclose?.();
    }
    send() {}
    open() { this.readyState = 1; this.onopen?.(); }
  }
  class RTC {
    constructor() { this.connectionState = 'new'; this.signalingState = 'stable'; pcs.push(this); }
    close() { this.connectionState = 'closed'; }
    createDataChannel() { return this.dc = { label: 'friendly-direct-v1', readyState: 'connecting', close() {} }; }
    async createOffer() { return { type: 'offer', sdp: 'synthetic metadata' }; }
    async setLocalDescription(value) { this.localDescription = { toJSON: () => value }; this.signalingState = 'have-local-offer'; }
    fail() { this.connectionState = 'failed'; this.onconnectionstatechange(); }
  }
  Object.assign(window, { WebSocket: WS, RTCPeerConnection: RTC, crypto: require('node:crypto').webcrypto });
  vm.runInNewContext(source, {
    window, document, EventTarget, Event, MessageEvent, DOMException, Blob, ArrayBuffer, Uint8Array,
    Map, Set, Promise, queueMicrotask, TextEncoder, Date: class extends Date { static now() { return now; } },
    setTimeout(fn, ms) { const timer = { fn, ms, cancelled: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.cancelled = true; },
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    atob: value => Buffer.from(value, 'base64').toString('binary')
  });
  const factory = window.F123Peer.create();
  const socket = factory.connect('wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/' + 'a'.repeat(40));
  socket.hub.id = '0'.repeat(32);
  return {
    window, socket, sockets, pcs,
    async negotiate(id = 'b'.repeat(32)) {
      sockets.at(-1).open();
      await socket.hub.receiveSignal({ v: 1, k: 'peers', peers: [id] });
      return pcs.at(-1);
    },
    retry() { const timer = timers.find(timer => !timer.cancelled); assert.ok(timer, 'a bounded retry is scheduled'); timer.cancelled = true; timer.fn(); },
    pending: () => timers.filter(timer => !timer.cancelled),
    advance(ms) { now += ms; },
    close() { factory.closeAll(); window.F123Relay.closeAll(); }
  };
}

test('initial RTC failure retries metadata negotiation with a finite budget and resumes on online', async () => {
  const f = fixture();
  try {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const pc = await f.negotiate();
      f.advance(31000); // A healthy metadata socket alone does not prove healthy RTC.
      pc.fail();
      assert.equal(f.socket.readyState, 0, 'the initial business channel remains unconfirmed');
      assert.equal(f.sockets.at(-1).readyState, attempt < 5 ? 3 : 1, 'after budget exhaustion the final metadata-only socket stays subscribed');
      assert.equal(f.pcs.length, attempt);
      if (attempt < 5) { assert.equal(f.pending().length, 1); f.retry(); }
    }
    assert.equal(f.sockets.length, 5, 'failed negotiations cannot reconnect forever');
    assert.equal(f.pending().length, 0, 'budget exhaustion stops retries');
    // A new phone arrives later. Metadata-only presence must wake an exhausted PC.
    await f.socket.hub.receiveSignal({ v: 1, k: 'peers', peers: ['c'.repeat(32)] });
    assert.equal(f.pcs.length, 6, 'late-joining phone triggers RTC without requiring PC reload');
    const late = f.pcs.at(-1); late.dc.readyState = 'open'; late.dc.onopen();
    assert.equal(f.socket.readyState, 1, 'late join restored the data channel');
    assert.equal(f.socket.hub.attempts, 0, 'successful late-join renews retry budget');
    f.window.dispatchEvent(new Event('online'));
    assert.equal(f.pcs.length, 6, 'an online event does not multiply a healthy RTC');
    assert.equal(f.socket.readyState, 1);
    assert.equal(f.socket.hub.attempts, 0, 'an actual healthy peer renews the budget');
  } finally { f.close(); }
});

test('one failed newcomer does not interrupt an established direct peer', async () => {
  const f = fixture();
  try {
    const healthy = await f.negotiate();
    healthy.dc.readyState = 'open'; healthy.dc.onopen();
    await f.socket.hub.receiveSignal({ v: 1, k: 'peers', peers: ['b'.repeat(32), 'c'.repeat(32)] });
    f.pcs.at(-1).fail();
    assert.equal(f.socket.readyState, 1);
    assert.equal(f.sockets.length, 1);
    assert.equal(f.sockets[0].readyState, 1);
    assert.equal(f.socket.hub.connected().length, 1);
    assert.equal(f.pending().length, 0);
  } finally { f.close(); }
});
