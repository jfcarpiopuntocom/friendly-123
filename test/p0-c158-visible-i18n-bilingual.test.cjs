'use strict';
// C158: source-executed bilingual output, no business data or mock snapshots.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'../docs');
const source=p=>fs.readFileSync(path.join(root,p),'utf8');
function load(lang){
  const rows=['pair.button','pair.caption','log.heading','log.description','log.load','log.when','log.who','log.what','adv.backup.duplicatePwa','adv.backup.noBrowserErase','sync.joinAnother','footer.and','loader.failed']
    .map(k=>({key:k, textContent:'',getAttribute(name){return name==='data-i18n'?k:null;}}));
  const values=new Map([['f123_lang',lang]]);
  const localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  const document={
    documentElement:{lang:'en'},title:'',
    addEventListener(){},querySelectorAll(sel){return sel==='[data-i18n]'?rows:[];},
    querySelector(){return null;}
  };
  const ctx={localStorage,document,navigator:{language:'en-US'},CustomEvent:function(n,o){this.type=n;this.detail=o.detail;},dispatchEvent(){}};
  ctx.window=ctx;
  vm.runInNewContext(source('i18n.js'),ctx,{filename:'i18n.js',timeout:2000});
  return {lang:ctx.window.OCI18n,rows,document};
}
test('C158: pair/backup/activity/footer/loader labels resolve in actual EN and ES dictionaries, not raw keys',()=>{
  const en=load('en'),es=load('es');
  for(const row of en.rows){
    const key=row.key;
    const a=en.lang.t(key),b=es.lang.t(key);
    assert.notEqual(a,key,'EN raw key: '+key);
    assert.notEqual(b,key,'ES raw key: '+key);
    assert.ok(a&&b,'missing key '+key);
  }
  assert.equal(en.lang.t('pair.button'),'Link a new device');
  assert.equal(es.lang.t('pair.button'),'Vincular un aparato nuevo');
  assert.equal(en.lang.t('footer.and'),'and');
  assert.equal(es.lang.t('footer.and'),'y');
  assert.equal(en.lang.t('loader.failed'),'Failed to load');
  assert.equal(es.lang.t('loader.failed'),'No se pudo cargar');
});
test('C158: live language toggle repaints injected data-i18n elements without recreating business panel',()=>{
  const x=load('en');
  x.lang.applyStatic();
  assert.equal(x.rows.find(r=>r.key==='pair.button').textContent,'Link a new device');
  x.lang.setLang('es');
  assert.equal(x.document.documentElement.lang,'es');
  assert.equal(x.rows.find(r=>r.key==='pair.button').textContent,'Vincular un aparato nuevo');
  assert.equal(x.rows.find(r=>r.key==='log.load').textContent,'Cargar historial');
  x.lang.setLang('en');
  assert.equal(x.rows.find(r=>r.key==='log.load').textContent,'Load history');
});
test('C158: only visible UI text and translation markers changed; old Spanish-only copies gone',()=>{
  const av=source('avanzado-extra.js'),index=source('index.html'),loader=source('cargador.js');
  for(const k of ['pair.button','pair.caption','log.heading','log.description','log.load','adv.backup.duplicatePwa','sync.joinAnother'])
    assert.ok(av.includes('data-i18n="'+k+'"'),'missing dynamic i18n marker '+k);
  assert.match(av,/window\.OCI18n\.applyStatic\(logPanel\)/);
  assert.match(av,/window\.OCI18n\.applyStatic\(respaldo\)/);
  assert.ok(!av.includes('Últimos 100 movimientos registrados en este dispositivo.'));
  assert.ok(!av.includes('>Cargar historial\n'));
  assert.ok(av.includes('window.OCI18n.locale()'),'dates must obey selected EN/ES locale');
  assert.match(index,/<span data-i18n="footer\.and">and<\/span>/);
  assert.match(loader,/global\.t\("loader\.failed"/);
  assert.ok(!loader.includes('estado.error = "no cargo "'));
});
