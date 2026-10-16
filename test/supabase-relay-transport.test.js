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
