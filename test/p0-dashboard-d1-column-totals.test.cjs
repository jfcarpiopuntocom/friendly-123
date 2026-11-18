'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../src/dashboard/dashboard-main.js'),'utf8');
function realColumns(){
  const begin=src.indexOf('  function columnasParaTabulator(v) {');
  const end=src.indexOf('\n  function pintarTabla() {',begin);
  assert.ok(begin>=0 && end>begin,'D1 must use a source-derived column adapter before rendering');
  assert.match(src,/columns:\s*columnasParaTabulator\(v\)/,
    'actual Tabulator renderer must wire the D1 adapter, not dormant helpers');
  const code=src.slice(begin,end)+'\ncolumnasParaTabulator';
  return vm.runInNewContext(code,{money:n=>n===null?'—':('$'+n.toFixed(2)),
    normalizar:s=>String(s==null?'':s).toLowerCase(),Number,Math,String,Object,RegExp,isFinite});
}
function definitions(){
  return [
    {field:'id',title:'',download:false,headerSort:false},
    {field:'productoNombre',title:'Product'},
    {field:'ubicacionNombre',title:'Shelf'},
    {field:'cantidad',title:'Qty.'},
    {field:'total',title:'Total'},
    {field:'precioUnit',title:'Price'},
    {field:'margen',title:'Margin'},
    {field:'saldo',title:'Balance'}
  ];
}
test('D1: all analytical source columns can filter, but action buttons stay inert',()=>{
  const fn=realColumns(),original=definitions();
  const cols=fn({cols:original});
  assert.equal(cols.length,original.length);
  assert.equal(cols[0].headerFilter,undefined,'action button must not become editable');
  for(const name of ['productoNombre','ubicacionNombre','cantidad','total','precioUnit'])
    assert.equal(cols.find(c=>c.field===name).headerFilter,'input',name);
  assert.equal(original[1].headerFilter,undefined,'existing VISTAS definitions remain immutable');
});
test('D1: footer only sums additive amounts and counts, never unit price or margin',()=>{
  const cols=realColumns()({cols:definitions()});
  assert.equal(typeof cols.find(c=>c.field==='total').bottomCalc,'function');
  assert.equal(typeof cols.find(c=>c.field==='saldo').bottomCalc,'function');
  assert.equal(typeof cols.find(c=>c.field==='cantidad').bottomCalc,'function');
  assert.equal(cols.find(c=>c.field==='precioUnit').bottomCalc,undefined);
  assert.equal(cols.find(c=>c.field==='margen').bottomCalc,undefined);
  assert.equal(cols.find(c=>c.field==='productoNombre').bottomCalc,undefined);
});
test('D1: filtered-row cents are additive, exact at 0.1+0.2, and refuse unknown coverage',()=>{
  const cols=realColumns()({cols:definitions()});
  const calc=cols.find(c=>c.field==='total').bottomCalc;
  assert.equal(calc([0.1,0.2]),0.3);
  assert.equal(calc([19.99,-2]),17.99);
  assert.equal(calc([0,0]),0);
  assert.equal(calc([]),null,'no rows do not imply observed zero');
  assert.equal(calc([10,null]),null,'a missing cost or total must not become 0');
  assert.equal(calc([10,'pending']),null);
  assert.equal(calc([10,NaN]),null);
  assert.equal(calc([Number.MAX_SAFE_INTEGER]),null,'overflow must not fabricate money');
  assert.equal(cols.find(c=>c.field==='total').bottomCalcFormatter({getValue:()=>null}),'—');
});
test('D1: numeric range 2..5 works without changing the global search',()=>{
  const cols=realColumns()({cols:definitions()});
  const qty=cols.find(c=>c.field==='cantidad');
  assert.equal(typeof qty.headerFilterFunc,'function');
  assert.equal(qty.headerFilterFunc('2..5',2),true);
  assert.equal(qty.headerFilterFunc('2..5',5),true);
  assert.equal(qty.headerFilterFunc('2..5',6),false);
  assert.equal(qty.headerFilterFunc('2..5',null),false);
  assert.equal(qty.headerFilterFunc('-2..2',-1),true);
  assert.equal(qty.headerFilterFunc('3',13),true,'plain search retains substring filtering');
  assert.equal(qty.headerFilterFunc('',null),true);
});
test('D1: sum of visible filtered rows, no stale off-screen values',()=>{
  const col=realColumns()({cols:definitions()}).find(c=>c.field==='total');
  const rows=[
    {ubicacionNombre:'Shelf 1',total:12.75},
    {ubicacionNombre:'Shelf 2',total:999},
    {ubicacionNombre:'Shelf 1',total:3.25}
  ];
  const visible=rows.filter(r=>r.ubicacionNombre==='Shelf 1');
  assert.equal(col.bottomCalc(visible.map(r=>r.total)),16);
  assert.equal(col.bottomCalc(rows.map(r=>r.total)),1015);
});

test('D1 official compiled JS and version manifest match the distributable source (no manual hashes)',()=>{
  const crypto=require('node:crypto');
  const base=path.join(__dirname,'../docs');
  const manifest=JSON.parse(fs.readFileSync(path.join(base,'version-manifest.json'),'utf8'));
  for(const file of ['dashboard-main.min.js','dashboard-main.min.css']){
    const bytes=fs.readFileSync(path.join(base,file),'utf8').replace(/\r\n/g,'\n');
    const digest='sha256-'+crypto.createHash('sha256').update(bytes,'utf8').digest('hex');
    assert.equal(manifest.files['./'+file],digest,'official manifest must seal '+file);
  }
  const bundled=fs.readFileSync(path.join(base,'dashboard-main.min.js'),'utf8');
  assert.match(bundled,/columnasParaTabulator/,'compiled asset must include live D1 renderer');
  assert.match(fs.readFileSync(path.join(base,'dashboard.html'),'utf8'),
    /<script\s+src="\.\/dashboard-main\.min\.js"><\/script>/,
    'the released page must load exactly the generated JS');
});
