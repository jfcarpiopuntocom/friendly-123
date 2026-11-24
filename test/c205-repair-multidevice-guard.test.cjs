'use strict';
// C205 adversarial checks. This test applies when C205 is present (PR #1050),
// and stays green on master before that feature is integrated.
// Run: node --test test/c205-repair-multidevice-guard.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../docs/sync-yjs.js'), 'utf8');
const start = source.indexOf('function repararHuecosServidor(full)');
const end = start < 0 ? -1 : source.indexOf('function hacerCkpt()', start);
const repair = end < 0 ? '' : source.slice(start, end);
const hasC205 = Boolean(repair);

test('C205: two isolated browsers do not share a localStorage cooldown', () => {
  const storageA = new Map(), storageB = new Map();
  const key = 'f123_huecos_v1:room-y';
  storageA.set(key, JSON.stringify({local: Date.now()}));
  assert.equal(storageB.get(key), undefined,
    'per-browser cooldown cannot prevent a second device publishing the same full state');
});

test('C205: full-state repair requires a distributed per-room/layer claim before publishing', {skip: !hasC205}, () => {
  // A lexical guard is only a tripwire; passing it is not proof of a working
  // distributed lease. Integration tests must exercise two real clients.
  // Accept multiple naming conventions, but require explicit server claim wiring.
  const hasClaim = /(?:acquireRepairLease|claimRepairLease|dedupRepairState|repairLeaseRpc|repairStateVectorClaim)\s*\(/.test(repair);
  assert.ok(hasClaim,
    'C205 currently relies on localStorage; implement and test server-coordinated claim before upload');
});

test('C205: cooldown starts only after durable ACK', {skip: !hasC205}, () => {
  assert.doesNotMatch(repair, /previo\[capa\]\s*=\s*Date\.now\(\)/,
    'enqueue must not start seven-day cooldown');
});

test('C205: repair payload is excluded from live peer broadcast', {skip: !hasC205}, () => {
  assert.match(source, /!soloServidor\s*&&\s*enviarDirecto\(buf\)/);
});
