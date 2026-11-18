const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function period(){
  const box={module:{exports:{}},globalThis:{}};vm.runInNewContext(read('docs/core/report-period.js'),box);
  return box.module.exports;
}
test('D2 local business calendar bounds and invalid days cannot leak UTC or wrong month',()=>{
  const p=period();assert.equal(typeof p.quick,'function');
  const cases=[
    ['today','2026-03-01',null,null,'2026-03-01','2026-03-01'],
    ['yesterday','2026-03-01',null,null,'2026-02-28','2026-02-28'],
    ['yesterday','2028-03-01',null,null,'2028-02-29','2028-02-29'],
    ['7d','2026-12-03',null,null,'2026-11-27','2026-12-03'],
    ['lastMonth','2027-01-02',null,null,'2026-12-01','2026-12-31'],
    ['lastMonth','2028-03-31',null,null,'2028-02-01','2028-02-29'],
    ['thisMonth','2026-10-31',null,null,'2026-10-01','2026-10-31'],
    ['custom','2026-11-17','2026-11-01','2026-11-17','2026-11-01','2026-11-17']
  ];
  for(const [kind,today,from,to,a,b] of cases) assert.deepEqual(JSON.parse(JSON.stringify(p.quick(kind,today,from,to))),{from:a,to:b});
  for(const [kind,today,from,to] of [
    ['today','2026-02-30'],['today','2026-13-01'],['custom','2026-11-17','2026-11-18','2026-11-01'],
    ['custom','2026-11-17','2026-02-30','2026-11-17'],['custom','2026-11-17','2026-11-01','2026-02-30'],
    ['INVALID','2026-11-17'],['today','bad']])assert.equal(p.quick(kind,today,from,to),null);
});
test('D2 dashboard sales, shared finance selector and only approved translations',()=>{
  const src=read('src/dashboard/dashboard-main.js');
  const finance=read('docs/dashboard-finance.js');
  assert.match(src,/function periodoRapido\s*\(/);
  assert.match(src,/var p = periodoRapido\(\)/);
  assert.match(src,/filter\(function\s*\(v\)\s*\{\s*return enPeriodo\(v,\s*p\)/);
  assert.match(src,/montarPeriodoRapido\(\)/);
  assert.match(src,/window\.OCDashPeriodo\s*=\s*periodoRapido/);
  assert.match(finance,/window\.OCDashPeriodo\s*&&\s*window\.OCDashPeriodo\(\)/);
  for(const [en,es] of [['Yesterday','Ayer'],['7 days','7 días'],['This month','Este mes'],['Last month','Mes anterior'],['Pick dates','Elegir fechas']])
    assert.ok(src.includes(JSON.stringify([en,es])),en);
});
test('D2 business date extraction is zone-local, not UTC',()=>{
  const src=read('src/dashboard/dashboard-main.js');
  assert.match(src,/OCBusinessReadModel\.day\(new Date\(\)\.toISOString\(\),\s*zonaNegocioDashboard\(\)\)/);
  const localeDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date('2026-11-01T01:30:00Z'));
  assert.equal(localeDay,'10/31/2026');
  assert.deepEqual(JSON.parse(JSON.stringify(period().quick('thisMonth','2026-10-31'))),{from:'2026-10-01',to:'2026-10-31'});
});
