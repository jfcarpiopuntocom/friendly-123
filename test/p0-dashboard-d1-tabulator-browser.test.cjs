'use strict';
// QA synthetic rows with the REAL installed Tabulator 6.3.1 and actual
// D1 column adapter extracted from current dashboard-main.js.
// Browsers are native Chromium/WebKit but NOT physical Opera/iPhone Safari.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const source=fs.readFileSync(path.join(__dirname,'../src/dashboard/dashboard-main.js'),'utf8');
const begin=source.indexOf('  function columnasParaTabulator(v) {');
const end=source.indexOf('\n  function pintarTabla() {',begin);
assert.ok(begin>=0&&end>begin,'Must execute current source-derived columns adapter');
const adapter=source.slice(begin,end);
const vendor=path.join(__dirname,'../node_modules/tabulator-tables/dist/js/tabulator.min.js');
const style=path.join(__dirname,'../node_modules/tabulator-tables/dist/css/tabulator_simple.min.css');
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]) {
  test('D1 '+name+' native Tabulator: header filters and visible sums, missing values not zero',
    {timeout:30000},async()=>{
    let browser;
    try{
      browser=await engine.launch({headless:true});
      const page=await browser.newPage({viewport:{width:1280,height:800}});
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.setContent('<!DOCTYPE html><html><head></head><body><div id="tabla"></div></body></html>');
      await page.addStyleTag({content:fs.readFileSync(style,'utf8')});
      await page.addScriptTag({content:fs.readFileSync(vendor,'utf8')});
      await page.addScriptTag({content:[
        "function money(value){return '$'+Number(value).toFixed(2)}",
        "function normalizar(value){return String(value==null?'':value).toLowerCase()}",
        adapter,"window.syntheticColumns=columnasParaTabulator;"
      ].join('\n')});
      await page.evaluate(()=>{
        const data=[
          {productoNombre:'P1',ubicacionNombre:'Shelf 1',cantidad:1,total:12.75,precioUnit:12.75},
          {productoNombre:'P2',ubicacionNombre:'Shelf 2',cantidad:3,total:999,precioUnit:333},
          {productoNombre:'P3',ubicacionNombre:'Shelf 1',cantidad:2,total:3.25,precioUnit:1.625},
          {productoNombre:'P4',ubicacionNombre:'Shelf 3',cantidad:1,total:null,precioUnit:4}
        ];
        const defs=[
          {title:'Product',field:'productoNombre'},
          {title:'Shelf',field:'ubicacionNombre'},
          {title:'Qty.',field:'cantidad'},
          {title:'Total',field:'total'},
          {title:'Unit price',field:'precioUnit'}
        ];
        window.table=new Tabulator('#tabla',{data,columns:window.syntheticColumns({cols:defs}),
          layout:'fitColumns',height:'350px'});
      });
      // Diagnostic fail fast instead of hanging 30s with no evidence.
      page.setDefaultTimeout(6000);
      const diag=async(stage,error)=>{
        const snapshot=await page.evaluate(()=>({
          cols:[...document.querySelectorAll('.tabulator-col')].map(x=>({html:x.outerHTML.slice(0,380)})),
          foot:document.querySelector('.tabulator-calcs-bottom')?.outerHTML?.slice(0,1300)||null,
          inputs:[...document.querySelectorAll('input')].map(x=>x.outerHTML.slice(0,240)),
          table:typeof Tabulator,active:window.table?.getDataCount?.('active'),
          calc:window.table?.getCalcResults?.(),body:document.body.innerHTML.slice(0,1200)
        })).catch(e=>({diagError:e.message}));
        throw new Error(stage+': '+error.message+'; SNAPSHOT='+JSON.stringify(snapshot));
      };
      let stage='find shelf filter';
      try{
      const shelf=page.locator('.tabulator-col[tabulator-field="ubicacionNombre"] .tabulator-header-filter input');
      await shelf.waitFor();
      stage='validate input counts';
      assert.equal(await page.locator('.tabulator-header-filter input').count(),5);
      assert.equal(await page.evaluate(()=>window.table.getDataCount('active')),4);
      stage='find footer';
      const calc=page.locator('.tabulator-calcs-bottom .tabulator-cell[tabulator-field="total"]');
      await page.waitForFunction(()=>!!document.querySelector('.tabulator-calcs-bottom'));
      assert.equal((await calc.innerText()).trim(),'—');
      stage='shelf filter Shelf 1';
      await shelf.fill('Shelf 1');
      await page.waitForFunction(()=>window.table.getDataCount('active')===2);
      await page.waitForFunction(()=>window.table.getCalcResults().bottom?.total===16);
      assert.equal((await calc.innerText()).trim(),'$16.00');
      stage='unit footer absent';
      const unit=page.locator('.tabulator-calcs-bottom .tabulator-cell[tabulator-field="precioUnit"]');
      assert.equal(await unit.count(),1);
      assert.equal((await unit.innerText()).trim(),'','unit prices must never have an aggregate');
      stage='numeric range';
      const qty=page.locator('.tabulator-col[tabulator-field="cantidad"] .tabulator-header-filter input');
      await qty.fill('2..5');
      await page.waitForFunction(()=>window.table.getDataCount('active')===1);
      await page.waitForFunction(()=>window.table.getCalcResults().bottom?.total===3.25);
      assert.equal((await calc.innerText()).trim(),'$3.25');
      assert.deepEqual(errors,[]);
      }catch(error){await diag(stage,error);}
      await page.close();
    }finally{await browser?.close();}
  });
}
