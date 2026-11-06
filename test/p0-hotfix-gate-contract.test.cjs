'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const gate=read('.github/workflows/p0-hotfix-gate.yml');
const hotfix=read('.github/workflows/hotfix.yml');
const broad=read('.github/workflows/release-control.yml');
const live=read('.github/workflows/recorrido.yml');
const proof=require('../scripts/p0-hotfix-proof.cjs');
const {MANDATORY,selectP0Tests}=require('../scripts/p0-hotfix-tests.cjs');

test('P0 required gate runs on every PR and master without paths or skipped scenarios',()=>{
 assert.match(gate,/name: P0 Hotfix Gate/);
 assert.match(gate,/^  pull_request: \{\}/m);
 assert.match(gate,/^  merge_group: \{\}/m);
 assert.match(gate,/^  push:/m);
 assert.match(gate,/branches: \[master\]/);
 assert.doesNotMatch(gate,/paths(?:-ignore)?:/);
 assert.match(gate,/image: mcr\.microsoft\.com\/playwright:v1\.62\.1-noble/);
 assert.match(gate,/scripts\/release-control\.cjs validate/);
 assert.match(gate,/scripts\/build-app-entry\.cjs --check/);
 assert.match(gate,/scripts\/build-dashboard-entry\.cjs --check/);
 assert.match(gate,/scripts\/gen-manifest\.js/);
 assert.match(gate,/diff -u \/tmp\/p0-manifest-before\.json docs\/version-manifest\.json/);
 assert.match(gate,/scripts\/p0-hotfix-tests\.cjs/);
 assert.match(gate,/node --require \.\/test\/helpers\/sin-red-produccion\.cjs --test/);
 assert.match(broad,/name: Release continuity gate/);
 assert.match(broad,/pull_request: \{\}/);
 assert.match(broad,/Full regression suite including browser and financial contracts/);
 assert.match(broad,/^  verify:\n    name: Release continuity gate/m,'legacy required check must do strict P0 work');
 assert.match(broad,/^  full:\n    name: Full regression advisory/m,'full suite must remain in parallel');
 const quick=broad.slice(broad.indexOf('  verify:'),broad.indexOf('  full:'));
 const deep=broad.slice(broad.indexOf('  full:'));
 assert.match(quick,/p0-hotfix-tests\.cjs/,'required check uses P0 + touched tests');
 assert.match(quick,/build-app-entry\.cjs --check/,'required gate checks generated assets');
 assert.doesNotMatch(quick,/Full regression suite including browser and financial contracts/,'required gate is truly fast');
 assert.match(deep,/Full regression suite including browser and financial contracts/,'full suite not deleted');
});

test('safety core always includes critical sale durable ACK, finance, stock, PIN, Sync3, integrity and real browser',()=>{
 for(const part of ['venta-durable-deficit','realtime-sale-ack-barrier','commission-partial-balance','p0-durable-stock-adjustment','pin-owner-integrity','sync3-head-causal-gap','p0-sales-atomic-idb-webkit-browser','entry-assets','manifest-css-canonical'])
   assert.ok(MANDATORY.some(x=>x.includes(part)),part+' must never disappear');
 const names=selectP0Tests(['test/p0-v680-quota-recovery.test.cjs','.github/workflows/p0-hotfix-gate.yml'],root);
 assert.ok(names.includes('test/p0-v680-quota-recovery.test.cjs'));
 assert.ok(names.includes('test/release-control.test.js'));
 assert.equal(names.length,new Set(names).size,'tests never duplicate');
 assert.throws(()=>selectP0Tests(['test/irrelevant.test.js'],'/tmp/f123-no-fixtures'),/Missing P0|Missing mapped/);
});

test('postmerge skips duplicate tests ONLY with exact reviewed PR SHA; otherwise re-runs',()=>{
 assert.match(hotfix,/node scripts\/p0-hotfix-proof\.cjs "\$GITHUB_SHA"/);
 assert.match(hotfix,/if: steps\.pr-proof\.outputs\.proved != 'true'/);
 assert.match(hotfix,/Pruebas del area tocada/);
 assert.match(hotfix,/git push --atomic origin/);
 assert.match(hotfix,/candidate: \$\{\{ needs\.probar-y-mover\.outputs\.candidate \}\}/);
 assert.ok(proof.protectedInputs.includes('.github/workflows/p0-hotfix-gate.yml'));
 assert.ok(proof.protectedInputs.includes('scripts/p0-hotfix-proof.cjs'));
 assert.ok(proof.protectedInputs.includes('scripts/pruebas-del-area.cjs'));
 assert.throws(()=>proof.inspectGit('master'),/exact merge SHA required/);
});

test('postpublish uses pinned browser image; no repeated apt/browser download',()=>{
 const smoke=live.slice(live.indexOf('  recorrer:'),live.indexOf('  union-fria:'));
 assert.match(smoke,/image: mcr\.microsoft\.com\/playwright:v1\.62\.1-noble/);
 assert.doesNotMatch(smoke,/npx playwright install|install-deps|apt-get/);
 assert.match(smoke,/scripts\/recorrido-vivo\.cjs/);
});
