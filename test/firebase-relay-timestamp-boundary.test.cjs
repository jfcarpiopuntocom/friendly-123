// v668: Firebase REST can assign the same millisecond to multiple encrypted ops.
// The durable cursor is a NUMBER: never confirm a timestamp before every sibling
// (including image fragments) has crossed. Pure synthetic data, zero production I/O.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function relayFixture(groups) {
  const rows = {};
  groups.forEach(([key, s, bytes]) => { rows[key] = {
    s, c: typeof bytes === 'string' && bytes.startsWith('raw:') ?
      bytes.slice(4) : Buffer.from(bytes).toString('base64')
  }; });
  let equalityReads = 0, pageReads = 0;
  const fetchFn = async url => {
    const parsed = new URL(url);
    let data = null;
    if (parsed.pathname.endsWith('/o.json')) {
      let entries = Object.entries(rows).sort(([ak, a], [bk, b]) => a.s - b.s || ak.localeCompare(bk));
      if (parsed.searchParams.has('startAt')) entries = entries.filter(([, v]) => v.s >= Number(parsed.searchParams.get('startAt')));
      if (parsed.searchParams.has('equalTo')) {
        equalityReads++;
        entries = entries.filter(([, v]) => v.s === Number(parsed.searchParams.get('equalTo')));
      }
      if (parsed.searchParams.has('limitToFirst')) {
        pageReads++;
        entries = entries.slice(0, Number(parsed.searchParams.get('limitToFirst')));
      }
      // Firebase sends JSON objects in undefined property order, even for an ordered query.
      data = Object.fromEntries(entries.reverse());
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(data) };
  };
  const w = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../docs/firebase-relay.js'), 'utf8'), {
    window: w, TextEncoder, Uint8Array, ArrayBuffer, Promise, Date, Object, JSON, Math,
    atob, btoa, Blob, DOMException, EventSource: null, fetch: fetchFn
  }, { filename: 'firebase-relay.js' });
  const relay = w.F123FirebaseRelay.create({ db: 'https://synthetic.invalid', fetch: fetchFn, EventSource: null });
  const socket = relay.connect('wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/' + 'a'.repeat(40));
  const delivered = [], pages = [];
  socket.addEventListener('message', e => {
    if (typeof e.data === 'string') {
      const parsed = JSON.parse(e.data);
      if (parsed.k === 'pull-page') pages.push(parsed);
    } else if (e.data instanceof ArrayBuffer || Object.prototype.toString.call(e.data) === '[object ArrayBuffer]') {
      delivered.push(Buffer.from(e.data).toString('utf8'));
    }
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve);
    socket.addEventListener('error', () => reject(new Error('Synthetic relay failed to open')));
  });
  return {
    socket, delivered, pages, getReads: () => ({ equalityReads, pageReads }),
    async pullAll(limit = 6) {
      let seq = 0, rev = 0;
      for (let n = 0; n < 100; n++) {
        const before = pages.length;
        socket.send(JSON.stringify({ k: 'pull', v: 2, rev, seq, limit }));
        await socket._reads;
        assert.equal(pages.length, before + 1, 'one acknowledgement per pull');
        const p = pages.at(-1);
        assert.ok(p.seq >= seq, 'cursor never decreases');
        seq = p.seq; rev = p.rev;
        if (!p.more) return seq;
      }
      assert.fail('unbounded pagination loop');
    }
  };
}
const record = (i, len = 12) => String(i).padStart(6, '0') + '.'.repeat(Math.max(0, len - 6));

test('full timestamp ties beyond limit: every encrypted frame, no skip', async () => {
  const data = [
    ['k000', 4000, record(0)],
    ['k001', 4000, record(1)],
    ...Array.from({ length: 140 }, (_, i) => ['k' + String(i + 2).padStart(3, '0'), 4001, record(i + 2)])
  ];
  const w = await relayFixture(data);
  assert.equal(await w.pullAll(6), 4001);
  assert.equal(w.delivered.length, data.length);
  assert.deepEqual(new Set(w.delivered), new Set(data.map(r => r[2])));
  assert.ok(w.getReads().equalityReads >= 1);
});
test('one timestamp exceeds 1MiB: repeated pages keep cursor behind until final fragment', async () => {
  const data = Array.from({ length: 10 }, (_, i) =>
    ['z' + String(i).padStart(3, '0'), 9000, record(i, 170000)]);
  const w = await relayFixture(data);
  assert.equal(await w.pullAll(4), 9000);
  assert.equal(w.delivered.length, data.length, 'all chunks delivered once');
  assert.ok(w.pages.length >= 3, 'oversized equal-time group must stage');
  assert.ok(w.pages.some(p => p.seq === 0 && p.more), 'partial timestamp is not durable progress');
  assert.equal(w.pages.at(-1).more, false);
});
test('budget boundary inside same timestamp must not cut off siblings', async () => {
  const data = [
    ['a', 100, record(1, 300000)],
    ['b', 100, record(2, 300000)],
    ['c', 100, record(3, 300000)],
    ['d', 100, record(4, 300000)],
    ['e', 101, record(5)]
  ];
  const w = await relayFixture(data);
  assert.equal(await w.pullAll(20), 101);
  assert.equal(w.delivered.length, data.length);
  assert.equal(new Set(w.delivered).size, data.length);
});

test('bad base64 never acknowledges or marks timestamp as durably replayed',async()=>{
  const w=await relayFixture([['valid',100,'hello'],['invalid',100,'raw:not-base64@@']]);
  w.socket.send(JSON.stringify({k:'pull',v:2,rev:0,seq:0,limit:12}));
  await w.socket._reads;
  assert.equal(w.pages.length,0,'corrupt ciphertext must not advance pull cursor');
  assert.equal(w.delivered.length,0,'validate all peers before emitting partial timestamp');
  assert.equal(w.socket.readyState,3,'close to trigger another transport/recovery');
});
test('timestamp group above fixed item cap must fail closed without partial ACK',async()=>{
  const rows=Array.from({length:257},(_,i)=>['x'+String(i).padStart(4,'0'),777,'item-'+i]);
  const w=await relayFixture(rows);
  w.socket.send(JSON.stringify({k:'pull',v:2,rev:0,seq:0,limit:12}));
  await w.socket._reads;
  assert.equal(w.pages.length,0);
  assert.equal(w.socket.readyState,3);
});
test('group above bounded JSON byte limit must not download unbounded or claim recovery',async()=>{
  const rows=Array.from({length:64},(_,i)=>['b'+String(i).padStart(3,'0'),888,'x'.repeat(65000)]);
  const w=await relayFixture(rows);
  w.socket.send(JSON.stringify({k:'pull',v:2,rev:0,seq:0,limit:12}));
  await w.socket._reads;
  assert.equal(w.pages.length,0);
  assert.equal(w.socket.readyState,3);
});
