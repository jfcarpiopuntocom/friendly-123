'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {publicVersionFromShell}=require('../scripts/public-version.cjs');
const docs=p=>fs.readFileSync(path.join(__dirname,'../docs',p),'utf8');
test('public pre-1.0 labels track real shell and rollover',()=>{
  for(const [shell,label] of [
    ['f123-shell-v706','v0.7.06'],['f123-shell-v707','v0.7.07'],
    ['f123-shell-v708','v0.7.08'],['f123-shell-v709','v0.7.09'],
    ['f123-shell-v710','v0.7.10'],['f123-shell-v799','v0.7.99'],
    ['f123-shell-v800','v0.8.00']])
    assert.equal(publicVersionFromShell(shell),label);
  for(const value of ['','shell v708','f123-shell-vabc','f123-shell-v1000']) assert.throws(()=>publicVersionFromShell(value));
});
test('public gate, dashboard and JSON are consistent without renaming SW identity',()=>{
  const v=JSON.parse(docs('version.json')), html=docs('dashboard.html');
  const visible=publicVersionFromShell(v.shell);
  assert.equal(v.version,visible);
  assert.equal(v.releaseName,visible);
  assert.ok(html.includes('name="dashboard-release" content="'+visible+'"'));
  assert.ok(html.includes('>Dashboard '+visible+'</span>'));
  assert.ok(docs('sw.js').includes('const CACHE = "'+v.shell+'"'));
  assert.ok(docs('auth-ui.js').includes('versionVisible(shellServidor)'));
  assert.ok(docs('avanzado-extra.js').includes('var visible = n >= 100'));
});
