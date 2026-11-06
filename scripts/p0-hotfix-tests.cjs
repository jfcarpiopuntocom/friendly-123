#!/usr/bin/env node
'use strict';
// Required P0 gate: a fixed safety core PLUS every touched-area regression.
// Never sample, cap, or silently skip a matching test. The 2,400+ test full
// release-control suite still runs independently as an advisory PR signal.
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {selectTests}=require('./pruebas-del-area.cjs');
const MANDATORY=[
  'test/venta-durable-deficit.test.js', // strict sale ACK + rollback + physical deficit
  'test/realtime-sale-ack-barrier.test.cjs', // no broadcast before durable ACK
  'test/commission-partial-balance.test.js', // finance and payout CAS
  'test/p0-durable-stock-adjustment.test.cjs', // inventory delta and persistence
  'test/pin-owner-integrity.test.js', // authorized identity
  'test/sala-sigue-licencia.test.js', // same license -> same notebook
  'test/sync3-head-causal-gap.test.cjs', // causal sync without losing facts
  'test/p0-peeronly-large-no-duplicate.test.cjs', // dedup/large frame
  'test/p0-sales-atomic-idb-webkit-browser.test.cjs', // real browser transaction CAS
  'test/p0-v680-quota-recovery.test.cjs', // confirmed sale quota rescue
  'test/entry-assets.test.cjs', // exact generated JS and CSS
  'test/manifest-css-canonical.test.cjs' // exact deployed bytes
];
function selectP0Tests(changed,root=process.cwd()){
  const tests=new Set([...MANDATORY,...selectTests(changed,root)]);
  const missing=[...tests].filter(f=>!fs.existsSync(path.join(root,f)));
  if(missing.length) throw Error('Missing P0 or touched-area tests: '+missing.join(', '));
  return [...tests].sort();
}
if(require.main===module){
  const [base,head]=process.argv.slice(2);
  if(!base||!head)throw Error('Usage: p0-hotfix-tests.cjs BASE_SHA HEAD_SHA');
  const changed=execFileSync('git',['diff','--name-only',base,head],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
  const tests=selectP0Tests(changed);
  if(!tests.length)throw Error('Refusing empty P0 gate');
  process.stdout.write(tests.join('\n')+'\n');
}
module.exports={MANDATORY,selectP0Tests};
