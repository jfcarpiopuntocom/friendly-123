'use strict';
// Guard of guards. Required P0 must not become a "green" that skipped the
// historic Commissions, local sale, failure, or revision-protection contracts.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {MANDATORY,selectP0Tests}=require('../scripts/p0-hotfix-tests.cjs');
const REQUIRED=[
 'test/p0-commission-month-guard.test.cjs',
 'test/p0-commissions-historical-own-month-summary.test.cjs',
 'test/commissions-period.test.js',
 'test/p0-v681-commissions-autoperiod.test.cjs',
 'test/p0-v683-commissions-month-race.test.cjs',
 'test/p0-failed-sale-must-not-mirror-stale.test.cjs',
 'test/p0-idb-closed-handle-reopen-sale.test.cjs',
 'test/p0-single-device-sale-browser-ack.test.cjs'
];
test('P0 required selector always includes money, historical month, and single-device sale guards',()=>{
 const selected=selectP0Tests(['docs/mock-backend.js']);
 for(const filename of REQUIRED){
   assert.ok(fs.existsSync(path.join(__dirname,'..',filename)),filename+' exists');
   assert.ok(MANDATORY.includes(filename),filename+' must stay mandatory, not touched-area advisory');
   assert.ok(selected.includes(filename),filename+' must execute on any backend change');
 }
 assert.equal(new Set(MANDATORY).size,MANDATORY.length,'no duplicate mandatory files');
});
test('P0 hotfix required check invokes exact selector and executes ALL selected test files',()=>{
 const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/p0-hotfix-gate.yml'),'utf8');
 assert.match(workflow,/pull_request:\s*\{\}/,'PR trigger must remain');
 assert.match(workflow,/name:\s*P0 Hotfix Gate/,'required check identity must remain');
 assert.match(workflow,/node scripts\/p0-hotfix-tests\.cjs/,'no manual test selection or caps');
 assert.match(workflow,/--test-concurrency=2.*"\$\{TESTS\[@\]\}"/,'execute all selected test files');
});
