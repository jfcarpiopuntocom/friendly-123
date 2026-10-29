const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
test('native snapshot pruning retains the same last three complete backups, concurrent inserts, and abort recovery',async()=>{
 const server=http.createServer((q,r)=>r.end('<!doctype html><title>Synthetic snapshot fixture</title>'));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
  await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../docs/sync-watchdog.js'),'utf8')});
  const result=await page.evaluate(async()=>{
   const db=await new Promise((resolve,reject)=>{const q=indexedDB.open('f123_sync_watchdog',1);q.onupgradeneeded=()=>{q.result.createObjectStore('snapshots',{keyPath:'id'});q.result.createObjectStore('estado',{keyPath:'k'});};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
   const initial=Array.from({length:3},(_,i)=>({id:'old-'+i,ts:new Date(1000+i).toISOString(),data:{marker:'old-'+i,history:Array.from({length:100},(_,j)=>({id:j,money:17.25})),photos:['synthetic-photo-preserved']}}));
   await new Promise((resolve,reject)=>{const t=db.transaction('snapshots','readwrite');initial.forEach(s=>t.objectStore('snapshots').put(s));t.oncomplete=resolve;t.onabort=()=>reject(t.error);});
   let n=0;window.OCSync={estadoParaCheckpoint:()=>({marker:'new-'+n++,history:[{id:'sale',money:17.25}],photos:['synthetic-photo-preserved']})};
   const original=IDBObjectStore.prototype.getAll;let calls=0;
   IDBObjectStore.prototype.getAll=function(...args){if(this.name==='snapshots'){calls++;throw Error('Pruning must not materialize every backup');}return original.apply(this,args);};
   const inserted=await Promise.all([OCSyncWatchdog.guardarSnapshot(),OCSyncWatchdog.guardarSnapshot()]);
   IDBObjectStore.prototype.getAll=original;
   const retained=await OCSyncWatchdog.listarSnapshots();
   // getAll key order followed by the existing timestamp sort defines ties.
   const expected=initial.concat(inserted).sort((a,b)=>a.id<b.id?-1:1).sort((a,b)=>a.ts<b.ts?1:-1).slice(0,3);
   const latest=await OCSyncWatchdog.ultimoSnapshot();
   const put=IDBObjectStore.prototype.put;
   IDBObjectStore.prototype.put=function(...args){const request=put.apply(this,args);if(this.name==='snapshots')this.transaction.abort();return request;};
   const failed=await OCSyncWatchdog.guardarSnapshot();IDBObjectStore.prototype.put=put;
   const afterAbort=await OCSyncWatchdog.listarSnapshots();
   return{calls,retained,expected,latest,failed,afterAbort};
  });
  assert.equal(result.calls,0);assert.equal(result.retained.length,3);
  assert.deepEqual(result.retained,result.expected,'pruning preserves timestamp order, key-order ties and complete payloads');
  assert.deepEqual(result.latest,result.retained[0],'latest recovery retains its complete money/history/photo payload');
  assert.equal(result.failed,null);assert.deepEqual(result.afterAbort,result.retained,'aborted insertion cannot delete a prior backup');
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
