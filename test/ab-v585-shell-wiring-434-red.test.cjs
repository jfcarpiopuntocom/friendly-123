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
  assert.match(helper,/window\.OCEstadoAB\s*=\s*\{\s*crear\s*\}/,
    'journal helper must expose the expected browser contract');

  const index=read('index.html'),dash=read('dashboard.html');
  const tag='<script src="./estado-ab.js"></script>';
  for(const [file,src] of [['index.html',index],['dashboard.html',dash]]){
    assert.equal(src.split(tag).length-1,1,file+' must load the helper once');
    assert.ok(src.indexOf(tag)<src.indexOf('function leerEstadoLocal()') || file==='index.html',
      'Dashboard must load helper before its local recovery reader');
  }
  assert.ok(index.indexOf(tag)<index.indexOf('<script src="./mock-backend.js"></script>'),
    'app must load journal helper before its writer starts');

  const sw=read('sw.js');
  assert.ok(sw.includes('"./estado-ab.js"'),'new helper must be in the PWA precache list');
  const essentials=sw.match(/const esenciales = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(essentials && essentials[1].includes('"./estado-ab.js"'),
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
