'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
test('inventory grouping preserves its previous preference without writing another app namespace',()=>{
  const vm=require('node:vm'),source=read('src/app/app-inline-01.js');
  const part=source.slice(source.indexOf('var PP_AGRUPAR_KEY ='),source.indexOf('/* Devuelve las familias'));
  for(const own of [null,'0']){
    const data=new Map([['amg_inv_agrupar_familias','1']]);if(own!==null)data.set('f123_inv_agrupar_familias',own);
    const c={localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}};vm.createContext(c);vm.runInContext(part,c);
    assert.equal(data.get('f123_inv_agrupar_familias'),own??'1');c.fijarAgruparFamilias(false);
    assert.equal(data.get('f123_inv_agrupar_familias'),'0');assert.equal(data.get('amg_inv_agrupar_familias'),'1');
  }
});
test('generated executable assets reproduce their reviewed sources',()=>{
  const esbuild=require('esbuild');
  for(const area of ['app','dashboard'])for(const name of fs.readdirSync(path.join(root,'src',area))){
    const loader=path.extname(name).slice(1);if(!['js','css'].includes(loader))continue;
    const generated=esbuild.transformSync(read('src/'+area+'/'+name),{loader,target:'es2020',minifySyntax:true,minifyWhitespace:true,minifyIdentifiers:false,legalComments:'none'}).code;
    assert.equal(read('docs/'+name.replace(/\.(js|css)$/,'.min.$1')),generated,name+' differs from its reviewed source');
  }
});
test('entry documents stay small and every extracted asset is verified and available offline',()=>{
  const manifest=JSON.parse(read('docs/version-manifest.json')),sw=read('docs/sw.js');
  for(const page of ['index.html','dashboard.html']){
    const html=read('docs/'+page);
    assert.ok(zlib.gzipSync(html).length<35000,'entry HTML must not re-embed the application');
    for(const m of html.matchAll(/(?:src|href)="(\.\/(?:app-|dashboard-)[^"]+\.min\.(?:js|css))"/g)){
      assert.ok(manifest.files[m[1]],'missing integrity hash '+m[1]);
      assert.ok(sw.includes('"'+m[1]+'"'),'missing offline resource '+m[1]);
    }
  }
  const app=read('docs/index.html').replace(/<!--[\s\S]*?-->/g,'');
  for(const match of app.matchAll(/<script\b[^>]*src="(\.\/[^"#]+)"[^>]*>/g)){
    if(match[1]==='./aislamiento.js')assert.doesNotMatch(match[0],/\bdefer\b/);
    else assert.match(match[0],/\bdefer\b/,'local dependency must preserve ordered deferred execution '+match[1]);
  }
  assert.doesNotMatch(app,/<link[^>]*as="script"/);
});
