'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const src=fs.readFileSync(process.env.F123_SW_SOURCE||'docs/sw.js','utf8');
const shell=/^const CACHE = "([^"]+)";/m.exec(src)[1];
const install=src.slice(src.indexOf('self.addEventListener("install"'),src.indexOf('self.addEventListener("activate"'));
assert.ok(install.length>0);
const htmls=['./index.html','./dashboard.html'];
const body=Buffer.from('<!doctype html><title>synthetic</title>');
const digest='sha256-'+crypto.createHash('sha256').update(body).digest('hex');
async function run(mode){
 const manifest={shell,files:Object.fromEntries(htmls.map(rel=>[rel,digest]))};
 if(mode==='wrong-shell')manifest.shell='f123-shell-v99999';
 if(mode==='missing-digest')delete manifest.files['./dashboard.html'];
 if(mode==='bad-digest')manifest.files['./index.html']='sha256-xyz';
 if(mode==='files-array')manifest.files=[];
 if(mode==='wrong-digest')manifest.files['./index.html']='sha256-'+'0'.repeat(64);
 let handler,wait,skip=0,prepared=0;const previous='f123-shell-v1-golden1',stores=new Set([previous]);
 const cache={async add(req){if(mode==='optional-missing'&&req.url==='./manual.html')throw Error('optional offline')},async match(rel){
  if(rel==='./version-manifest.json'){
   if(mode==='absent')return null;
   return {ok:mode!=='non-ok',async json(){if(mode==='malformed')throw SyntaxError('invalid JSON');return manifest;}};
  }
  if(mode==='optional-missing'&&rel==='./manual.html')return null;
  return {async arrayBuffer(){return body.buffer.slice(body.byteOffset,body.byteOffset+body.byteLength);}};
 },async put(){}};
 const context={self:{addEventListener(name,fn){handler=fn},skipWaiting(){skip++;return Promise.resolve()}},
 caches:{async open(name){stores.add(name);return cache},async keys(){return [...stores]}},
 Request:class{constructor(url){this.url=url}},crypto:{subtle:crypto.webcrypto.subtle},fetch:async()=>null,console:{warn(){}},prepared:()=>{prepared++}};
 const decl='const CACHE='+JSON.stringify(shell)+',CACHE_LOCAL=CACHE+"-golden1",SHELL=["./index.html","./dashboard.html","./manual.html","./version-manifest.json"];function prepararShellPorDocumento(){prepared()}';
 vm.runInNewContext(decl+'\n'+install,context);handler({waitUntil(p){wait=p}});
 let accepted=true;try{await wait}catch(e){accepted=false;}
 return {accepted,skip,prepared,previousPreserved:stores.has(previous)};
}
for(const mode of ['valid','optional-missing','absent','malformed','wrong-shell','missing-digest','bad-digest','non-ok','files-array','wrong-digest']){
 test('install manifest '+mode,async()=>{
  const allow=mode==='valid'||mode==='optional-missing';
  const result=await run(mode);
  assert.deepEqual(result,{accepted:allow,skip:allow?1:0,prepared:allow?1:0,previousPreserved:true},'install manifest contract: '+mode);
 });
}
