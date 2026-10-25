'use strict';
// Scoped UI regression: move the original rename buttons; don't reimplement identity.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.resolve(__dirname,'../docs/index.html'),'utf8');
const i18n=fs.readFileSync(path.resolve(__dirname,'../docs/i18n.js'),'utf8');
const header=html.slice(html.indexOf('<header>'),html.indexOf('</header>')+9);
const adv=html.slice(html.indexOf('<section id="vista-avanzado"'),html.indexOf('</section>',html.indexOf('<section id="vista-avanzado"'))+10);
const identity=adv.match(/<details id="oc-identity-settings"[^>]*>[\s\S]*?<\/details>/)?.[0]||'';

test('normal header shows both names without the edit controls',()=>{
  assert.match(header,/id="oc-negocio-nombre"/);
  assert.match(header,/id="oc-header-apodo-txt"/);
  assert.doesNotMatch(header,/id="oc-negocio-editar"/);
  assert.doesNotMatch(header,/id="oc-header-apodo-btn"/);
});

test('same store/device edit controls move once into a collapsed Advanced subsection',()=>{
  assert.match(identity,/<summary[^>]*data-i18n="adv.identityHeading"/);
  for(const id of ['oc-negocio-editar','oc-header-apodo-btn','oc-negocio-estado']){
    assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id+' duplicated');
    assert.ok(identity.includes('id="'+id+'"'),id+' must live in Advanced');
  }
  assert.doesNotMatch(identity,/<details[^>]*\sopen(?:\s|=|>)/);
  assert.match(identity,/data-i18n="adv.identityStore"/);
  assert.match(identity,/data-i18n="adv.identityDevice"/);
});

test('existing handlers and owner-only business rename guard remain intact',()=>{
  assert.match(html,/const btn = document\.getElementById\("oc-negocio-editar"\)/);
  assert.match(html,/const esDueno = window\.OCAuth && window\.OCAuth\.rolActual\(\) === "dueno"/);
  assert.match(html,/fetch\(`\$\{API\}\/instancia\/nombre`, \{ method: "POST"/);
  assert.match(html,/const apodoBtn = document\.getElementById\("oc-header-apodo-btn"\)/);
  assert.match(html,/window\.OCMicelio\.ponerApodo\(v\)/);
});

test('Advanced identity labels exist in both English and Spanish',()=>{
  for(const id of ['adv.identityHeading','adv.identityStore','adv.identityDevice']){
    assert.equal((i18n.match(new RegExp('"'+id+'"','g'))||[]).length,2,id+' must have EN and ES translations');
  }
});
