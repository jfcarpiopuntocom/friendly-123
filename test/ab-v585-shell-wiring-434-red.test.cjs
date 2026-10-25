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
const activeJs = source => source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
const liveScripts = source => [...source.replace(/<!--[\s\S]*?-->/g,'')
  .matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/g)]
  .map(match=>match[1]);
const count = (a,k) => a.filter(x=>x===k).length;


test('v585 #434: transactional helper is loaded by both readers, cached, and checksummed',()=>{
  const helperPath=path.join(docs,'estado-ab.js');
  assert.ok(fs.existsSync(helperPath),'BLOCK: private v585 journal helper absent; this must fail on v584');
  const helper=read('estado-ab.js');
  assert.match(activeJs(helper),/window\.OCEstadoAB\s*=\s*\{\s*crear\s*\}/,
    'journal helper must expose the expected browser contract');

  const index=read('index.html'),dash=read('dashboard.html');
  const indexScripts=liveScripts(index),dashScripts=liveScripts(dash);
  const idb='./estado-idb.js',journal='./estado-ab.js',backend='./mock-backend.js';
  for(const [file,scripts] of [['index.html',indexScripts],['dashboard.html',dashScripts]]){
    assert.equal(count(scripts,journal),1,file+' must load the journal as exactly one ACTIVE script');
    assert.ok(scripts.indexOf(idb)>=0 && scripts.indexOf(idb)<scripts.indexOf(journal),
      file+' must load IndexedDB dependency before the journal');
  }
  assert.ok(indexScripts.includes(backend) && indexScripts.indexOf(journal)<indexScripts.indexOf(backend),
    'app must load journal before its writer');
  const visibleDash=dash.replace(/<!--[\s\S]*?-->/g,'');
  assert.ok(visibleDash.indexOf('<script src="./estado-ab.js"></script>') < visibleDash.indexOf('function leerEstadoLocal()'),
    'Dashboard must load journal before recovery reader');

  const sw=read('sw.js');
  const shell=sw.match(/const SHELL\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(shell && shell[1].includes('"./estado-ab.js"'),
    'journal helper must be included in the PWA precache SHELL array');
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
