'use strict';
// H2 synthetic photo residency: no real images, user accounts, relay or network.
// Reads are measured on v706 because bulk hash->bytes API did not exist in v442.
// A HEAD-only diagnostic, never imported into shipped app.
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {readyEnvironment}=require('../test/helpers/ready-environment.cjs');
const mb=n=>Math.round(n/1048576*100)/100;
const ms=n=>Math.round(n*10)/10;
async function run(){
 const env=await readyEnvironment({root:path.resolve(__dirname,'../docs')});
 try{
  const ctx=await env.context({viewport:{width:390,height:844}});
  const page=await ctx.newPage();
  const response=await page.goto(env.origin+'/index.html',{waitUntil:'load',timeout:90000});
  assert.ok(response?.ok(),'Synthetic shell failed');
  await page.waitForTimeout(300);
  const cdp=await ctx.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const heap=async()=>{
    await cdp.send('HeapProfiler.collectGarbage');
    const perf=await cdp.send('Performance.getMetrics');
    return mb(Object.fromEntries(perf.metrics.map(x=>[x.name,x.value])).JSHeapUsedSize);
  };
  await cdp.send('Performance.enable');
  const seed=await page.evaluate(async()=>{
    const f=window.OCFotos;
    if(!f || !f.guardarPorHash || !f.hashesGuardados || !f.leerPorHash || !f.leerTodosPorHash)
      throw Error('Required production photo APIs unavailable');
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const keys=[];
    let bytes=0;
    for(let i=0;i<24;i++){
      let x=(i+1)*113;
      const chars=new Array(140*1024);
      for(let j=0;j<chars.length;j++){
        x=(Math.imul(x,1664525)+1013904223)>>>0;
        chars[j]=alphabet[(x>>>26)&63];
      }
      const data='data:image/jpeg;base64,'+chars.join('');
      const hash=await f.hashDeDataUrl(data);
      if(!await f.guardarPorHash(hash,data))throw Error('Synthetic IDB photo write failed '+i);
      keys.push(hash); bytes+=data.length;
    }
    window.__h2PhotoSyntheticKeys=keys;
    return {count:keys.length,base64MiB:Math.round(bytes/1048576*100)/100};
  });
  const baseline=await heap();
  const hashStats=await page.evaluate(async()=>{
    const t=performance.now();
    window.__h2PhotoSyntheticHashes=await window.OCFotos.hashesGuardados();
    return {n:window.__h2PhotoSyntheticHashes.length,ms:Math.round((performance.now()-t)*10)/10};
  });
  const hashHeap=await heap();
  const oneStats=await page.evaluate(async()=>{
    const t=performance.now();
    window.__h2PhotoSyntheticOne=await window.OCFotos.leerPorHash(window.__h2PhotoSyntheticKeys[0]);
    return {length:window.__h2PhotoSyntheticOne.length,ms:Math.round((performance.now()-t)*10)/10};
  });
  const oneHeap=await heap();
  const bulkStats=await page.evaluate(async()=>{
    const t=performance.now();
    window.__h2PhotoSyntheticAll=await window.OCFotos.leerTodosPorHash();
    const values=Object.values(window.__h2PhotoSyntheticAll);
    return {n:values.length,totalBytes:values.reduce((sum,v)=>sum+v.length,0),ms:Math.round((performance.now()-t)*10)/10};
  });
  const bulkHeap=await heap();
  await page.evaluate(()=>{delete window.__h2PhotoSyntheticAll;delete window.__h2PhotoSyntheticOne;delete window.__h2PhotoSyntheticHashes;delete window.__h2PhotoSyntheticKeys;});
  const afterRelease=await heap();
  await ctx.close();
  const result={kind:'H2-synthetic-photo-residency',seed,baselineHeapMb:baseline,
    hashOnly:{...hashStats,heapMb:hashHeap,deltaMb:ms(hashHeap-baseline)},
    onePhoto:{...oneStats,heapMb:oneHeap,deltaMb:ms(oneHeap-hashHeap)},
    bulkRead:{count:bulkStats.n,base64MiB:mb(bulkStats.totalBytes),
      ms:bulkStats.ms,heapMb:bulkHeap,deltaMb:ms(bulkHeap-oneHeap)},
    afterReleaseHeapMb:afterRelease,
    caveat:'This profiles V8 JS heap of one disposable pre-login browser. It does not measure iOS process RAM, photos transported over Sync3, hash integrity across devices or complete business history.'};
  assert.equal(seed.count,24);
  assert.equal(bulkStats.n,24,'Bulk read must retain all 24 photos in synthetic notebook');
  console.log('P39_PHOTO_MEMORY_SYNTHETIC '+JSON.stringify(result));
  if(process.env.GITHUB_STEP_SUMMARY){
    const rows=['## Photo RAM H2 diagnostic (v706 only)','', 'Synthetic 24 photo records, '+seed.base64MiB+' MiB data URLs.', '',
      '| Mode | V8 heap MB after GC | Difference MB | Access time ms |',
      '|---|---:|---:|---:|',
      '| Before read | '+baseline+' | — | — |',
      '| Hashes only | '+hashHeap+' | '+ms(hashHeap-baseline)+' | '+hashStats.ms+' |',
      '| One photo | '+oneHeap+' | '+ms(oneHeap-hashHeap)+' | '+oneStats.ms+' |',
      '| All photos | '+bulkHeap+' | '+ms(bulkHeap-oneHeap)+' | '+bulkStats.ms+' |',
      '| After release | '+afterRelease+' | '+ms(afterRelease-baseline)+' | — |',
      '',result.caveat,''];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,rows.join('\n'));
  }
 }finally{await env.close();}
}
run().catch(e=>{console.error('H2 synthetic photo RAM profile failed',e);process.exitCode=1;});
