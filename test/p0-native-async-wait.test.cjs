'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const {waitResolved}=require('./helpers/wait-resolved.cjs');
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]])test('async wait contract '+name,async()=>{
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage();
  // A native negative control exposes the exact pinned Playwright behavior.
  const premature=await page.waitForFunction(async()=>false,null,{timeout:1000});
  assert.equal(await premature.jsonValue(),false,'upstream Promise truthiness behavior changed; re-evaluate harness');
  await premature.dispose();
  await assert.rejects(waitResolved(page,async()=>false,null,{timeout:200,label:'negative control'}),/negative control/);
  await page.evaluate(()=>{window.__resolved=false;setTimeout(()=>{window.__resolved=true},150)});
  await waitResolved(page,async()=>window.__resolved===true,null,{timeout:3000,label:'positive control'});
  assert.equal(await page.evaluate(()=>window.__resolved),true);
 }finally{await browser.close()}
});
