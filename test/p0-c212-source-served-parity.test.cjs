'use strict';
// C212: source-executed tests are insufficient when index.html loads .min.js.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const esbuild=require('esbuild');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
const compiled=(s,loader='js')=>esbuild.transformSync(s,{loader,target:'es2020',minifySyntax:true,minifyWhitespace:true,minifyIdentifiers:false,legalComments:'none'}).code;
const pairs=[
 ['src/app/app-inline-01.js','docs/app-inline-01.min.js'],
 ['docs/mock-backend.js','docs/mock-backend.min.js'],
 ['docs/core/business-read-model.js','docs/core/business-read-model.min.js']
];
test('C212: production HTML serves the three optimized, byte-exact compiled sources',()=>{
 const html=read('docs/index.html');
 const manifest=JSON.parse(read('docs/version-manifest.json'));
 for(const [source,target] of pairs){
   const href='./'+target.slice(5);
   assert.ok(html.includes('src="'+href+'"'),href+' is loaded in production');
   const actual=read(target),expected=compiled(read(source));
   assert.equal(actual,expected,'stale compiled code in '+target);
   assert.equal(manifest.files[href],'sha256-'+crypto.createHash('sha256').update(fs.readFileSync(path.join(root,target))).digest('hex'),'SHA256 manifest of '+href);
 }
});
test('C212: release version stays internally consistent',()=>{
 const v=JSON.parse(read('docs/version.json')),sw=read('docs/sw.js'),dashboard=read('docs/dashboard.html');
 assert.equal(v.version,'v0.8.94');
 assert.equal(v.shell,'f123-shell-v894');
 assert.equal(v.cacheGeneration,'golden430');
 assert.ok(sw.includes('const CACHE = "'+v.shell+'";'));
 assert.ok(sw.includes('const CACHE_GENERACION = "-'+v.cacheGeneration+'";'));
 assert.ok(dashboard.includes('name="dashboard-shell" content="'+v.shell+'"'));
});
