'use strict';
// Belén's three business flows, executed with the actual bundled Safari/WebKit
// application and the existing in-memory mock API; synthetic notebook only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webkit } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const URL = pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href;

async function openShop(browser) {
  const page = await browser.newPage({ viewport: {width: 390,height:844} });
  await page.goto(URL, {waitUntil:'load'});
  await page.waitForFunction(() => window.__ocMockBackendReady === true &&
    window.AMG && window.AMG.Cartera && typeof window.abonarCliente === 'function');
  await page.addStyleTag({content:'#oc-gate,#puerta,#oc-splash{display:none!important;pointer-events:none!important}'});
  await page.evaluate(() => { window.OCAuth = Object.assign(window.OCAuth || {},
    {rolActual:()=> 'dueno',esDemo:()=>false}); });
  return page;
}

test('WebKit real UI: one $10 payment on one $35 debt leaves exactly $25 owed and no second charge', async () => {
  const browser = await webkit.launch({headless:true});
  try {
    const page=await openShop(browser);
    const fixture=await page.evaluate(async () => {
      const id='belen-partial-'+Date.now();
      const customer=await (await fetch('/api/clientes',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({nombre:id})
      })).json();
      if(!customer.id) throw Error('customer creation: '+JSON.stringify(customer));
      const resp=await fetch('/api/clientes/'+customer.id+'/fiar',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({monto:35,motivo:'Synthetic credit [for:Prior purchase]',opId:'fiar-'+id})
      });
      const debt=await resp.json();
      if(!resp.ok) throw Error('debt fixture: '+JSON.stringify(debt));
      window.abonarCliente(customer.id,'Synthetic');
      return {customerId:customer.id};
    });
    await page.waitForFunction(() => {
      const m=document.querySelector('#pp-modal-abono');
      return m && !m.querySelector('#pp-ab-ok').disabled &&
        !!m.querySelector('#pp-ab-consumos .pp-chip');
    },{timeout:15000});
    await page.locator('#pp-ab-consumos .pp-chip').first().click();
    assert.equal(await page.locator('#pp-ab-monto').inputValue(),'35.00');
    await page.locator('#pp-ab-monto').fill('10');
    assert.equal(await page.locator('#pp-ab-monto').inputValue(),'10');
    await page.locator('#pp-ab-ok').click();
    await page.waitForFunction(() => !document.getElementById('pp-modal-abono'),null,{timeout:20000});
    const result=await page.evaluate(async id=>{
      const r=await fetch('/api/clientes/'+id+'/cartera');
      const debt=await r.json();
      return {status:r.status,saldo:debt.saldo,items:debt.consumosPendientes};
    },fixture.customerId);
    assert.equal(result.status,200);
    assert.equal(result.saldo,-25,'exact outstanding debt $25 after $10 payment');
    assert.equal(result.items.length,1);
    assert.equal(result.items[0].pendiente,25,'the selected purchase remains partly outstanding');
    assert.equal(await page.locator('#pp-modal-abono').count(),0);
    // A subsequent independent $25 payment settles the credit without
    // repeating the old $10 receipt or changing any sold inventory.
    await page.evaluate(id => window.abonarCliente(id,'Synthetic'),fixture.customerId);
    await page.waitForFunction(() => {
      const m=document.querySelector('#pp-modal-abono');
      return m && !m.querySelector('#pp-ab-ok').disabled &&
        !!m.querySelector('#pp-ab-consumos .pp-chip');
    });
    await page.locator('#pp-ab-consumos .pp-chip').first().click();
    assert.equal(await page.locator('#pp-ab-monto').inputValue(),'25.00');
    await page.locator('#pp-ab-ok').click();
    await page.waitForFunction(() => !document.querySelector('#pp-modal-abono'));
    const settled=await page.evaluate(async id=>{
      const r=await fetch('/api/clientes/'+id+'/cartera');
      const data=await r.json();
      return {status:r.status,saldo:data.saldo,pendientes:data.consumosPendientes};
    },fixture.customerId);
    assert.equal(settled.status,200);
    assert.equal(settled.saldo,0,'second $25 payment settles the original $35');
    assert.equal(settled.pendientes.length,0);
  } finally { await browser.close(); }
});

test('WebKit real backend: historic Sold keeps June business date and real audit time; different-date opId conflicts', async () => {
  const browser=await webkit.launch({headless:true});
  try {
    const page=await openShop(browser);
    const result=await page.evaluate(async ()=>{
      const id='belen-historic-'+Date.now();
      const post=async(url,body)=> {
        const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        return {status:response.status,body:await response.json()};
      };
      const product=await post('/api/productos',{nombre:id,barcode:id,ubicacionId:'bar',
        precio:35,costo:5,stockInicial:2});
      if(product.status>=400 || !product.body.id)throw Error('product: '+JSON.stringify(product));
      const opId='sale-belen-historical-'+Date.now();
      const url='/api/productos/'+product.body.id+'/venta';
      const first=await post(url,{cantidad:1,opId,info:{formaPago:'cash',fechaVenta:'2026-06-23'}});
      const conflict=await post(url,{cantidad:1,opId,info:{formaPago:'cash',fechaVenta:'2026-07-23'}});
      const backup=await (await fetch('/api/respaldo/exportar')).json();
      const sold=await (await fetch('/api/ventas/todas?ubicacionId=todas')).json();
      const sales=(backup.ventas||[]).filter(v=>v.productoId===product.body.id);
      const soldRows=(Array.isArray(sold)?sold:[]).filter(v=>v.productoId===product.body.id);
      const productAfter=(backup.productos||[]).find(p=>p.id===product.body.id);
      return {first,conflict,sales,soldRows,stock:productAfter&&productAfter.stockActual};
    });
    assert.ok(result.first.status>=200&&result.first.status<300,JSON.stringify(result.first));
    assert.equal(result.conflict.status,409,'same sale opId cannot change its business date');
    assert.equal(result.sales.length,1,'one historic sale, not two');
    assert.equal(result.sales[0].fecha.slice(0,10),'2026-06-23');
    assert.equal(result.sales[0].info.fechaVenta,'2026-06-23');
    assert.equal(result.soldRows.length,1,'Sold list must show exactly one business sale');
    assert.equal(result.soldRows[0].fecha.slice(0,10),'2026-06-23',
      'Sold must display the historic commercial month, not registration month');
    const recorded=new Date(result.sales[0].registradaEn).getTime();
    assert.ok(Number.isFinite(recorded) && Math.abs(Date.now()-recorded)<120000,
      'actual registration timestamp remains current');
    assert.equal(result.stock,1,'sale subtracts stock once, even after conflicting retry');
  } finally { await browser.close(); }
});


test('WebKit reproduces Belén screenshot: $35 pending RESUME OPERATION can become $10 only before payment write-ahead exists', async () => {
  const browser=await webkit.launch({headless:true});
  try {
    const page=await openShop(browser);
    const customerId=await page.evaluate(async () => {
      const id='belen-resume-'+Date.now();
      const post=async(url,body)=>{
        const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        const value=await r.json();
        if(!r.ok) throw Error('Fixture '+url+' '+JSON.stringify(value));
        return value;
      };
      const cli=await post('/api/clientes',{nombre:id});
      await post('/api/clientes/'+cli.id+'/fiar',{monto:35,motivo:'Synthetic fiado',opId:'fiar-'+id});
      const r=await fetch('/api/clientes/'+cli.id+'/cartera');
      const cartera=await r.json();
      const compra=cartera.consumosPendientes && cartera.consumosPendientes[0];
      if(!compra)throw Error('Missing synthetic purchase to allocate');
      // Recreate the exact legacy local write-ahead state from the screenshot.
      // No payment intent has been written, so no financial POST can have run.
      const op='customer-payment:pending-synthetic-'+id;
      const allocation={
        paymentOpId:op,opId:'customer-allocation:'+op.slice('customer-payment:'.length),
        abonoId:null,partes:[{cargoKey:compra.cargoKey,monto:35}],monto:35,motivo:'Abono'
      };
      localStorage.setItem('f123_customer_allocation_intent_v1:'+cli.id,JSON.stringify(allocation));
      window.abonarCliente(cli.id,id);
      return cli.id;
    });
    // Synthetic diagnostic for the exact RESUME state (no customer data).
    await page.waitForTimeout(300);
    const pendingState=await page.evaluate(id=>{
      const m=document.querySelector('#pp-modal-abono');
      const b=document.querySelector('#pp-ab-change');
      const i=document.querySelector('#pp-ab-monto');
      const a=localStorage.getItem('f123_customer_allocation_intent_v1:'+id);
      const p=localStorage.getItem('f123_customer_payment_intent_v1:'+id);
      return {hasModal:!!m, hasButton:!!b, buttonInline:b&&b.style.display,
        buttonRendered:b&&getComputedStyle(b).display, amount:i&&i.value,
        disabled:i&&i.disabled, notice:m&&m.querySelector('#pp-ab-msg')?.textContent,
        allocationPresent:!!a, paymentPresent:!!p};
    },customerId);
    console.log('BELEN_RESUME_SYNTHETIC_STATE',JSON.stringify(pendingState));
    await page.locator('#pp-ab-change').waitFor({state:'visible',timeout:6000});
    assert.equal(await page.locator('#pp-ab-monto').isDisabled(),true,'original $35 is locked behind resume');
    assert.match(await page.locator('#pp-ab-ok').innerText(),/Resume|Reanudar/i);
    await page.locator('#pp-ab-change').click();
    await page.waitForFunction(() => {
      const x=document.querySelector('#pp-ab-monto');
      return x && !x.disabled && x.value === '';
    },null,{timeout:20000});
    await page.locator('#pp-ab-consumos .pp-chip').first().click();
    await page.locator('#pp-ab-monto').fill('10');
    await page.locator('#pp-ab-ok').click();
    await page.waitForFunction(() => !document.querySelector('#pp-modal-abono'),null,{timeout:20000});
    const r=await page.evaluate(async id=>{
      const x=await fetch('/api/clientes/'+id+'/cartera');
      const info=await x.json();
      return {status:x.status,saldo:info.saldo,consumos:info.consumosPendientes};
    },customerId);
    assert.equal(r.status,200);
    assert.equal(r.saldo,-25,'exact reported $35 debt minus $10 payment');
    assert.equal(r.consumos[0].pendiente,25);
  } finally { await browser.close(); }
});
