'use strict';
// Read-only forensic stimulus against disposable loopback browsers, not real clients.
// Counts snapshot builds after synthetic catalog events; does not disable or alter
// production backup, persistence, or sync. Historical and current run on same CI.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {readyEnvironment}=require('../test/helpers/ready-environment.cjs');
const base=process.env.F123_BASELINE_DOCS;
assert.ok(base && fs.existsSync(path.join(base,'index.html')), 'Baseline path missing');

const ms=n=>Math.round(n*10)/10;
const mb=n=>Math.round(n/1048576*100)/100;

async function run(label,root){
 const env=await readyEnvironment({root});
 try{
  const ctx=await env.context({viewport:{width:390,height:844}});
  const page=await ctx.newPage();
  const response=await page.goto(env.origin+'/index.html',{waitUntil:'load',timeout:90000});
  assert.ok(response?.ok(),label+': synthetic shell failed');
  await page.waitForTimeout(350);
  const cdp=await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.enable');
  const metrics=async()=>{
    await cdp.send('HeapProfiler.collectGarbage');
    return Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x=>[x.name,x.value]));
  };
  const before=await metrics();
  const event=await page.evaluate(async()=>{
    const watchdog=window.OCSyncWatchdog;
    if(!watchdog || !watchdog.estado || !watchdog.estado().activo)
      throw Error('watchdog inactive: no comparable event-handler measurement');
    const previous=window.OCSync, local=window.OCSync||{};
    const previousFn=local.estadoParaCheckpoint;
    const big='SYNTHETIC_ONLY_'.repeat(19000); // 285 KB, never a photo or real record
    let builds=0;
    const fixture={ huella:'synthetic', catalogo:[{id:'synthetic',body:big}] };
    local.estadoParaCheckpoint=function(){
      builds++;
      return {...fixture,huella:'synthetic-rev-'+builds};
    };
    window.OCSync=local;
    const start=performance.now();
    try{
      for(let n=0;n<30;n++)window.dispatchEvent(new Event('oc-catalogo-cambiado'));
    }finally{
      if(previousFn===undefined)delete local.estadoParaCheckpoint;
      else local.estadoParaCheckpoint=previousFn;
      if(previous===undefined)delete window.OCSync;
      else window.OCSync=previous;
    }
    const dispatchMs=performance.now()-start;
    await new Promise(resolve=>setTimeout(resolve,1400));
    const saved=await watchdog.listarSnapshots();
    return {events:30, snapshotBuilds:builds, dispatchMs:Math.round(dispatchMs*10)/10,
      retainedLocalSnapshots:Array.isArray(saved)?saved.length:null, fixtureKb:Math.round(big.length/1024)};
  });
  const after=await metrics();
  await ctx.close();
  return {label,event,scriptMs:ms((after.ScriptDuration-before.ScriptDuration)*1000),
    taskMs:ms((after.TaskDuration-before.TaskDuration)*1000),
    heapBeforeMb:mb(before.JSHeapUsedSize),heapAfterMb:mb(after.JSHeapUsedSize)};
 }finally{await env.close();}
}
async function main(){
 const a=await run('Oct 1 v442',path.resolve(base));
 const b=await run('v706 candidate',path.resolve(__dirname,'../docs'));
 for(const x of [a,b]){
  assert.equal(x.event.events,30);
  assert.equal(typeof x.event.snapshotBuilds,'number');
  assert.ok(x.event.snapshotBuilds>=0);
 }
 console.log('P39_WATCHDOG_STORM_SYNTHETIC '+JSON.stringify([a,b]));
 const lines=[
 '## H2 CPU: local snapshot storms from 30 synthetic catalog events',
 '',
 '| Build | Snapshot builds | Event dispatch ms | CPU script ms | CPU task ms | Heap before/after GC MB | Saved snapshots |',
 '|---|---:|---:|---:|---:|---|---:|',
 ...[a,b].map(x=>['|',x.label,'|',x.event.snapshotBuilds,'|',x.event.dispatchMs,'|',
   x.scriptMs,'|',x.taskMs,'|',x.heapBeforeMb+' / '+x.heapAfterMb,'|',x.event.retainedLocalSnapshots,'|'].join(' ')),
 '',
 'Diagnostic only. Each synthetic event has a distinct revision; 285 KB placeholder record, no photos, no real room, no client. Counts are not proof of crashes or a safe reason to discard intermediate facts.',
 ''
 ];
 if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n'));
 console.log(lines.join('\n'));
}
main().catch(err=>{console.error('P39 watchdog diagnostic FAILED',err);process.exitCode=1;});
