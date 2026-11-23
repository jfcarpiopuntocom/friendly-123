'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('C242: circuit breaker runs after aislamiento.js and exempts intentional SW reloads', () => {
  const html = fs.readFileSync('docs/index.html', 'utf8');
  const aisl = html.indexOf('<script src="./aislamiento.js"></script>');
  const brk = html.indexOf('f123_boot_crash_v1');
  assert.ok(aisl > 0 && brk > aisl, 'breaker must run after aislamiento.js so f123:: sessionStorage matches');
  assert.match(html, /f123_sw_reload_ts/);
  assert.doesNotMatch(html, /__f123SafeBootMode/);
  assert.doesNotMatch(html, /indexedDB\.deleteDatabase|localStorage\.clear\(/);
});

test('C242: app-inline-03 stamps f123_sw_reload_ts and reenganchar clears both f123:: and raw latches', () => {
  const s = fs.readFileSync('src/app/app-inline-03.js', 'utf8');
  assert.match(s, /f123_sw_reload_ts/);
  const r = fs.readFileSync('docs/reenganchar.html', 'utf8');
  assert.ok(r.includes('sessionStorage.removeItem("f123::"+k)'));
  assert.doesNotMatch(r, /indexedDB\.deleteDatabase|localStorage\.clear|localStorage\.removeItem/);
});

test('C242: estado-idb has WebKit open hang timeout and C199/sync-yjs preserve normal cadence', () => {
  const e = fs.readFileSync('docs/estado-idb.js', 'utf8');
  assert.match(e, /IndexedDB state open timed out/);
  const b = fs.readFileSync('docs/backup-scheduler.js', 'utf8');
  assert.ok(b.includes('soloAncla ? 5_000 : 60_000'));
  const y = fs.readFileSync('docs/sync-yjs.js', 'utf8');
  assert.ok(y.includes('setTimeout(hacerCkpt, 2500)'));
});
