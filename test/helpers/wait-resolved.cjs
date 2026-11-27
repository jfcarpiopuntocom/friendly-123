'use strict';
const {setTimeout:delay}=require('node:timers/promises');
// Playwright page.waitForFunction predicates are synchronous by design (#29132).
// Await the actual boolean returned by page.evaluate, not the truthiness of a Promise.
async function waitResolved(page,predicate,arg,{timeout=30000,label='async predicate'}={}){
 const deadline=Date.now()+timeout;
 do {
  if(await page.evaluate(predicate,arg)===true)return;
  if(Date.now()>=deadline)break;
  await delay(Math.min(50,Math.max(0,deadline-Date.now())));
 }while(Date.now()<deadline);
 throw Error(label+' did not resolve true in '+timeout+'ms');
}
module.exports={waitResolved};
