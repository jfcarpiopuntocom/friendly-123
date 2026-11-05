'use strict';
// v665: a pull page that the tie trim shortens must still say more=true, or the reader stops with ops unread.
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const SRC = fs.readFileSync(path.join(__dirname, '../docs/firebase-relay.js'), 'utf8');
test('v665: tie trim on a full page keeps more=true', async () => {
  const stamps = [1, 2, 3, 3, 4, 5], ops = {};
  stamps.forEach((s, i) => { ops['op' + i] = { s, c: Buffer.from('x' + i).toString('base64'), lam: 0 }; });
  const fetchFn = async (url) => {
    const u = new URL(url);
    let body = null;
    if (/\/k\.json/.test(u.pathname)) body = null;
    else if (/\/o\.json/.test(u.pathname)) {
      const start = Number(u.searchParams.get('startAt') || 0), lim = Number(u.searchParams.get('limitToFirst') || 1e9);
      const rows = Object.entries(ops).filter(([, v]) => v.s >= start).sort((a, b) => a[1].s - b[1].s).slice(0, lim);
      body = Object.fromEntries(rows);
    }
    const t = JSON.stringify(body);
    return { ok: true, status: 200, text: async () => t, headers: { get: () => null } };
  };
  const w = { TextEncoder, JSON, Promise, Number, String, Object, Math, EventTarget, Event, MessageEvent, DOMException, URLSearchParams, setTimeout, clearTimeout, btoa, atob, Blob, Uint8Array, ArrayBuffer };
  w.window = w; vm.runInNewContext(SRC, w);
  const R = w.F123FirebaseRelay.create({ fetch: fetchFn, EventSource: null });
  const ws = R.connect('wss://friendly123-sync-relay.jfcarpio.workers.dev/sala/' + 'a'.repeat(40) + '-fotos');
  const pages = [];
  ws.addEventListener('message', (e) => { if (typeof e.data === 'string') { const m = JSON.parse(e.data); if (m.k === 'pull-page') pages.push(m); } });
  await new Promise(r => setTimeout(r, 30));
  ws.send(JSON.stringify({ k: 'pull', v: 2, rev: 0, seq: 0, limit: 4 }));
  await new Promise(r => setTimeout(r, 60));
  assert.equal(pages.length, 1);
  assert.equal(pages[0].n, 2, 'ops with s=3 are held for the next page');
  assert.equal(pages[0].more, true);
  assert.equal(pages[0].seq, 2);
});
