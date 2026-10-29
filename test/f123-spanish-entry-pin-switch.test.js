'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../docs/index.html'),'utf8');
const i18n=fs.readFileSync(path.join(__dirname,'../docs/i18n.js'),'utf8');
const auth=fs.readFileSync(path.join(__dirname,'../docs/auth-ui.js'),'utf8');
const script=html.match(/<script>\s*\/\* AMIGABLE -> friendly-123:[\s\S]*?<\/script>/);
if(!script)throw Error('AMIGABLE Spanish entry bootstrap absent');
const code=script[0].replace(/^<script>/,'').replace(/<\/script>$/,'');
function run(url,stored='en',failStorage=false){
 const current=new URL(url),values=new Map([['f123_lang',stored]]);const changes=[];
 const ctx={URLSearchParams,location:{search:current.search,pathname:current.pathname,hash:current.hash},
  history:{state:null,replaceState:(_s,_t,url)=>changes.push(url)},
  localStorage:{setItem:(key,val)=>{if(failStorage)throw Error('storage denied');values.set(key,val)},getItem:key=>values.get(key)},
  window:{}};
 vm.runInNewContext(code,ctx);
 return {changes,lang:values.get('f123_lang'),marker:ctx.window.__f123EntrySpanish};
}
test('AMIGABLE entry switches to Spanish and cleans transfer-only query',()=>{
 const x=run('https://example.test/friendly-123/?via=amigable&lang=es&ticket=keep#frag');
 assert.equal(x.lang,'es');assert.equal(x.marker,true);
 assert.deepEqual(x.changes,['/friendly-123/?ticket=keep#frag']);
});
test('direct existing friendly customer retains their stored English setting',()=>{
 const x=run('https://example.test/friendly-123/?lang=es');
 assert.equal(x.lang,'en');assert.equal(x.changes.length,0);assert.equal(x.marker,undefined);
});
test('if browser storage is unavailable the entry language survives until i18n starts',()=>{
 const x=run('https://example.test/friendly-123/?via=amigable&lang=es','en',true);
 assert.equal(x.marker,true);
 assert.match(i18n,/let lang = window\.__f123EntrySpanish \? "es"/);
});
test('PIN is bilingual before login with touchable and accessible controls',()=>{
 assert.match(auth,/class="oc-lang-btn" data-lang="en" lang="en"/);
 assert.match(auth,/class="oc-lang-btn" data-lang="es" lang="es"/);
 assert.match(auth,/min-height:44px/);
 assert.match(auth,/aria-pressed/);
 assert.match(auth,/window\.OCI18n\.setLang\(b\.dataset\.lang\)/);
});
test('does not move authentication before storage isolation or introduce PIN bypass',()=>{
 assert.ok(html.indexOf('./aislamiento.js')<html.indexOf('AMIGABLE -> friendly-123'));
 assert.ok(html.indexOf('AMIGABLE -> friendly-123')<html.indexOf('defer src="./i18n.js"'));
 assert.ok(html.indexOf('defer src="./i18n.js"')<html.indexOf('defer src="./auth-ui.js"'));
});