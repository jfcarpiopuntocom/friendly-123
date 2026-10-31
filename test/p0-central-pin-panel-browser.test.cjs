"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../docs/panel-pin.js"),"utf8");
function panel(options={}){
 const values=new Map(),requests=[];
 for(const id of ["lic-pin-state","lic-pin-new","lic-pin-confirm","lic-pin-license","lic-pin-control"])
  values.set(id,{value:"",textContent:"",style:{},hidden:true});
 const window={},document={getElementById:id=>values.get(id),addEventListener(){}};
 let reply=options.reply||(()=>({ok:true,revision:4}));
 const scope={window,document,URL,URLSearchParams,confirm:()=>true,
  licWorkerUrl:()=> "https://worker.invalid",
  licMasterKey:()=> "synthetic-master",
  fetch:async(url,init)=>{
   requests.push({url,init});
   const data=reply(url,init);
   return {ok:data.status===undefined||data.status===200,status:data.status||200,
     json:async()=>data.body||data};
  }};
 vm.runInNewContext(source,scope);
 return {window,values,requests};
}
const lic="F123-SYNTHETIC-AUTH",id="synthetic-device";
test("JFC panel retrieves current revision before imposing a new one",async()=>{
 const p=panel({reply:()=>({configured:true,revision:3,changedAt:1000})});
 await p.window.licAbrirPinCentral(lic,id);
 assert.equal(p.requests.length,1);
 assert.match(p.requests[0].url,/\/pin\/admin\/status\?/);
 assert.match(p.values.get("lic-pin-state").textContent,/revisión 3/);
});
test("JFC panel sends compare-and-swap revision and never caches plain credentials",async()=>{
 const p=panel({reply:(u,o)=>u.includes("/set")?{ok:true,revision:4}:{configured:true,revision:3,changedAt:1000}});
 await p.window.licAbrirPinCentral(lic,id);
 p.values.get("lic-pin-new").value="149";p.values.get("lic-pin-confirm").value="149";
 await p.window.licFijarPinAutoridad();
 const req=p.requests.at(-1);
 assert.ok(req.url.endsWith("/pin/admin/set"));
 const b=JSON.parse(req.init.body);
 assert.equal(b.expectedRevision,3);assert.equal(b.pin,"149");
 assert.equal(req.init.headers["X-Master-Key"],"synthetic-master");
 assert.equal(p.values.get("lic-pin-new").value,"");
 assert.equal(p.values.get("lic-pin-confirm").value,"");
 assert.equal(source.includes("localStorage.setItem"),false);
});
test("Bad confirmation never sends PIN to server",async()=>{
 const p=panel({reply:()=>({configured:true,revision:3,changedAt:1000})});
 await p.window.licAbrirPinCentral(lic,id);
 p.values.get("lic-pin-new").value="149";p.values.get("lic-pin-confirm").value="148";
 await p.window.licFijarPinAutoridad();
 assert.equal(p.requests.length,1);
});
