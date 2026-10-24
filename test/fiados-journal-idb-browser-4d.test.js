'use strict';
// One real-origin browser per engine; synthetic data only, 127.0.0.1 and no app license.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium,webkit}=require('playwright');
const moduleText=fs.readFileSync(path.join(__dirname,'../scripts/prototypes/fiados-journal-idb.cjs'),'utf8');
async function site(){
 const server=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end('<!doctype html><title>Synthetic local financial journal</title>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:'http://127.0.0.1:'+server.address().port+'/',close:()=>new Promise(resolve=>server.close(resolve))};
}
async function install(page){
 await page.evaluate(source=>{
   const mod={exports:{}};
   new Function('module',source)(mod);
   window.TestCreditJournal=mod.exports;
 },moduleText);
}
for(const [label,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test('P0 browser '+label+': localStorage full -> durable IndexedDB reference across reload',async()=>{
   const server=await site();
   const browser=await engine.launch({headless:true});
   try{
     const context=await browser.newContext(),page=await context.newPage();
     await page.goto(server.url);await install(page);
     const original=await page.evaluate(async()=>{
       const driver=window.TestCreditJournal.createIDBDriver(window.indexedDB);
       const ls={getItem:()=>null,setItem:()=>{throw Error('QuotaExceededError')}};
       const j=window.TestCreditJournal.createJournal({driver,localStorage:ls,room:'synthetic-licence-A'});
       const key='f123_customer_allocation_intent_v1:synthetic-client';
       const intent={opId:'customer-allocation:synthetic',paymentOpId:'customer-payment:synthetic',
         monto:25,partes:[{cargoKey:'cargo:synthetic',monto:25}],motivo:'Abono'};
       const a=await j.begin(key,intent);
       return {key,intent,ref:a};
     });
     assert.equal(original.ref.rev,1);
     await page.reload();await install(page);
     const after=await page.evaluate(async key=>{
       const driver=window.TestCreditJournal.createIDBDriver(window.indexedDB);
       const j=window.TestCreditJournal.createJournal({driver,localStorage:{getItem:()=>null},room:'synthetic-licence-A'});
       const saved=await j.read(key);
       await j.receipt(key,saved.intent.opId,'synthetic-receipt');
       await j.complete(key,saved.intent.opId);
       const terminal=await j.read(key);
       let blocked=false;
       try{await j.begin(key,saved.intent)}catch(e){blocked=e.code==='PAYMENT_ALREADY_COMPLETED'}
       return {original:saved,terminal,blocked};
     },original.key);
     assert.equal(after.original.intent.opId,original.intent.opId);
     assert.equal(after.terminal.state,'completed');
     assert.equal(after.terminal.intent.abonoId,'synthetic-receipt');
     assert.equal(after.blocked,true);
   }finally{await browser.close();await server.close();}
 });
 test('P0 browser '+label+': two tabs cannot create different payment references for same store',async()=>{
   const server=await site(),browser=await engine.launch({headless:true});
   try{
     const context=await browser.newContext(),a=await context.newPage(),b=await context.newPage();
     await Promise.all([a.goto(server.url),b.goto(server.url)]);
     await Promise.all([install(a),install(b)]);
     const attempt=(p,opId)=>p.evaluate(async op=>{
       const x=window.TestCreditJournal;
       const j=x.createJournal({driver:x.createIDBDriver(window.indexedDB),localStorage:{getItem:()=>null},room:'synthetic-licence-A'});
       try{await j.begin('f123_customer_payment_intent_v1:synthetic-client',{opId:op,monto:5,motivo:'Abono'});return 'accepted';}
       catch(e){return e.code||e.message;}
     },opId);
     const result=await Promise.all([attempt(a,'customer-payment:X'),attempt(b,'customer-payment:Y')]);
     assert.equal(result.filter(x=>x==='accepted').length,1,JSON.stringify(result));
     assert.equal(result.filter(x=>x!=='accepted').length,1);
   }finally{await browser.close();await server.close();}
 });
}
