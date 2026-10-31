"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../docs/panel-pin.js"),"utf8");
function panel(options={}){
 const values=new Map(),requests=[];
 for(const id of ["lic-pin-state","lic-pin-new","lic-pin-confirm","lic-pin-license","lic-pin-control","lic-pin-summary","lic-pin-stage","lic-pin-activate"])
  values.set(id,{value:"",textContent:"",style:{},hidden:true,disabled:false});
 const window={},document={getElementById:id=>values.get(id),addEventListener(){}};
 let reply=options.reply||(()=>({ok:true,revision:4}));
 const scope={window,document,URL,URLSearchParams,confirm:()=>true,
  licWorkerUrl:()=>options.workerUrl||"https://friendly123-licencias.jfcarpio.workers.dev",licMasterKey:()=> "synthetic-master",
  fetch:async(url,init)=>{
   requests.push({url,init});
   const data=reply(url,init);
   return {ok:data.status===undefined||data.status===200,status:data.status||200,json:async()=>data.body||data};
  }};
 vm.runInNewContext(source,scope);
 return {window,values,requests};
}
const lic="F123-SYNTHETIC-AUTH",id="synthetic-device";
const observed={configured:false,phase:"collecting",revision:0,pendingRevision:null,observedDevices:2,conflictingReports:true};
test("JFC panel displays existing device inventory and keeps activation disabled",async()=>{
 const p=panel({reply:()=>observed});
 await p.window.licAbrirPinCentral(lic,id,2);
 assert.equal(p.requests.length,1);
 assert.match(p.requests[0].url,/\/pin\/admin\/status\?/);
 assert.match(p.values.get("lic-pin-summary").textContent,/2 aparatos registrados/);
 assert.match(p.values.get("lic-pin-summary").textContent,/PIN distintos detectados/);
 assert.equal(p.values.get("lic-pin-activate").disabled,true);
 assert.equal(p.values.get("lic-pin-stage").disabled,false);
});
test("JFC stage does not activate and requires a second deliberate action",async()=>{
 const p=panel({reply:u=>{
  if(u.includes("/admin/status"))return observed;
  if(u.includes("/admin/set"))return {...observed,ok:true,staged:true,pendingRevision:1};
  if(u.includes("/admin/activate"))return {...observed,ok:true,configured:true,revision:1,pendingRevision:null};
 }});
 await p.window.licAbrirPinCentral(lic,id,2);
 p.values.get("lic-pin-new").value="149";p.values.get("lic-pin-confirm").value="149";
 await p.window.licFijarPinAutoridad();
 assert.equal(p.requests.length,2,"only stage request");
 let req=p.requests.at(-1),data=JSON.parse(req.init.body);
 assert.ok(req.url.endsWith("/pin/admin/set"));
 assert.equal(data.expectedRevision,0);assert.equal(data.pin,"149");
 assert.equal(req.init.headers["X-Master-Key"],"synthetic-master");
 assert.equal(p.values.get("lic-pin-new").value,"");
 assert.equal(p.values.get("lic-pin-confirm").value,"");
 assert.equal(p.values.get("lic-pin-activate").disabled,false);
 p.values.get("lic-pin-new").value="149";p.values.get("lic-pin-confirm").value="149";
 await p.window.licActivarPinAutoridad();
 req=p.requests.at(-1);assert.ok(req.url.endsWith("/pin/admin/activate"));
 assert.equal(p.requests.length,3);
 assert.equal(p.values.get("lic-pin-activate").disabled,true);
 assert.equal(source.includes("localStorage.setItem"),false);
});
test("Bad confirmation or unenrolled license never submits a PIN",async()=>{
 const p=panel({reply:()=>({...observed,observedDevices:0})});
 await p.window.licAbrirPinCentral(lic,id,2);
 assert.equal(p.values.get("lic-pin-stage").disabled,true);
 p.values.get("lic-pin-new").value="149";p.values.get("lic-pin-confirm").value="148";
 await p.window.licFijarPinAutoridad();
 assert.equal(p.requests.length,1);
});
test("Responsive PIN panel and pencil are present outside the More menu",()=>{
 const html=fs.readFileSync(path.join(__dirname,"../docs/panel.html"),"utf8");
 const rows=fs.readFileSync(path.join(__dirname,"../docs/panel-licencias.js"),"utf8");
 assert.match(html,/class="lic-pin-card"/);
 assert.match(html,/@media\(max-width:520px\)\{\.lic-pin-fields\{grid-template-columns:1fr/);
 assert.match(html,/id="lic-pin-activate"/);
 assert.match(rows,/lic-pin-pencil/);
 assert.match(rows,/data-owner-pin-license/);
});

test("Incomplete client PIN census blocks staging even when called directly",async()=>{
 const p=panel({reply:()=>({...observed,observedDevices:1})});
 await p.window.licAbrirPinCentral(lic,id,2);
 assert.equal(p.values.get("lic-pin-stage").disabled,true);
 assert.match(p.values.get("lic-pin-summary").textContent,/Faltan aparatos/);
 p.values.get("lic-pin-new").value="149";p.values.get("lic-pin-confirm").value="149";
 await p.window.licFijarPinAutoridad();
 assert.equal(p.requests.length,1,"no admin mutation before complete census");
});

test("Admin master key and PIN never go to an overridden or malicious Worker URL",async()=>{
 const p=panel({workerUrl:"https://attacker.invalid",reply:()=>observed});
 await p.window.licAbrirPinCentral(lic,id,2);
 assert.equal(p.requests.length,0);
 assert.match(p.values.get("lic-pin-state").textContent,/Worker oficial/);
});

test("Even a malformed HTTP 200 with ok:false never activates a customer's PIN",async()=>{
 const p=panel({reply:u=>u.includes("/admin/status")?observed:{ok:false,reason:"expired-proposal"}});
 await p.window.licAbrirPinCentral(lic,id,2);
 p.values.get("lic-pin-new").value="149";p.values.get("lic-pin-confirm").value="149";
 await p.window.licFijarPinAutoridad();
 assert.equal(p.requests.length,2);
 assert.match(p.values.get("lic-pin-state").textContent,/expired-proposal/);
 assert.equal(p.values.get("lic-pin-activate").disabled,true);
});
