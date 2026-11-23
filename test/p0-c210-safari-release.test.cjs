'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const sw=read('docs/sw.js'),auth=read('docs/auth-ui.js'),rescue=read('docs/reenganchar.html');
const version=JSON.parse(read('docs/version.json'));
test('C210 RED v890 -> current network-first shell: document navigations bypass old cache-first shell',()=>{
 const old=execFileSync('git',['show','ba2b88bd294aca737778da56499db79da489eda0:docs/sw.js'],{cwd:root,encoding:'utf8'});
 assert.match(old,/const esArchivoDelShell = !url\.search && SHELL\.some/,'repro: real v890 cached the index forever');
 assert.match(old,/\.then\(\(local\) => local \|\| fetch\(evento\.request/,'repro: cached entry wins over new HTML');
 assert.match(sw,/evento\.request\.mode !== "navigate" && !url\.search && SHELL\.some/,'new SW network-revalidates navigations');
 assert.match(sw,/evento\.request\.mode === "navigate"/,'offline fallback still retains certified index');
 assert.ok(sw.includes('const CACHE = "'+version.shell+'";'));
 assert.ok(sw.includes('const CACHE_GENERACION = "-'+version.cacheGeneration+'";'));
});
// C216 (JFC 22 nov 2026): no extra yellow rehook button; recovery is the original "Emergency recovery" at the bottom.
test('C216: PIN gate has NO extra yellow rehook button and keeps the original Emergency recovery',()=>{
 assert.ok(!/<a id="oc-reenganche-btn"/.test(auth),'yellow oc-reenganche-btn must not be rendered');
 assert.ok(!/getElementById\('oc-reenganche-btn'\)/.test(auth),'no label code for the removed button');
 const purge=auth.indexOf('<details id="oc-gate-purge"');
 assert.ok(purge>0,'Emergency recovery block is still rendered');
 assert.match(auth.slice(purge,purge+600),/Emergency recovery/);
});
test('C210: standalone Safari rescue uses a single cache-busted navigation without deleting notebook storage',()=>{
 assert.match(rescue,/navigator\.serviceWorker\.getRegistrations\(\)/);
 assert.match(rescue,/regs\[i\]\.unregister\(\)/);
 assert.match(rescue,/caches\.delete\(names\[j\]\)/);
 assert.match(rescue,/location\.replace\(target\)/);
 assert.match(rescue,/\?_purge=/);
 assert.match(rescue,/a\[hidden\]\{display:none\}/);
 assert.doesNotMatch(rescue,/(?:localStorage|sessionStorage|indexedDB)\.(?:clear|deleteDatabase)\s*\(/);
 assert.doesNotMatch(rescue,/location\.reload\s*\(/);
});
test('C210: release identity is consistent with previous accepted shell contract',()=>{
 assert.match(version.version,/^v\d+\.\d+\.\d+$/);
 assert.match(version.shell,/^f123-shell-v\d+$/);
 assert.match(version.cacheGeneration,/^golden\d+$/);
 assert.ok(read('docs/dashboard.html').includes('name="dashboard-release" content="'+version.version+'"'));
 assert.ok(read('docs/dashboard.html').includes('name="dashboard-shell" content="'+version.shell+'"'));
});

test('C210: exact shipped manifest hashes match the final HTML/CSS/JS and Dashboard bytes',()=>{
  const m=JSON.parse(read('docs/version-manifest.json'));
  assert.equal(m.shell,version.shell);
  assert.equal(m.version,version.version);
  const assets=['./index.html','./ui2.css','./auth-ui.min.js','./app-inline-03.min.js','./dashboard.html'];
  for(const rel of assets){
    const raw=fs.readFileSync(path.join(root,'docs',rel.slice(2)));
    const actual='sha256-'+crypto.createHash('sha256').update(raw).digest('hex');
    assert.equal(m.files[rel],actual,'official manifest seals '+rel);
  }
});
