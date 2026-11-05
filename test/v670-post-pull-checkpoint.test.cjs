'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const a = src.indexOf('    function checkpointTrasPull(');
const b = src.indexOf('    function procesarHead(', a);
assert.ok(a > 0 && b > a, 'post-pull checkpoint hook present');
test('v670: delayed catalog pull republish waits for full, durable Yjs recovery', () => {
  const timers = [], clears = [];
  let emitted = 0, debt = false;
  const socket = { readyState: 1 };
  const ctx = { permiteCkpt: true, _soloMemoria: false,
    canal: {ws: socket, recuperando: true}, _tCkpt: 9,
    deudaPendiente: () => debt,
    clearTimeout: n => clears.push(n),
    setTimeout: (fn,ms) => { timers.push({fn,ms}); return timers.length; },
    hacerCkpt: () => emitted++ };
  vm.createContext(ctx);vm.runInContext(src.slice(a,b),ctx);
  ctx.checkpointTrasPull(socket);
  assert.equal(timers.length,0,'no snapshot while encrypted pull is pending');
  ctx.canal.recuperando = false; debt = true;
  ctx.checkpointTrasPull(socket);
  assert.equal(timers.length,0,'missing Yjs causal dependencies prevent snapshot');
  debt = false; ctx.checkpointTrasPull(socket);
  assert.equal(timers.length,1,'the verified final pull schedules one new snapshot attempt');
  assert.deepEqual(clears,[9]);assert.equal(timers[0].ms,250);
  timers[0].fn();assert.equal(emitted,1);
  ctx.canal.ws = {readyState:1};ctx.checkpointTrasPull(socket);
  assert.equal(timers.length,1,'stale socket cannot publish another layer');
  ctx.canal.ws = socket;ctx.permiteCkpt = false;ctx.checkpointTrasPull(socket);
  assert.equal(timers.length,1,'photo rooms never get an oversized full checkpoint');
  ctx.permiteCkpt = true;ctx._soloMemoria = true;ctx.checkpointTrasPull(socket);
  assert.equal(timers.length,1,'RAM-only Yjs is not proof of a durable checkpoint');
});
test('v670: both modern HEAD and legacy final page trigger the proven post-pull checkpoint', () => {
  assert.match(src,/if \(estado\.pullAplicado && !canal\.recuperando\) checkpointTrasPull\(sock\)/);
  assert.match(src,/checkpointTrasPull\(ws\);/);
});
