const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('all browser fixtures block production WebSockets before page creation and preserve local fixtures',async()=>{
 const routes=[],engines={};
 for(const name of ['chromium','webkit','firefox'])engines[name]={launch:async()=>({newContext:async()=>({
  route:async()=>{},routeWebSocket:async(pattern,handler)=>routes.push({name,pattern,handler}),
  newPage:async()=>({})})})};
 vm.runInNewContext(fs.readFileSync(require.resolve('./helpers/sin-red-produccion.cjs'),'utf8'),{require:()=>engines});
 for(const name of Object.keys(engines)){
  const b=await engines[name].launch();await b.newContext();await b.newPage();
  const rs=routes.filter(x=>x.name===name);assert.equal(rs.length,2,'register WebSocket block for every context');
  for(const r of rs){
   assert.equal(r.pattern.test('wss://synthetic-relay.workers.dev/sync'),true);
   assert.equal(r.pattern.test('wss://jfcarpio.com/sync'),true);
   assert.equal(r.pattern.test('ws://127.0.0.1:8800/fixture'),false);
   let closed=false;await r.handler({close:()=>{closed=true;},connectToServer:()=>assert.fail('must not contact production')});
   assert.equal(closed,true);
  }
 }
});
