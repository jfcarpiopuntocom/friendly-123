const { test, before } = require('node:test');
const assert = require('node:assert/strict');
let createRelayTransport; before(async () => { ({ createRelayTransport } = await import('../supabase-relay/transport.mjs')); });

test('durable acknowledgement follows commit, preserving the existing wire shape', async () => {
  let commit;
  const db = fixture((action) => action === 'op' ? new Promise(r => { commit = r; }) : { frames: [], v: 2, rev: 0, seq: 0, n: 0, more: false });
  const relay = createRelayTransport({ client: db.client });
  const socket = relay.connect('synthetic-room');
  await opened(socket);
  const frames = [];
  socket.onmessage = e => frames.push(e.data);
  socket.send(JSON.stringify({ k: 'op', ack: 1, id: 'sale-1', lam: 1, c: 'AQID' }));
  await tick();
  assert.deepEqual(frames, []);
  commit({ ok: true, duplicate: false });
  await tick();
  assert.deepEqual(JSON.parse(frames[0]), { k: 'persist-result', kind: 'op', id: 'sale-1', ok: true, conflict: false });
  await relay.dispose();
});

test('failed storage never acknowledges a queued sale as saved', async () => {
  const db = fixture(() => { throw Error('storage offline'); });
  const relay = createRelayTransport({ client: db.client });
  const socket = relay.connect('synthetic-room');
  await opened(socket);
  const reply = message(socket);
  socket.send(JSON.stringify({ k: 'op', ack: 1, id: 'sale-2', lam: 1, c: 'AQID' }));
  assert.equal(JSON.parse((await reply).data).ok, false);
  await relay.dispose();
});

test('paginated replay emits every binary before its cursor marker', async () => {
  const db = fixture(() => ({ frames: ['AQID', 'BAUG'], v: 2, rev: 4, seq: 28, n: 2, more: true }));
  const relay = createRelayTransport({ client: db.client });
  const socket = relay.connect('synthetic-room');
  await opened(socket);
  const frames = [];
  socket.onmessage = e => frames.push(e.data);
  socket.send(JSON.stringify({ k: 'pull', v: 2, rev: 3, seq: 99 }));
  await tick();
  assert.deepEqual([...new Uint8Array(frames[0])], [1, 2, 3]);
  assert.deepEqual([...new Uint8Array(frames[1])], [4, 5, 6]);
  assert.deepEqual(JSON.parse(frames[2]), { k: 'pull-page', v: 2, rev: 4, seq: 28, n: 2, more: true });
  await relay.dispose();
});

test('room channels share the injected connection and never receive another room', async () => {
  const db = fixture(() => ({}));
  const relay = createRelayTransport({ client: db.client });
  const a = relay.connect('synthetic-room-y'), b = relay.connect('synthetic-room-fotos');
  await Promise.all([opened(a), opened(b)]);
  const first = [], second = [];
  a.onmessage = e => first.push(e.data); b.onmessage = e => second.push(e.data);
  db.channels[0].receive('opaque-frame', new Uint8Array([8, 9]));
  assert.deepEqual([...new Uint8Array(first[0])], [8, 9]);
  assert.deepEqual(second, []);
  a.send(new Uint8Array([10, 11]));
  await tick();
  assert.ok(db.channels[0].sent[0].payload instanceof ArrayBuffer, 'Realtime binary serializer requires ArrayBuffer, not a typed-array JSON object');
  assert.deepEqual([...new Uint8Array(db.channels[0].sent[0].payload)], [10, 11]);
  await relay.dispose();
});

test('unregistered rooms fail closed without joining Realtime', async () => {
  const db = fixture(() => ({}), false);
  const relay = createRelayTransport({ client: db.client });
  const socket = relay.connect('synthetic-unknown');
  const close = await closed(socket);
  assert.equal(close.code, 1008);
  assert.equal(db.channels.length, 0);
  await relay.dispose();
});

test('oversized UTF-8 and queued frames close without durable calls', async () => {
  const db = fixture(() => ({}));
  const relay = createRelayTransport({ client: db.client });
  const socket = relay.connect('synthetic-room');
  await opened(socket);
  const close = closed(socket);
  socket.send('é'.repeat(140000));
  assert.equal((await close).code, 1009);
  assert.equal(db.commands.length, 0);
  await relay.dispose();
});

test('a channel failure reaches existing reconnect handlers and removes only that channel', async () => {
  const db = fixture(() => ({}));
  const relay = createRelayTransport({ client: db.client });
  const a = relay.connect('synthetic-a'), b = relay.connect('synthetic-b');
  await Promise.all([opened(a), opened(b)]);
  const close = closed(a);
  db.channels[0].status('CHANNEL_ERROR');
  assert.equal((await close).code, 1011);
  assert.equal(b.readyState, 1);
  await relay.dispose();
});

// Helpers: protocol-level stand-ins; hosted acceptance uses the actual SDK.
function fixture(command, authorized = true) {
  const channels = [], commands = [];
  const client = {
    async rpc(name, p) {
      if (name === 'f123_relay_has_topic') return { data: authorized, error: null };
      commands.push(p);
      try { return { data: await command(p.p_action, p.p_message), error: null }; }
      catch (error) { return { data: null, error }; }
    },
    channel(topic) {
      const handlers = [];
      const c = {
        topic, sent: [], on(type, filter, handler) { handlers.push({ type, filter, handler }); return c; },
        subscribe(handler) { c.status = handler; queueMicrotask(() => handler('SUBSCRIBED')); return c; },
        async track() { return 'ok'; }, presenceState() { return {}; },
        async send(data) { c.sent.push(data); return 'ok'; },
        receive(event, payload) { for (const h of handlers) if (h.type === 'broadcast' && h.filter.event === event) h.handler({ payload }); }
      };
      channels.push(c); return c;
    },
    async removeChannel() {}, realtime: { disconnect() {} }
  };
  return { client, channels, commands };
}
function opened(s) { return new Promise((resolve, reject) => { s.onopen = resolve; s.onclose = () => reject(Error('closed before opening')); }); }
function closed(s) { return new Promise(resolve => { s.onclose = resolve; }); }
function message(s) { return new Promise(resolve => { s.onmessage = resolve; }); }
function tick() { return new Promise(r => setTimeout(r, 0)); }

test('slow replay cannot delay live bytes while durable commands retain order', async () => {
  let finishPull;
  const db = fixture(action => action === 'pull' ? new Promise(resolve => { finishPull = resolve; }) : { ok: true });
  const relay = createRelayTransport({ client: db.client }), socket = relay.connect('synthetic-room');
  await opened(socket);
  const received = [];
  socket.onmessage = event => received.push(event.data);
  socket.send(JSON.stringify({ k: 'pull', v: 2, seq: 0 }));
  socket.send(JSON.stringify({ k: 'op', ack: 1, id: 'pending-1', c: 'AQI=' }));
  const live = new Uint8Array([7, 8]);
  socket.send(live); live[0] = 99;
  socket.send(new Blob([new Uint8Array([9, 10])]));
  await tick();
  try {
    assert.deepEqual(db.commands.map(x => x.p_action), ['pull'], 'durable write still waits for replay');
    assert.deepEqual(db.channels[0].sent.map(x => [...new Uint8Array(x.payload)]), [[7, 8], [9, 10]], 'live frames leave in order with copied bytes');
    assert.deepEqual(received, [], 'broadcast is never a durable acknowledgement');
  } finally {
    finishPull({ frames: ['AQI='], rev: 0, seq: 1, n: 1, more: false });
    await socket.settled();
    await relay.dispose();
  }
  assert.deepEqual(db.commands.map(x => x.p_action), ['pull', 'op']);
  assert.equal(JSON.parse(received[1]).k, 'pull-page');
  assert.equal(JSON.parse(received[2]).k, 'persist-result');
  assert.equal(socket.bufferedAmount, 0);
});

test('live and durable lanes share the buffer limit and closing drops unsent frames', async () => {
  let finishPull;
  const db = fixture(() => new Promise(resolve => { finishPull = resolve; }));
  const relay = createRelayTransport({ client: db.client }), socket = relay.connect('synthetic-room');
  await opened(socket);
  socket.send(JSON.stringify({ k: 'pull', v: 2 }));
  await tick();
  const frame = new Uint8Array(256 * 1024);
  assert.throws(() => { for (let i = 0; i < 17; i++) socket.send(frame); }, /buffer full/);
  assert.equal(socket.readyState, 3);
  finishPull({ frames: [], rev: 0, seq: 0, n: 0, more: false });
  await socket.settled();
  assert.equal(db.channels[0].sent.length, 0);
  assert.equal(socket.bufferedAmount, 0);
  await relay.dispose();
});

for (const binaryType of ['arraybuffer','blob']) {
 test('local replay metadata distinguishes live bytes during an in-flight pull: '+binaryType,async()=>{
  let finish;const db=fixture(()=>new Promise(resolve=>{finish=resolve}));
  const relay=createRelayTransport({client:db.client}),socket=relay.connect('synthetic-room');
  await opened(socket);socket.binaryType=binaryType;const received=[];socket.onmessage=e=>received.push(e);
  socket.send(JSON.stringify({k:'pull',v:2,rev:0,seq:0}));await tick();
  db.channels[0].receive('opaque-frame',new Uint8Array([1,2]));
  finish({frames:['AwQ='],rev:0,seq:1,n:1,more:false});await tick();
  assert.deepEqual(received.slice(0,2).map(e=>e.relaySource),['live','pull']);
  assert.deepEqual([...new Uint8Array(binaryType==='blob'?await received[1].data.arrayBuffer():received[1].data)],[3,4]);
  assert.equal(JSON.parse(received[2].data).k,'pull-page');await relay.dispose();
 });
}
