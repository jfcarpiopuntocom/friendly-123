// Precut Yjs operations must never be silently double-counted by a new
// economic baseline. Real Workerd SQLite test, QA fixture only, no customers.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';import fs from 'node:fs';import os from 'node:os';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';import {Miniflare} from 'miniflare';
test('P0 no new stock/cash baseline on top of an unresolved existing Yjs ops journal', {timeout:30000},async()=>{
  const baseline={license:'F123-SYNT-BUSINESS',frozenHead:'firebase-head-001',
    products:[{productId:'sku_1',quantity:10,unitPriceCents:1999}],openingCashCents:0};
  const expectedSha256=createHash('sha256').update(JSON.stringify(baseline)).digest('hex');
  const output=await build({entryPoints:[path.join(import.meta.dirname,'fixtures/authoritative-sql-worker.mjs')],
    bundle:true,format:'esm',platform:'neutral',conditions:['workerd','worker','browser'],
    mainFields:['module','main'],external:['cloudflare:*'],write:false});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'f123-yjs-history-reject-'));
  let mf;
  try{
    mf=new Miniflare({modules:true,script:output.outputFiles[0].text,compatibilityDate:'2026-06-01',
      compatibilityFlags:['nodejs_compat'],
      durableObjects:{BUSINESS:{className:'CommercialFixture',useSQLite:true}},
      durableObjectsPersist:path.join(dir,'db')});
    const base=await mf.ready;
    const request=async(pathname,payload)=>{
      const r=await fetch(new URL(pathname,base),{method:'POST',
        headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      return{status:r.status,body:await r.json()};
    };
    assert.equal((await request('/inject-yjs-history',{})).status,200);
    const installed=await request('/seed',{...baseline,sourceFrozenVerified:true,expectedSha256});
    assert.equal(installed.status,409,'Yjs economic history without reconciling opIds must forbid baseline');
    assert.match(installed.body.reason,/Yjs|history|migration|precut/i);
    const r=await fetch(new URL('/stats',base));
    const stats=await r.json();
    assert.deepEqual(stats.stock,[],'unsafe import has no stock side effects');
    assert.deepEqual(stats.baseline,[],'unsafe import has no cash side effects');
    assert.deepEqual(stats.effects,[]);
  }finally{await mf?.dispose();fs.rmSync(dir,{recursive:true,force:true});}
});
