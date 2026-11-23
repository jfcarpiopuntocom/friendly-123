'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
const docs=path.join(__dirname,'../docs');
const read=p=>fs.readFileSync(path.join(docs,p),'utf8');
test('C212 v894 browser bundle SHA256 matches published manifest for EVERY touched production module',()=>{
 const v=JSON.parse(read('version.json'));
 const manifest=JSON.parse(read('version-manifest.json'));
 const sw=read('sw.js'),html=read('index.html'),dashboard=read('dashboard.html');
 assert.equal(v.version,'v0.8.94');
 assert.equal(v.shell,'f123-shell-v894');
 assert.equal(v.cacheGeneration,'golden430');
 assert.equal(manifest.version,v.version);
 assert.equal(manifest.shell,v.shell);
 assert.match(sw,/const CACHE = "f123-shell-v894"/);
 assert.match(sw,/const CACHE_GENERACION = "-golden430"/);
 assert.match(dashboard,/name="dashboard-shell" content="f123-shell-v894"/);
 for(const file of ['app-inline-01.min.js','mock-backend.min.js','core/business-read-model.min.js']){
  const bytes=fs.readFileSync(path.join(docs,file));
  const digest=crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(manifest.files['./'+file],'sha256-'+digest,file+' old compiled asset cannot ship');
  assert.ok(html.includes('./'+file),'live entry includes '+file);
 }
});
