const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const file=path.join(__dirname,'../docs/dashboard-updates.js');
function fixture({editing=false,served='v2',controller='f123-shell-v2'}={}){
 const events={},nodes={},timers=[];let reloaded=0,prepared=0;
 const c={URL,Date,console,setTimeout:()=>1,clearTimeout(){},setInterval:f=>timers.push(f),MessageChannel:class{constructor(){this.port1={close(){}};this.port2={close(){}}}},location:{href:'https://synthetic.test/app/dashboard.html',reload(){reloaded++}},sessionStorage:{getItem:()=>null,setItem(){}},document:{hidden:false,activeElement:{tagName:editing?'INPUT':'BODY'},querySelector:s=>s.includes('dashboard-shell')?{content:'f123-shell-v1'}:null,getElementById:id=>nodes[id],createElement:()=>({style:{},setAttribute(){}})},navigator:{onLine:true,serviceWorker:{controller:{postMessage(_,ports){ports[0];c.portCallback?.()}},register:async()=>({update:async()=>{},waiting:null}),getRegistration:async()=>({update:async()=>{},waiting:null}),addEventListener:(k,f)=>events[k]=f,removeEventListener:(k)=>delete events[k]}},window:{addEventListener:(k,f)=>events[k]=f,__dashboardUpdate:{safe:()=>!editing,prepare:async()=>{prepared++;return true;}}},fetch:async url=>({ok:true,json:async()=>({shell:'f123-shell-v2'}),text:async()=>'<meta name="dashboard-shell" content="f123-shell-'+served+'">'})};
 // Use the production's SW message contract, not a claimed latest cache name.
 c.navigator.serviceWorker.controller.postMessage=()=>queueMicrotask(()=>events.message?.({source:c.navigator.serviceWorker.controller,data:{tipo:'shell-actual',shell:controller}}));
 c.document.addEventListener=(k,f)=>events[k]=f;
 vm.createContext(c);vm.runInContext(fs.readFileSync(file,'utf8'),c);
 return {c,counts:()=>({reloaded,prepared})};
}
test('dashboard adopts a verified new controller without user action',async()=>{
 const f=fixture();await f.c.window.OCDashboardUpdates.check();assert.equal(f.counts().reloaded,1);assert.equal(f.counts().prepared,1);
});
test('dashboard leaves the editor and drafts untouched during update',async()=>{
 const f=fixture({editing:true});await f.c.window.OCDashboardUpdates.check();assert.equal(f.counts().reloaded,0);
});
test('mixed deployment does not reload into old dashboard bytes',async()=>{
 const f=fixture({served:'v1'});await f.c.window.OCDashboardUpdates.check();assert.equal(f.counts().reloaded,0);
});
