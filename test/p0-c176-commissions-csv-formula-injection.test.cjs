'use strict';
// C176 OWASP ASVS V1.2.10 / CWE-1236: real Commissions CSV source and minified
// assets must treat customer/product/associate/rack names as TEXT, not formulas.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const samples=['=1+1','+HYPERLINK("https://invalid.example","Click")','-CMD()','@SUM(A1:A3)',' ＝1+1','\t=1+1','\n=2+2','＝2+2','＠SUM(A1:A3)'];
function helpers(file){
 const source=fs.readFileSync(path.join(root,file),'utf8');
 const start=source.indexOf('async function exportarComisionesTotalCSV(){');
 const middle=source.indexOf('async function exportarComisionesCSV(){',start);
 assert.ok(start>0&&middle>start);
 const startGlobal=source.indexOf('const csvValue=',start);
 const endGlobal=file.startsWith('src/')?source.indexOf('\n    const rows=',startGlobal):source.indexOf(',rows=[[',startGlobal);
 const startMonth=source.indexOf(file.startsWith('src/')?'const esc =':'const esc=',middle);
 const endMonth=file.startsWith('src/')?source.indexOf('\n  const cab =',startMonth):source.indexOf(',cab=[',startMonth);
 assert.ok(startGlobal>start&&endGlobal>startGlobal&&startMonth>middle&&endMonth>startMonth);
 return {csvValue:new Function(source.slice(startGlobal,endGlobal)+';return csvValue;')(),
  esc:new Function(source.slice(startMonth,endMonth)+';return esc;')()};
}
for(const file of ['src/app/app-inline-01.js','docs/app-inline-01.min.js']){
 test('C176 formula-injection-safe CSV from actual '+file,()=>{
  const h=helpers(file);
  for(const v of samples){
   const output=h.csvValue(v,2);
   assert.ok(output.startsWith('"\t'),JSON.stringify({file,v,output}));
   assert.ok(output.endsWith('"'));
   assert.equal(h.esc(v),output,'monthly CSV text must use the same neutralization');
  }
  for(const v of ['genuine product','P-001','2026-11-21','quoted, "product"']){
   const a=h.csvValue(v,2),b=h.esc(v);
   assert.doesNotMatch(a,/^"\t/,'non-formula customer labels stay untouched');
   assert.equal(a,b,'same RFC4180 quoting');
  }
  assert.equal(h.csvValue('-5.00',3),'-5.00','legitimate negative monetary value stays numeric');
  assert.equal(h.csvValue('0.00',4),'0.00');
  assert.equal(h.csvValue('5.20',3),'5.20');
  assert.equal(h.csvValue('=1+1',0),'"\t=1+1"','date/ID columns also remain inert text');
  assert.equal(h.csvValue('=1+1',1),'"\t=1+1"');
  const escaped=h.csvValue('=HYPERLINK("https://invalid.example","Click")',2);
  assert.equal(escaped,'"\t=HYPERLINK(""https://invalid.example"",""Click"")"');
 });
}
test('C176 both app paths retain C175 date-range refusal before fetch',()=>{
 for(const f of ['src/app/app-inline-01.js','docs/app-inline-01.min.js']){
  const s=fs.readFileSync(path.join(root,f),'utf8');
  const block=s.slice(s.indexOf('async function exportarComisionesTotalCSV()'),s.indexOf('async function exportarComisionesCSV()'));
  assert.ok(block.indexOf('if(from&&to&&from>to)')<block.indexOf('/ventas/todas?ubicacionId=todas'));
  assert.match(block,/report\.invalidRange/);
 }
});
