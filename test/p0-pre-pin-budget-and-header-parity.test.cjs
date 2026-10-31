'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const docs=path.join(__dirname,'../docs');
const read=(p)=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const source=read('src/app/app-style-02.css');
const built=read('docs/app-style-02.min.css');
const index=read('docs/index.html');
const gold='#EFC31A',outline='#000';
test('business name uses the exact sampled logo yellow and black outline in both source and served CSS',()=>{
 for(const [where,css] of [['source',source],['served',built]]){
  assert.match(css,new RegExp('\\-\\-f123-business-gold-ink:'+gold,'i'),where+' yellow mismatch');
  assert.match(css,new RegExp('\\-webkit-text-stroke:\\.06em '+outline.replace('#','\\#'),'i'),where+' logo outline mismatch');
  assert.match(css,/header h1 #oc-negocio-nombre\{font-family:var\(--font-display,/);
 }
 assert.match(index,/id="oc-negocio-nombre"/);
 assert.match(index,/app-style-02\.min\.css/);
});
test('print the pre-PIN script budget without claiming device timings',()=>{
 const upto=index.indexOf('defer src="./auth-ui.js"');
 assert.ok(upto>0);
 const names=[...index.slice(0,upto).matchAll(/<script\b[^>]*\bsrc=["']\.\/([^"']+)["']/g)].map(m=>m[1]);
 const sizes=names.map(name=>{let f=path.join(docs,name);return {name,bytes:fs.existsSync(f)?fs.statSync(f).size:0}}).sort((a,b)=>b.bytes-a.bytes);
 assert.ok(names.length>0);
 console.log('[DIAGNOSTIC only] PRE-PIN',JSON.stringify({scripts:names.length,totalKB:Math.round(sizes.reduce((s,x)=>s+x.bytes,0)/1024),largest:sizes.slice(0,6)}));
});
