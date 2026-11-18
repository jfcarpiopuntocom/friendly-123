'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const src=read('src/dashboard/dashboard-main.js');
const adapterBegin=src.indexOf('  function columnasParaTabulator(v) {');
const adapterEnd=src.indexOf('\n  function pintarTabla() {',adapterBegin);
const colsBegin=src.indexOf('  var VISTA_GANANCIA={');
const colsEnd=src.indexOf('\n  function montarAgruparPor()',colsBegin);
assert.ok(adapterBegin>0&&adapterEnd>adapterBegin,'must use actual D1 Tabulator adapter');
assert.ok(colsBegin>0&&colsEnd>colsBegin,'must use actual D3 source column definitions');
const adapter=src.slice(adapterBegin,adapterEnd);
const definition=src.slice(colsBegin,colsEnd);
const workerText=[
  read('docs/core/business-read-model.js'),
  read('docs/core/finance-report.js'),
  read('docs/finance-report-worker.js').replace(/^importScripts\([^\n]+\);\s*/m,'')
].join('\n');
const vendor=read('node_modules/tabulator-tables/dist/js/tabulator.min.js');
const style=read('node_modules/tabulator-tables/dist/css/tabulator_simple.min.css');
const sales=[
  {id:'s1',productoId:'taza',productoNombre:'Taza',ubicacionId:'shelf-1',cantidad:1,
    precioUnit:20,costoUnit:2.2,comisionAsociado:3,netoCasa:17,
    fecha:'2026-11-18T02:30:00Z'},
  {id:'s2',productoId:'camiseta',productoNombre:'Camiseta',ubicacionId:'shelf-1',cantidad:1,
    precioUnit:20,costoUnit:9.1,noCommission:true,fecha:'2026-11-18T02:40:00Z'}
];
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test('D3 '+name+' native browser: real Worker + source Tabulator profits and unknown cost safely null',
   {timeout:40000},async()=>{
   let browser;
   try{
    browser=await engine.launch({headless:true});
    const page=await browser.newPage({viewport:{width:1280,height:800}});
    page.setDefaultTimeout(7000);
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<!doctype html><html><head></head><body><div id="tabla"></div></body></html>');
    await page.addStyleTag({content:style});
    await page.addScriptTag({content:vendor});
    await page.addScriptTag({content:[
      'function money(c){return c===null || c===undefined ? "—" : "$"+Number(c).toFixed(2)}',
      'function normalizar(v){return String(v==null?"":v).toLowerCase()}',
      'function pedirD3(){}','var d3={filas:[]};',
      adapter, definition,
      'window.d3Cols=columnasParaTabulator(VISTA_GANANCIA);'
    ].join('\n')});
    const run=async(data)=>{
      await page.evaluate(async({script,rows})=>{
        const blob=new Blob([script],{type:'text/javascript'});
        const url=URL.createObjectURL(blob);
        const worker=new Worker(url);
        try{
          const result=await new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>reject(new Error('real D3 worker timeout')),5000);
            worker.onerror=error=>{clearTimeout(timer);reject(new Error(error.message||'worker error'));};
            worker.onmessage=event=>{clearTimeout(timer);resolve(event.data);};
            worker.postMessage({input:{sales:rows,period:{from:'2026-11-17',to:'2026-11-17'},zone:'America/Guayaquil'},earningsBy:'product'});
          });
          if(result.error)throw new Error(result.error);
          const values=result.rows.slice(1).map(r=>({
            nombre:r.name,unidades:r.units,
            recaudado:r.netCents===null?null:r.netCents/100,
            costoD3:r.costCents===null?null:r.costCents/100,
            comision:r.commissionCents===null?null:r.commissionCents/100,
            ganancia:r.profitCents===null?null:r.profitCents/100,
            margenPct:r.marginPct,sinCosto:r.salesWithoutCost
          }));
          if(window.d3Table)await window.d3Table.replaceData(values);
          else window.d3Table=new Tabulator('#tabla',{data:values,columns:window.d3Cols,
            layout:'fitColumns',height:'350px'});
          return {total:result.rows[0],values};
        }finally{worker.terminate();URL.revokeObjectURL(url);}
      },{script:workerText,rows:data});
    };
    await run(sales);
    await page.waitForFunction(()=>window.d3Table?.getDataCount('active')===2);
    await page.waitForFunction(()=>window.d3Table?.getCalcResults()?.bottom?.ganancia===25.7);
    const stats=await page.evaluate(()=>({
      calc:window.d3Table.getCalcResults().bottom,
      values:window.d3Table.getData(),
      cols:window.d3Table.getColumns().map(c=>c.getField())
    }));
    assert.equal(stats.calc.recaudado,40);
    assert.equal(stats.calc.costoD3,11.3);
    assert.equal(stats.calc.comision,3);
    assert.equal(stats.calc.ganancia,25.7);
    assert.ok(stats.cols.includes('sinCosto'));
    assert.deepEqual(errors,[]);
    const footer=page.locator('.tabulator-calcs-bottom .tabulator-cell[tabulator-field="ganancia"]');
    assert.equal((await footer.innerText()).trim(),'$25.70');
    await run([...sales,{id:'s3',productoId:'mystery',productoNombre:'Sin costo',
      ubicacionId:'shelf-1',cantidad:1,precioUnit:5,costoUnit:null,
      noCommission:true,fecha:'2026-11-18T03:00:00Z'}]);
    await page.waitForFunction(()=>window.d3Table?.getDataCount('active')===3);
    await page.waitForFunction(()=>window.d3Table?.getCalcResults()?.bottom?.ganancia===null);
    assert.equal((await footer.innerText()).trim(),'—','never turn missing cost into $0 profit');
    const unknown=page.locator('.tabulator-row').filter({hasText:'Sin costo'});
    assert.equal(await unknown.count(),1);
    assert.ok((await unknown.innerText()).includes('—'));
    assert.deepEqual(errors,[]);
    await page.close();
   }finally{await browser?.close();}
 });
}
