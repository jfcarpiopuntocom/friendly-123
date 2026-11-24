'use strict';
// C194: Safari memory pressure on entering Commissions: all-history stays complete,
// but collapsed receipt details must not allocate thousands of DOM nodes.
// Executed from real source, not a replica of the presenter.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../src/app/app-inline-01.js'),'utf8');
const ledger=require('../docs/core/commission-history.js');
const start=src.indexOf('function resumenComisionesGlobalHtml(');
const end=src.indexOf('async function cargarComisiones(){',start);
assert.ok(start>0&&end>start,'real Commissions presenter');
const sales=Array.from({length:12000},(_,i)=>({
  id:'receipt-'+i,fechaLocal:'2026-11-'+String(1+i%28).padStart(2,'0'),
  productoId:'p'+(i%240),productoNombre:'Producto '+(i%240),
  ubicacionId:'rack'+(i%10),ubicacionNombre:'Rack '+(i%10),
  clienteId:'client'+(i%100),clienteNombre:'Cliente '+(i%100),
  promotoraId:'seller'+(i%20),asociadoNombre:'Vendedor '+(i%20),
  cantidad:1,precioUnit:10,comisionAsociado:2
}));
function create(){
  const win={OCCommissionHistory:ledger,_ocComHistoryGroup:'producto'};
  const context={
    window:win,document:{documentElement:{lang:'es'}},
    escHtml:s=>String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),
    fmtMoney:n=>'$'+Number(n).toFixed(2)
  };
  vm.runInNewContext(src.slice(start,end)+';this.present=resumenComisionesGlobalHtml;this.expand=mostrarDetalleComisiones;',context);
  return context;
}
test('C194: 12,000 sales, 240 groups: initial HTML is bounded, total money exact, every receipt retained',()=>{
  const ctx=create();
  const startTime=performance.now();
  const html=ctx.present(sales);
  const elapsed=performance.now()-startTime;
  assert.ok(elapsed<4000,'source report must not lock browser thread for several seconds: '+elapsed.toFixed(0)+'ms');
  assert.ok(html.length<400000,'closed cards must not eagerly instantiate 12,000 receipts: '+html.length);
  assert.equal((html.match(/data-comm-history-group/g)||[]).length,60,'initial mount is strictly capped at 60 cards for WebKit memory');
  assert.equal((html.match(/data-comm-details data-loaded="0"/g)||[]).length,60);
  assert.equal(ctx.window._ocComGroupsTotal,240,'all 240 groups are retained');
  assert.match(html,/Mostrar más \(180 restantes\)/);
  assert.match(html,/Total de comisiones/);
  assert.match(html,/\$24000\.00/);
  assert.match(html,/\$120000\.00/);
  assert.ok(!html.includes('receipt-11999'),'rows are loaded on user expand, not discarded');
  const grouped=ctx.window._ocComHistoryRowsPorGrupo;
  assert.equal(grouped.size,240);
  let count=0;for(const items of grouped.values())count+=items.length;
  assert.equal(count,12000,'ALL sales remain available for expansion');
});
test('C194: expand is bounded to 80, show-more exposes every receipt, no implicit month filter',()=>{
  const ctx=create();
  ctx.present(sales);
  const target={dataset:{loaded:'0'},chunks:[],insertAdjacentHTML(_where,html){this.chunks.push(html)}};
  const more={hidden:true};
  const panel={open:true,isConnected:true,dataset:{commGroup:'p1'},
    querySelector(selector){return selector==='[data-comm-details]'?target:selector==='[data-comm-history-more]'?more:null}};
  ctx.expand(panel,false);
  assert.equal(target.dataset.loaded,'50');
  assert.equal(target.chunks.length,1);
  assert.equal((target.chunks.join('').match(/<div style="padding:6px/g)||[]).length,50);
  assert.equal(more.hidden,true);
  const values=ctx.window._ocComHistoryRowsPorGrupo.get('p1');
  assert.equal(values.length,50);
  assert.equal(values[0].day,'2026-11-02');
  assert.equal(values.at(-1).day.length,10);
});
test('C194: large single-product history is incrementally inspectable, max 80 DOM rows per gesture',()=>{
  const ctx=create();
  const many=sales.map(x=>({...x,productoId:'all',productoNombre:'All receipts'}));
  const html=ctx.present(many);
  assert.equal((html.match(/data-comm-history-group/g)||[]).length,1);
  const target={dataset:{loaded:'0'},chunks:[],insertAdjacentHTML(_where,part){this.chunks.push(part)}};
  const more={hidden:true};
  const panel={open:true,isConnected:true,dataset:{commGroup:'all'},
    querySelector(selector){return selector==='[data-comm-details]'?target:selector==='[data-comm-history-more]'?more:null}};
  ctx.expand(panel,false);
  assert.equal(target.dataset.loaded,'80');
  assert.equal(more.hidden,false);
  ctx.expand(panel,false);
  assert.equal(target.dataset.loaded,'80','reopen cannot eagerly mount extra batches');
  for(let i=0;i<149;i++)ctx.expand(panel,true);
  assert.equal(target.dataset.loaded,'12000');
  assert.equal(target.chunks.length,150);
  assert.equal(more.hidden,true);
  assert.equal((target.chunks.join('').match(/<div style="padding:6px/g)||[]).length,12000);
});
