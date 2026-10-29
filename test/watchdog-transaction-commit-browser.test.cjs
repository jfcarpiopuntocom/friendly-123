'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
test('native watchdog reports abort after callback and aborts writes when setup throws',async()=>{
 const server=http.createServer((q,r)=>r.end('<!doctype html><title>Isolated transaction fixture</title>'));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
  await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../docs/sync-watchdog.js'),'utf8')});
  const result=await page.evaluate(async()=>{
   let n=0;window.OCSync={estadoParaCheckpoint:()=>({id:'synthetic-'+n++,money:17.25,stock:9})};
   await OCSyncWatchdog.guardarSnapshot();await OCSyncWatchdog.guardarSnapshot();await OCSyncWatchdog.guardarSnapshot();
   const before=await OCSyncWatchdog.listarSnapshots(),original=IDBObjectStore.prototype.openCursor;
   IDBObjectStore.prototype.openCursor=function(...args){
    const t=this.transaction,q=original.apply(this,args);
    Object.defineProperty(q,'onsuccess',{set(fn){q.addEventListener('success',e=>{fn.call(q,e);if(!q.result)t.abort();});}});
    return q;
   };
   const abortResult=await OCSyncWatchdog.guardarSnapshot();IDBObjectStore.prototype.openCursor=original;
   const afterAbort=await OCSyncWatchdog.listarSnapshots();
   IDBObjectStore.prototype.openCursor=function(){throw Error('synthetic setup failure after put');};
   const throwResult=await OCSyncWatchdog.guardarSnapshot();IDBObjectStore.prototype.openCursor=original;
   const afterThrow=await OCSyncWatchdog.listarSnapshots();
   return {before,abortResult,afterAbort,throwResult,afterThrow};
  });
  assert.equal(result.abortResult,null,'request callback result is not a committed snapshot');
  assert.deepEqual(result.afterAbort,result.before,'late transaction abort preserves prior snapshots');
  assert.equal(result.throwResult,null);
  assert.deepEqual(result.afterThrow,result.before,'setup exception must abort writes already queued');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
