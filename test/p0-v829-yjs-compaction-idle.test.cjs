'use strict';
// P0 v830 RED-first (JFC 20 nov 2026): manual quantity box froze 5-46 s because y-indexeddb rewrote the WHOLE
// Yjs document (16 MB on a real store) 1 s after each burst once >500 updates existed, and later tiny writes queued behind it.
// GREEN: each action writes only its incremental update; the full rewrite waits for 45 s of quiet. Synthetic store only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { startServer, openDevice, chromium } = require('./helpers/e2e-app.cjs');

test('v829 source: all three Yjs IndexedDB stores defer full compaction to 45 s of quiet', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'docs', 'sync-yjs.js'), 'utf8');
  assert.match(src, /var COMPACTAR_EN_REPOSO_MS = 45000;/);
  for (const name of ['"f123-yjs-" + API.roomId, API.doc', '"f123-yjs-fotos-" + API.roomId, API.fotosDoc', '"f123-yjs-ops-" + API.roomId, API.opsDoc'])
    assert(src.includes('compactarEnReposo(new window.IndexeddbPersistence(' + name + '))'), 'missing idle compaction for ' + name);
});

test('v829 real browser: live y-indexeddb persistences use the 45 s quiet window and still store every incremental update', { timeout: 90000 }, async () => {
  const { srv, base } = await startServer();
  let web;
  try {
    web = await chromium.launch();
    const { page, ctx } = await openDevice(web, base, { license: 'F123-SYNTHETIC-V829-COMPACTION' });
    await page.waitForFunction(() => window.OCYjs && window.OCYjs.idb && window.OCYjs.opsIdb, null, { timeout: 30000 });
    const facts = await page.evaluate(async () => {
      const Y = window.Y, p = window.OCYjs.idb, doc = p.doc;
      const db = p.db; const cnt = () => new Promise(ok => { const q = db.transaction('updates').objectStore('updates').count(); q.onsuccess = () => ok(q.result); });
      const before = await cnt();
      for (let i = 0; i < 5; i++) doc.getMap('v829probe').set('k' + i, i);
      await new Promise(r => setTimeout(r, 400));
      const after = await cnt();
      return { main: p._storeTimeout, ops: window.OCYjs.opsIdb._storeTimeout, fotos: window.OCYjs.fotosIdb ? window.OCYjs.fotosIdb._storeTimeout : 45000, before, after };
    });
    assert.equal(facts.main, 45000); assert.equal(facts.ops, 45000); assert.equal(facts.fotos, 45000);
    assert.ok(facts.after >= facts.before + 5, 'each change still persisted as its own incremental update: ' + JSON.stringify(facts));
    await ctx.close();
  } finally { if (web) await web.close(); await new Promise(resolve => srv.close(resolve)); }
});
