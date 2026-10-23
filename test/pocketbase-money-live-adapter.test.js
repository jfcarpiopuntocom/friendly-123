'use strict';
// Exercise the live PocketBase sale interception with synthetic server records.
// No production network, credentials, real customers or PINs.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/pocketbase-client.js'),'utf8');

async function ventaFixture(personStatus=200, productPercent=null) {
  const requests=[],created=[];
  const product={id:'product-1',nombre:'Synthetic item',precio:100,costo:20,stockActual:2,
    ubicacionId:'rack-1',pctAsociado:productPercent,umbralRojo:0,umbralAmarillo:0};
  const rack={id:'rack-1',nombre:'Synthetic shelf',tipo:'socio',comisionSocio:30,promotoraId:'person-501'};
  const transport=async (url,opts={})=>{
    const u=new URL(url), method=opts.method||'GET';
    requests.push(method+' '+u.pathname);
    let obj={},status=200;
    if(method==='GET'&&u.pathname.endsWith('/productos/records/product-1'))obj=product;
    else if(method==='GET'&&u.pathname.endsWith('/ubicaciones/records'))obj={items:[rack]};
    else if(method==='GET'&&u.pathname.endsWith('/ventas/records'))obj={items:[]};
    else if(method==='GET'&&u.pathname.endsWith('/promotoras/records/person-501')){
      if(personStatus===200)obj={id:'person-501',comisionBase:40};
      else {status=personStatus;obj={code:status,message:'Remote fixture error'};}
    }else if(method==='POST'&&u.pathname.endsWith('/ventas/records')){
      obj={...JSON.parse(opts.body),id:'sale-1'};created.push(obj);
    }else if(method==='PATCH'&&u.pathname.endsWith('/productos/records/product-1')){
      Object.assign(product,JSON.parse(opts.body));obj=product;
    }else if(method==='POST'&&u.pathname.endsWith('/movimientos/records'))obj={id:'movement-1'};
    else {status=404;obj={code:404,message:'No synthetic route'};}
    return new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json'}});
  };
  const store={getItem:key=>key==='F123_PB_URL'?'https://pb.fixture.invalid':null};
  const w={fetch:transport,localStorage:store};
  w.window=w;
  const context={window:w,localStorage:store,console:{info(){},error(){}},URL,URLSearchParams,Response,Date,Intl};
  vm.runInNewContext(source,context,{filename:'docs/pocketbase-client.js'});
  const response=await w.fetch('/api/productos/records/product-1/venta',{method:'POST',body:'{}'});
  return {response,body:await response.json(),requests,created,product};
}

test('PocketBase sale loads assigned person directly (even beyond page 500), locks 40% instead of shelf 30%',async()=>{
  const r=await ventaFixture();
  assert.equal(r.response.status,200);
  assert.equal(r.created.length,1);
  assert.equal(r.created[0].split.montoComisionSocio,40);
  assert.equal(r.created[0].split.montoNetoDueno,60);
  assert.equal(r.product.stockActual,1);
  assert.ok(r.requests.some(x=>x.endsWith('/promotoras/records/person-501')));
  assert.ok(!r.requests.some(x=>x.endsWith('/promotoras/records')),'no truncated list');
});
test('PocketBase sale with deleted associate (404) preserves rack rate, not a phantom commission',async()=>{
  const r=await ventaFixture(404);
  assert.equal(r.response.status,200);
  assert.equal(r.created.length,1);
  assert.equal(r.created[0].split.montoComisionSocio,30);
  assert.equal(r.created[0].split.montoNetoDueno,70);
});
test('PocketBase sale on upstream associate failure (503) refuses money and stock writes',async()=>{
  const r=await ventaFixture(503);
  assert.equal(r.response.status,503);
  assert.equal(r.created.length,0);
  assert.equal(r.product.stockActual,2);
});
test('PocketBase product 25% overrides assigned person 40% and shelf 30%',async()=>{
  const r=await ventaFixture(200,25);
  assert.equal(r.response.status,200);
  assert.equal(r.created[0].split.montoComisionSocio,25);
  assert.equal(r.created[0].split.montoNetoDueno,75);
});
