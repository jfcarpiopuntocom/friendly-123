'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {isInertNewModule,hasRuntimeChange,isFeaturePr,RELEASE_ONLY}=require('../scripts/release-control.cjs');
test('new unreferenced mjs does not change shipped shell; existing scripts and wiring still do',()=>{
 const inert=f=>isInertNewModule(f,false,false);
 assert.equal(inert('docs/physical-count.mjs'),true);
 assert.equal(hasRuntimeChange(['docs/physical-count.mjs'],inert),false);
 assert.equal(hasRuntimeChange(['docs/index.html','docs/physical-count.mjs'],inert),true);
 for(const file of ['docs/peer-sync.js','docs/sync-yjs.js','docs/sw.js','docs/index.html','docs/sync-rollout.json'])
  assert.equal(hasRuntimeChange([file],inert),true,file);
 assert.equal(isInertNewModule('docs/existing.mjs',true,false),false);
 assert.equal(isInertNewModule('docs/wired.mjs',false,true),false);
 assert.equal(isInertNewModule('docs/customer-data.js',false,false),false);
});
test('feature PR cannot mix a release seal or dashboard bytes',()=>{
 assert.equal(isFeaturePr({GITHUB_EVENT_NAME:'pull_request',GITHUB_HEAD_REF:'p0/c03'}),true);
 assert.equal(isFeaturePr({GITHUB_EVENT_NAME:'pull_request',GITHUB_HEAD_REF:'release/v637'}),false);
 assert.equal(isFeaturePr({GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/master'}),false);
 for(const file of ['docs/version.json','docs/sw.js','docs/version-manifest.json','docs/dashboard.html'])
  assert.equal(RELEASE_ONLY.has(file),true,file);
});
