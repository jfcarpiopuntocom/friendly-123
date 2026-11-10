'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {readyEnvironment}=require('./helpers/ready-environment.cjs');

test('H3 RED: IDB and legacy localStorage photo hashes both remain enumerable and readable',async()=>{
  const env=await readyEnvironment({root:path.resolve(__dirname,'../docs')});
  try{
    const ctx=await env.context({viewport:{width:390,height:844}});
    const page=await ctx.newPage();
    const r=await page.goto(env.origin+'/index.html',{waitUntil:'load',timeout:90000});
    assert.ok(r?.ok(),'isolated synthetic shell must load');
    const found=await page.evaluate(async()=>{
      const F=window.OCFotos;
      if(!F||!F.hashesGuardados||!F.leerPorHash||!F.guardarPorHash)throw Error('Production photo API missing');
      const idbHash='h3-idb-synthetic-only',legacyHash='h3-legacy-synthetic-only';
      const idbData='data:image/png;base64,AQID',legacyData='data:image/png;base64,BAUG';
      if(await F.guardarPorHash(idbHash,idbData)!==true)throw Error('Synthetic IDB commit rejected');
      // Distinct legacy hash, never written into IDB: capture the historical fallback.
      localStorage.setItem('f123_fotoblob_'+legacyHash,legacyData);
      const keys=await F.hashesGuardados();
      const idb=await F.leerPorHash(idbHash),legacy=await F.leerPorHash(legacyHash);
      return {keys,idb,legacy,legacyData,idbData};
    });
    assert.ok(found.keys.includes('h3-idb-synthetic-only'),'IDB key missing');
    assert.ok(found.keys.includes('h3-legacy-synthetic-only'),'legacy key must not disappear when IDB is available');
    assert.equal(found.idb,found.idbData,'live IDB content must be preserved');
    assert.equal(found.legacy,found.legacyData,'orphan legacy evidence must stay readable');
    await ctx.close();
  }finally{await env.close();}
});
