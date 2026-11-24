'use strict';
// C251 owner correction supersedes C226's erroneous single-select contract.
// Test the ACTUAL served after-bundle module, not the obsolete pre-override
// cambiarRangoComisionesGlobal function in source app-inline-01.js.
const {test}=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), vm=require('node:vm');
const person=fs.readFileSync('docs/commissions-by-person.js','utf8');
const begin=person.indexOf('  /* C251 JFC 23-nov: independent, combinable Commissions view toggles.');
const end=person.indexOf('  var original=root.cambiarVistaComisiones;',begin);
assert.ok(begin>0&&end>begin,'C251 additive module exists after bundle');
const block=person.slice(begin,end);
function harness(initial) {
  var reloads=0;
  const root={_ocComHistoryGroup:initial||'producto',
    resumenComisionesGlobalHtml(){return '<section data-commissions-summary="all"></section>';},
    cambiarRangoComisionesGlobal(){throw Error('legacy exclusive toggle invoked');},
    cargarComisiones(){reloads++;}};
  const container={querySelector(){return null;},querySelectorAll(){return [];}};
  const ctx={root,container,document:{},tx:(es)=>es,setMode(){}};
  vm.createContext(ctx);vm.runInContext(block,ctx);
  return {root,reloads:()=>reloads};
}
test('C251: toggling Product + Customer keeps both selected, then only the pressed button is released',()=>{
  const h=harness();
  h.root.cambiarRangoComisionesGlobal('grupo','cliente');
  assert.deepEqual(Array.from(h.root._ocComHistoryGroups),['producto','cliente']);
  h.root.cambiarRangoComisionesGlobal('grupo','producto');
  assert.deepEqual(Array.from(h.root._ocComHistoryGroups),['cliente']);
  assert.equal(h.root._ocComHistoryGroup,'cliente');
  h.root.cambiarRangoComisionesGlobal('grupo','mes');
  assert.deepEqual(Array.from(h.root._ocComHistoryGroups),['cliente','mes']);
  assert.equal(h.reloads(),3);
});
test('C251: no group selected means RAW, all five groups can be independently on',()=>{
  const h=harness();
  h.root.cambiarRangoComisionesGlobal('grupo','total');
  assert.deepEqual(Array.from(h.root._ocComHistoryGroups),[]);
  assert.equal(h.root._ocComHistoryGroup,'total');
  for(const group of ['producto','percha','cliente','comisionista','mes'])
    h.root.cambiarRangoComisionesGlobal('grupo',group);
  assert.deepEqual(Array.from(h.root._ocComHistoryGroups),
    ['producto','percha','cliente','comisionista','mes']);
  h.root.cambiarRangoComisionesGlobal('grupo','percha');
  assert.deepEqual(Array.from(h.root._ocComHistoryGroups),
    ['producto','cliente','comisionista','mes']);
});
test('C251: By artist does not release global toggles in All dates; keeps monthly behavior',()=>{
  assert.match(person,/if \(person && period\(\)\) container\.querySelectorAll\('\[data-commissions-view-global\]'\)/);
  assert.match(person,/if \(person && period\(\)\) \{\s*container\.querySelectorAll\('\[data-commissions-section\]'\)/);
  assert.match(person,/\/\/ Toggling Person off leaves every other group switch unchanged/);
  assert.match(person,/bar\.setAttribute\('aria-multiselectable','true'\)/);
});
test('C251: multi grouping keys details by [group,id] and uses only one financial summary header',()=>{
  assert.match(person,/var parts=\[\],detailRows=new Map\(\)/);
  assert.match(person,/JSON\.stringify\(\[g,oldKey\]\)/);
  assert.match(person,/if \(i===0\) \{\s*parts\.push\(panel\.outerHTML\)/);
  assert.match(person,/var title=panel\.querySelector\('h3\.seccion'\)/);
  assert.doesNotMatch(block,/(fetch\(|localStorage\.setItem|indexedDB|caches\.delete)/,
    'selection is read-only and must not write commercial money or offline stores');
});
