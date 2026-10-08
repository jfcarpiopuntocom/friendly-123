const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('every installed browser engine blocks production traffic, including implicit newPage contexts',async()=>{
  const engines={}; const routes=[];
  for(const name of ['chromium','webkit','firefox']) engines[name]={launch:async()=>({newPage:async()=>({}),newContext:async()=>({route:async(pattern)=>routes.push({name,pattern}),routeWebSocket:async()=>{},newPage:async()=>({})})})};
  const src=fs.readFileSync(require.resolve('./helpers/sin-red-produccion.cjs'),'utf8');
  vm.runInNewContext(src,{require:name=>{assert.equal(name,'playwright');return engines;}});
  for(const name of Object.keys(engines)){
    const browser=await engines[name].launch();
    await browser.newContext(); await browser.newPage();
    const registered=routes.filter(r=>r.name===name);
    assert.equal(registered.filter(r=>r.pattern.test('https://fixture.workers.dev/checkin')).length,2,`${name} must block both context creation routes`);
    assert.equal(registered.filter(r=>r.pattern.test('https://fonts.googleapis.com/css2')).length,2,`${name} must not depend on external font timing`);
  }
});
