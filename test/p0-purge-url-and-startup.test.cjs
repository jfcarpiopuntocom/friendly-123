'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'docs/index.html'),'utf8');
const auth=fs.readFileSync(path.join(root,'docs/auth-ui.js'),'utf8');
test('manual purge recovery is retained and automatic pre-PIN cache nuke is absent',()=>{
  assert.match(auth,/getElementById\(["']oc-purge-btn["']\)/);
  assert.match(auth,/location\.replace\(url\)/);
  assert.doesNotMatch(html,/f123_sw_nuke_v1|navigator\.serviceWorker\.getRegistrations\(/);
});
test('purge URL cleanup preserves unrelated params/hash without reload or storage writes',()=>{
  const script=html.match(/<script>\s*\/\/ A manual Purge & Reload([\s\S]*?)<\/script>/);
  assert.ok(script,'canonical URL cleanup script is present');
  for(const input of ['/app/?_purge=123#pin','/app/?keep=one&_purge=456&other=two#x','/app/?keep=x#tab']){
    const initial=new URL(input,'https://example.test'),written=[];
    const context={location:{href:initial.href},URL,history:{state:{v:3},replaceState:(state,title,url)=>written.push({state,title,url})}};
    vm.runInNewContext(script[1],context);
    if(initial.searchParams.has('_purge')){
      assert.equal(written.length,1);
      const result=new URL(written[0].url,initial);
      assert.equal(result.searchParams.has('_purge'),false);
      assert.equal(result.hash,initial.hash);
      for(const [k,v] of initial.searchParams)if(k!=='_purge')assert.equal(result.searchParams.get(k),v);
    }else assert.equal(written.length,0);
  }
});
