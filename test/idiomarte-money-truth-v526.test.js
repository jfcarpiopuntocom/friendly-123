// idiomARTE v526 — deterministic read-only finance examples, no client data/network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = require('./helpers/page-source.cjs').readFileSync(path.join(__dirname, '../docs/dashboard.html'), 'utf8');
const app = require('./helpers/page-source.cjs').readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
const model = require('../docs/core/business-read-model.js');
function extract(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, 'source span: ' + start);
  return source.slice(a,b);
}
function rows(sales) {
  const c = { datos:{ventas:sales}, window:{OCBusinessReadModel:model}, Number, Date, String, Object };
  vm.createContext(c);
  vm.runInContext(extract('  function filasEventos() {', '  /* ======================================================================\n     PESTANIA COMISIONES'), c);
  // Return plain records to test independently of VM prototypes.
  return JSON.parse(JSON.stringify(vm.runInContext('filasEventos()', c)));
}
const sale = (id, day, price, extra={}) => ({
  id, eventoNombre:'Painting class', eventoFecha:day,
  fecha:day+'T19:00:00-05:00', cantidad:1, precioUnit:price, costoUnit:4,
  comisionAsociado:price*0.8, netoCasa:price*0.2, comisionPct:80,
  tipoProducto:'ticket', ubicacionId:'shelf-one', ...extra
});
test('idiomARTE: repeated workshop names on DIFFERENT event days are different rows',()=>{
  const r=rows([sale('a','2026-10-11',15),sale('b','2026-10-12',18)]);
  assert.equal(r.length,2);
  assert.deepEqual(r.map(x=>x.fecha).sort(),['2026-10-11','2026-10-12']);
  assert.deepEqual(r.map(x=>x.recaudado).sort((a,b)=>a-b),[15,18]);
});
test('idiomARTE: same event date with multiple products still aggregates',()=>{
  const r=rows([sale('a','2026-10-11',15),sale('b','2026-10-11',18,{productoId:'p2'})]);
  assert.equal(r.length,1);
  assert.equal(r[0].recaudado,33);
  assert.equal(r[0].casa,6.6);
});
test('idiomARTE: cancelled and returned tickets never inflate net event sales',()=>{
  const r=rows([sale('a','2026-10-11',15),sale('b','2026-10-11',18,{devuelta:true}),sale('c','2026-10-11',12,{anulada:true})]);
  assert.equal(r.length,1);
  assert.equal(r[0].recaudado,15);
  assert.equal(r[0].comision,12);
  assert.equal(r[0].casa,3);
  assert.equal(r[0].devoluciones,1);
});
test('idiomARTE: an unknown price or product cost cannot become fake $0 profit',()=>{
  const r=rows([sale('a','2026-10-11',15),sale('b','2026-10-11',null,{costoUnit:null,comisionAsociado:null,netoCasa:null})]);
  assert.equal(r.length,1);
  assert.equal(r[0].recaudado,null);
  assert.equal(r[0].ganancia,null);
  assert.equal(r[0].comision,null);
  assert.equal(r[0].casa,null);
});
test('idiomARTE: refunded event cannot still show money earned',()=>{
  const r=rows([sale('a','2026-10-11',15,{devuelta:true})]);
  assert.equal(r.length,1);
  assert.equal(r[0].recaudado,0);
  assert.equal(r[0].casa,0);
  assert.equal(r[0].devoluciones,1);
});
test('idiomARTE: duplicated snapshot operation ID is never added twice',()=>{
  const v=sale('a','2026-10-11',15);
  assert.equal(rows([v,Object.assign({},v)]).at(0).recaudado,15);
});
test('idiomARTE: event display does not promise net house profit/actual cash from margin',()=>{
  assert.ok(source.includes('title: "Gross margin (before commissions and event expenses)"'));
  assert.ok(source.includes('title: "Net sales (not cash received)"'));
  assert.ok(source.includes('title: "House share (before costs and expenses)"'));
  assert.ok(!source.includes('{ title: "Profit", field: "ganancia"'));
});
test('idiomARTE: finance summary excludes deleted expenses and flags unknown amounts',()=>{
  const src=extract('  function pintarFinanzasFoto() {','  /* PERISCOPIO DE DATOS');
  const target={innerHTML:'',textContent:''};
  const c={datos:{
    gastos:[{id:'g1',concepto:'Paper',monto:12},{id:'g2',borrado:true,monto:200},{id:'g3',concepto:'Missing',monto:null}],
    transferencias:[],gastosMensuales:{gastosMensuales:50},hechosFinancieros:[],
    cobertura:{gastos:true,hechosFinancieros:true}
    }, $:()=>target,window:{OCBusinessReadModel:model},
    money:(n)=>n==null?'—':'$'+n,esc:(x)=>String(x),
    flechaComisionesMesHtml:()=>'',Object,Number,Array,String
  };
  vm.createContext(c);
  vm.runInContext(src+'\npintarFinanzasFoto();',c);
  assert.match(target.innerHTML,/Detailed expenses: <b>2<\/b>/);
  assert.match(target.innerHTML,/total <b>—<\/b>/);
  assert.match(target.innerHTML,/not added to expense totals/i);
  assert.doesNotMatch(target.innerHTML,/\$212\b/);
});
test('idiomARTE: Expenses overview never calls net sales minus expenses "house profit"',()=>{
  assert.ok(app.includes('marginLessExpensesCents'));
  assert.ok(app.includes('before commissions and unallocated expenses'));
  assert.ok(app.includes('gastos.filter((g) => !g.borrado &&'));
});
