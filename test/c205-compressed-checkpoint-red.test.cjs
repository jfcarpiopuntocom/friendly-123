'use strict';
// C205 regression / deliberately RED on master and on PR #1050.
// Live log evidence in docs/sync-yjs.js: full catalog 1,069,757 B,
// gzip 123,524 B. Such a checkpoint fits the Firebase limit, so repair
// must NOT depend solely on "snapshot-over-limit".
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');

test('C205 RED: a compressed checkpoint that fits must not bypass repair of a known causal gap',()=>{
  const start=src.indexOf('function hacerCkpt()');
  const end=src.indexOf('function conectar()',start);
  assert.ok(start>=0 && end>start,'inspect authentic checkpoint source');
  const checkpoint=src.slice(start,end);
  const over=checkpoint.indexOf('diagnosticarCkpt("snapshot-over-limit"');
  assert.ok(over>=0,'oversized checkpoint branch exists');
  const repairCalls=[...checkpoint.matchAll(/\brepararHuecosServidor\s*\(/g)].map(m=>m.index);
  assert.ok(repairCalls.length>0,'a complete device must have a history-repair trigger');
  // The candidate #1050 invokes repair only from the oversize branch.
  // A real catalog compressed to 123,524 bytes never enters that branch.
  // Require at least one separate trigger, with a genuine gap-detection
  // precondition, whose invocation is not controlled by checkpoint size.
  const guardStart=checkpoint.lastIndexOf('if (ckptCipherLimit ?',over);
  const guardEnd=checkpoint.indexOf('\n          }',over);
  assert.ok(guardStart>=0 && guardEnd>over,'locate oversized checkpoint guard');
  assert.ok(repairCalls.some(i=>i<guardStart || i>guardEnd),
    'repair must also be reachable if gzip checkpoint fits; #1050 is dormant for the measured catalog');
});

test('C205 fixture: measured gzip checkpoint is below the legacy 256 KiB RPC envelope',()=>{
  const measuredCompressedBytes=123524;
  const legacyRpcBytes=256*1024;
  assert.ok(measuredCompressedBytes*4/3+256<legacyRpcBytes,
    'measured compressed checkpoint fits even with base64 + RPC overhead');
});
