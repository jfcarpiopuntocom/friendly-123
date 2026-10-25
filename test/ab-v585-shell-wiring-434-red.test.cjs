'use strict';
// #434 v585 release gate. Intentionally RED on public v584.
// Run on the PRIVATE candidate only after merging the journal helper there.
// Read-only: no customer data, no browser storage and no release mutations.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const docs=path.resolve(__dirname,'../docs');
const read=name=>fs.readFileSync(path.join(docs,name),'utf8');
const sha=text=>'sha256-'+crypto.createHash('sha256').update(text,'utf8').digest('hex');

test('v585 #434: transactional helper is loaded by both readers, cached, and checksummed',()=>{
  const helperPath=path.join(docs,'estado-ab.js');
  assert.ok(fs.existsSync(helperPath),'BLOCK: private v585 journal helper absent; this must fail on v584');
  const helper=read('estado-ab.js');
  // A copy of the export in a JS comment is not executable evidence.
  const helperCode=helper.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
  assert.match(helperCode,/\bwindow\.OCEstadoAB\s*=\s*\{\s*crear\s*\}\s*;/,
    'journal helper must expose the expected non-commented browser contract');

  const index=read('index.html'),dash=read('dashboard.html');
  // Only actual executable script tags count; HTML comments cannot satisfy this gate.
  const scripts=src=>[...src.replace(/<!--[\s\S]*?-->/g,'')
    .matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map(m=>({url:m[1],at:m.index}));
  for(const [file,src] of [['index.html',index],['dashboard.html',dash]]){
    const tags=scripts(src),helpers=tags.filter(x=>x.url==='./estado-ab.js');
    assert.equal(helpers.length,1,file+' must load the helper once as a real script');
    const idb=tags.find(x=>x.url==='./estado-idb.js');
    assert.ok(idb && idb.at<helpers[0].at,file+' helper must load after estado-idb');
    if(file==='dashboard.html'){
      assert.ok(helpers[0].at<src.replace(/<!--[\s\S]*?-->/g,'').indexOf('function leerEstadoLocal()'),
        'Dashboard must load journal helper before its local recovery reader');
    }else{
      const backend=tags.find(x=>x.url==='./mock-backend.js');
      assert.ok(backend && helpers[0].at<backend.at,
        'app must load journal helper before its writer starts');
    }
  }

  const sw=read('sw.js');
  const precache=sw.match(/const SHELL\s*=\s*\[([\s\S]*?)\]\s*;/);
  assert.ok(precache,'Service Worker SHELL array must be present');
  const paths=precache[1].replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g,'')
    .match(/["']\.\/estado-ab\.js["']/g)||[];
  assert.equal(paths.length,1,
    'helper must appear exactly once in the ACTUAL precache SHELL array (not only essentials/comments)');
  const essentials=sw.match(/const esenciales\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(essentials && /["']\.\/estado-ab\.js["']/.test(essentials[1]),
    'new helper is indispensable for offline bootstrap, not optional');

  const version=JSON.parse(read('version.json'));
  assert.equal(version.releaseName,'v585','candidate identity must be explicitly new');
  assert.equal(version.shell,'f123-shell-v585');
  assert.equal(version.cacheGeneration,'golden131');
  const manifest=JSON.parse(read('version-manifest.json'));
  assert.equal(manifest.shell,version.shell);
  for(const file of ['estado-ab.js','index.html','dashboard.html','mock-backend.js',
    'auth-ui.js','aislamiento.js']){
    assert.equal(manifest.files['./'+file],sha(read(file)),
      'BLOCK: byte-level SHA-256 manifest mismatch: '+file);
  }
});
