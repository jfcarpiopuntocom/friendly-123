'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {plan,run}=require('../docs/owner-approved-inventory-repair.js');
const read=p=>fs.readFileSync(path.join(__dirname,'../docs',p),'utf8');

test('P0 no snapshot quantity can become an automatic stock target',()=>{
  for(const amounts of [[7,7,7],[3,4,16],[0,1,99],[17,22,333]]) {
    const catalog={productos:amounts.map((stockActual,i)=>({id:'synthetic-'+i,stockActual}))};
    assert.equal(plan(catalog),null);
  }
  assert.equal(plan(null),null);
});

test('P0 no automatic write, audit, marker or adjustment even when owner authorized',async()=>{
  let writes=0;
  const deps={
    authorized:()=>true,done:()=>false,catalog:()=>({productos:[{id:'synthetic-1',stockActual:7}]}),
    adjust:async()=>{writes++;throw Error('automatic inventory write attempted');},
    audit:async()=>{writes++;throw Error('audit side effect attempted');},
    finish:async()=>{writes++;throw Error('completion side effect attempted');}
  };
  assert.deepEqual(await run(deps),{changed:0,skipped:'automatic-reconciliation-disabled'});
  assert.equal(writes,0);
});

test('P0 script installs no browser listeners or timer-driven writes',()=>{
  const src=read('owner-approved-inventory-repair.js');
  let listeners=0,writes=0;
  const window={
    addEventListener(){listeners++;},
    fetch(){writes++;throw Error('forbidden network write');},
    setTimeout(){writes++;throw Error('forbidden timer');},
    OCTienda:{licenciaActual:()=>{throw Error('identity must not be consulted');}}
  };
  vm.runInNewContext(src,{window,document:{readyState:'complete',addEventListener(){listeners++;}}});
  assert.equal(listeners,0);
  assert.equal(writes,0);
  assert.doesNotMatch(src,/\bTARGET\s*=|\btarget\s*:\s*7\b|\bdelta\s*:\s*7\s*-/);
  assert.doesNotMatch(src,/\/api\/productos\/|\.adjust\(|fetch\(/);
});

test('P0 deployed safety no-op has matching manifest and cache guard',()=>{
  const script=read('owner-approved-inventory-repair.js');
  const manifest=JSON.parse(read('version-manifest.json'));
  const sha='sha256-'+crypto.createHash('sha256').update(script,'utf8').digest('hex');
  assert.equal(manifest.files['./owner-approved-inventory-repair.js'],sha);
  assert.match(script,/automatic-reconciliation-disabled/);
  const sw=read('sw.js'),html=read('index.html');
  assert.match(sw,/url\.pathname\.endsWith\("\/owner-approved-inventory-repair\.js"\)/);
  assert.match(sw,/automatic stock repair retired/);
  assert.match(html,/defer src="\.\/owner-approved-inventory-repair\.js"/);
  const version=JSON.parse(read('version.json'));
  assert.equal(manifest.version,version.version);
  assert.match(sw,new RegExp('const CACHE = "'+version.shell+'"'));
});
