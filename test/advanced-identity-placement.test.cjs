'use strict';
// Scoped UI regression: move the original rename buttons; don't reimplement identity.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
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

test('device pencil stays hidden until login and hides after logout',()=>{
  assert.match(identity,/<div id="oc-advanced-device-edit" style="display:none;">/,
    'the device pencil must not become visible before a session');
  const start=html.indexOf('  function pintarApodoHeader() {');
  const end=html.indexOf('  const apodoBtn = document.getElementById("oc-header-apodo-btn");',start);
  assert.ok(start>0&&end>start,'extract real device presentation function');
  const wrap={style:{display:'none'}}, txt={textContent:''}, row={style:{display:'none'}};
  const dom={
    'oc-header-apodo':wrap,'oc-header-apodo-txt':txt,'oc-advanced-device-edit':row
  };
  let role=null;
  const context={document:{getElementById:id=>dom[id]||null},
    window:{OCMicelio:{miApodo:()=>'Synthetic tablet'},
      OCAuth:{rolActual:()=>role},
      tf:(key,values)=>key+':'+values.name,t:key=>key}};
  vm.createContext(context);
  vm.runInContext(html.slice(start,end)+';this.paint=pintarApodoHeader;',context);
  assert.equal(row.style.display,'none','no automatic visibility before login');
  role='dueno';
  context.paint(); // this is what the existing oc-login handler invokes
  assert.equal(row.style.display,'block','session rendering exposes editor in Advanced');
  assert.equal(wrap.style.display,'block','existing device header remains visible');
  assert.equal(txt.textContent,'device.current:Synthetic tablet');
  const logoutStart=html.indexOf('window.addEventListener("oc-logout", () => { btn.style.display');
  const logoutEnd=html.indexOf(');\n  function pintarApodoHeader()',logoutStart);
  assert.ok(logoutStart>0&&logoutEnd>logoutStart,'extract real logout listener');
  const scope={...context,btn:{style:{display:'inline-block'}}};
  scope.attach=(name,fn)=>{assert.equal(name,'oc-logout');fn();};
  vm.createContext(scope);
  vm.runInContext(html.slice(logoutStart,logoutEnd+2).replace('window.addEventListener','this.attach'),scope);
  assert.equal(row.style.display,'none','logout must hide moved device editor');
  assert.equal(wrap.style.display,'none','logout must hide device header');
  role=null;
  context.paint(); // late micelio or language event after logout
  assert.equal(row.style.display,'none','background repaint must not resurrect an edit pencil');
});

test('store pencil retains original owner-only, non-demo guard',()=>{
  const start=html.indexOf('  function actualizarLapiz() {');
  const end=html.indexOf('  btn.addEventListener("click"',start);
  assert.ok(start>0&&end>start,'extract real owner guard');
  const source=html.slice(start,end);
  for(const spec of [
    {role:'dueno',demo:false,expected:'inline-block'},
    {role:'dueno',demo:true,expected:'none'},
    {role:'admin',demo:false,expected:'none'},
    {role:'empleado',demo:false,expected:'none'}
  ]){
    const btn={style:{display:'none'}};
    const context={btn,window:{OCAuth:{
      rolActual:()=>spec.role,esDemo:()=>spec.demo
    }}};
    vm.createContext(context);
    vm.runInContext(source+';this.update=actualizarLapiz;',context);
    context.update();
    assert.equal(btn.style.display,spec.expected,
      spec.role+' demo='+spec.demo+' must retain the original business rename policy');
  }
});
