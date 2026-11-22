'use strict';
// C205 adversarial invariant: browser-local cooldown is not a distributed repair lease.
// Run: node --test test/c205-repair-multidevice-guard.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8');
const start = source.indexOf('function repararHuecosServidor(full)');
const end = source.indexOf('function hacerCkpt()', start);
const repair = start < 0 || end < 0 ? '' : source.slice(start, end);

test('C205 repair is not enabled without a room-scoped distributed lease or equivalent dedup', () => {
  // A localStorage timestamp only coordinates one browser profile.
  // Two complete devices with distinct storage can independently publish 12 MiB.
  assert.ok(repair, 'repair implementation must be present');
  const hasDistributedCoordination = /(?:acquireRepairLease|claimRepairLease|dedupRepairState|repairLeaseRpc|repairStateVectorClaim)\s*\(/.test(repair);
  assert.ok(hasDistributedCoordination,
    'repair must obtain a server-coordinated per-room/layer claim before publishing; localStorage is insufficient');
});

test('C205 repair must not start a seven-day cooldown before durable ACK', () => {
  assert.ok(repair, 'repair implementation must be present');
  assert.doesNotMatch(repair, /previo\[capa\]\s*=\s*Date\.now\(\)/,
    'cooldown is earned by full durable ACK, not by enqueue');
});

test('C205 repairs cannot broadcast their full-state payload through live peer channels', () => {
  assert.match(source, /!soloServidor\s*&&\s*enviarDirecto\(buf\)/,
    'server repair must not flood peer channels');
});
