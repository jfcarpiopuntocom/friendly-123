'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const srcPath = path.join(__dirname, '../docs/commissions-by-person.js');
function load() {
  const src = fs.readFileSync(srcPath, 'utf8');
  const ctx = { window: {}, document: { getElementById: () => null }, console };
  ctx.window.window = ctx.window;
  vm.runInNewContext(src, ctx, { filename: srcPath });
  assert.ok(ctx.window.F123CommissionsByPerson);
  return { api: ctx.window.F123CommissionsByPerson, src };
}
const money = (id, name, earned, paid, due, held=0) => ({payeeId:id,nombre:name,earned,paid,due,held});
const rack = (id,name, balances, options={}) => Object.assign({ubicacionId:id,ubicacion:name,payoutBalances:balances},options);
test('one identity in two racks is one beneficiary; keep signed credit, paid and hold in cents', () => {
  const { api } = load();
  const data = [
    rack('u1','Books',[money('a','Ana',85.10,25.10,55,5),money('b','Beto',20,5,15)]),
    rack('u2','Posters',[money('a','Ana',34.40,10,24.40)]),
  ];
  const grouped = api.group(data);
  assert.equal(grouped.people.length,2);
  const ana = grouped.people.find(x=>x.id==='a');
  assert.equal(ana.deals.length,2);
  assert.equal(JSON.stringify([ana.total.earned,ana.total.paid,ana.total.due,ana.total.held]),JSON.stringify([11950,3510,7940,500]));
  const beto = grouped.people.find(x=>x.id==='b');
  assert.equal(JSON.stringify([beto.total.earned,beto.total.paid,beto.total.due]),JSON.stringify([2000,500,1500]));
});
test('same name with distinct immutable payee IDs must never merge', () => {
  const g=load().api.group([rack('u1','A',[money('a','Alex',10,0,10),money('b','Alex',20,0,20)])]);
  assert.equal(g.people.length,2);
  assert.equal(JSON.stringify(g.people.map(x=>x.id).sort()),JSON.stringify(['a','b']));
});
test('invalid / incomplete monetary source stays unknown, never made up as zero', () => {
  const g=load().api.group([rack('u1','A',[money('a','Ana',null,4,undefined)])]);
  assert.equal(g.people[0].total.earned,null);
  assert.equal(g.people[0].total.due,null);
  assert.equal(g.people[0].total.paid,400);
  assert.equal(g.people[0].deals[0].payable,false);
});
test('review/conflicts forbid presenting a person-rack row as payable', () => {
  const g=load().api.group([rack('u1','A',[money('a','Ana',100,10,90)],{needsReview:true})]);
  assert.equal(g.people[0].deals[0].payable,false);
  assert.equal(g.people[0].needsReview,true);
});
test('unassigned and legacy racks do not acquire guessed cross-rack beneficiary identities', () => {
  const g=load().api.group([rack('u1','A',[money(null,'Ana',10,0,10)]),rack('u2','B',[])]);
  assert.equal(g.people.length,0);
  assert.equal(g.unverified.length,2);
});
test('read-only UI exposes first-class person grouping above, preserves month and existing per-rack pay action', () => {
  const {src}=load();
  assert.match(src,/data-commissions-view/);
  assert.match(src,/data-commissions-month/);
  assert.match(src,/data-commissions-section/);
  assert.match(src,/marcarComisionPagada/);
  assert.doesNotMatch(src, /fetch\([^)]*,\s*\{[^}]*method:\s*['"](POST|PUT|DELETE)/i);
  const html=fs.readFileSync(path.join(__dirname,'../docs/index.html'),'utf8');
  assert.match(html,/\.\/commissions-by-person\.js/);
  const sw=fs.readFileSync(path.join(__dirname,'../docs/sw.js'),'utf8');
  assert.match(sw,/\.\/commissions-by-person\.js/);
});
