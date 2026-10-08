const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {browser}=require('./helpers/browser.cjs');
const seeds=require('./fixtures/demo-historical-seeds.json');
function store(){const m=new Map();return {get length(){return m.size;},key:i=>[...m.keys()][i],getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};}
function loadPolicy(app){vm.runInContext(fs.readFileSync(path.join(__dirname,'../docs/core/demo-huellas.js'),'utf8'),app);return app.OCDemoHuellas;}
test('an activated empty business stays empty: demo is not default data (JFC 2026-10-08)',async()=>{
 const ls=store();ls.setItem('f123_owned',JSON.stringify({instanceId:'empty-business-fixture'}));
 const app=browser(ls);loadPolicy(app);
 for(const url of ['/api/productos','/api/clientes','/api/ubicaciones?todas=1','/api/promotoras','/api/sucursales'])assert.deepEqual(await app.request(url),[],url);
 for(const key of ['productos','clientes','ubicaciones','promotoras','sucursales'])assert.deepEqual(app.catalog()[key],[],key+' must not seed an empty business');
});
async function fixture(seed,owned){const source=browser();const raw=await source.request('/api/respaldo/exportar');for(const key of ['productos','clientes','ubicaciones','promotoras','sucursales'])raw[key]=structuredClone(seed.data[key]);raw.ventas=[];raw.movimientos=[];raw.transferencias=[];raw.gastos=[];raw.usuarios=[];raw.payouts=[];raw.ajustesComision=[];raw.gastosMensuales={};
 raw.productos.push({id:'real-piece',nombre:'Created piece',sku:'0017',barcode:'0017',precio:80,costo:20,stockActual:2,ubicacionId:'real-rack'});
 raw.clientes.push({id:'real-person',codigo:'C-REAL',nombre:'Created customer',telefono:'5550000'});
 raw.promotoras.push({id:'real-agent',nombre:'Created associate',comisionBase:25});
 raw.ubicaciones.push({id:'real-rack',nombre:'Created rack',tipo:'socio',activa:true,sucursalId:'real-branch',promotoraId:'real-agent',comisionSocio:25});
 raw.sucursales.push({id:'real-branch',nombre:'Created branch',activa:true});
 const ls=store();ls.setItem('f123_owned',JSON.stringify(owned));const app=browser(ls);loadPolicy(app);app.OCAuth={rolActual:()=> 'dueno'};await app.request('/api/respaldo/importar','POST',raw);return {app,ls};}
for(const seed of seeds)for(const owned of [{licenseCode:'SYNTHETIC',instanceId:'fixture-owner'},{instanceId:'fixture-trial'}]){
 test(`historical seed ${seed.sha.slice(0,7)} is isolated for ${owned.licenseCode?'licensed':'activated'} business without deleting storage`,async()=>{
 const {app}=await fixture(seed,owned);const before=await app.request('/api/respaldo/exportar');
 for(const [key,url,field,expected] of [['productos','/api/productos','id','real-piece'],['clientes','/api/clientes','id','real-person'],['ubicaciones','/api/ubicaciones?todas=1','id','real-rack'],['promotoras','/api/promotoras','id','real-agent'],['sucursales','/api/sucursales','id','real-branch']]){
  assert.deepEqual((await app.request(url)).map(x=>x[field]),[expected],key+' has only owner-created records');
 }
 assert.deepEqual((await app.request('/api/liquidaciones')).map(x=>x.ubicacionId),['real-rack']);
 assert.deepEqual(await app.request('/api/respaldo/exportar'),before,'reading must preserve the complete recoverable backup');
 const cleaned=app.OCDemoHuellas.sinDemo(before);assert.deepEqual(cleaned.clientes.map(x=>x.id),['real-person'],'dashboard shares the same policy');
 for(const key of ['productos','clientes','ubicaciones','promotoras','sucursales'])assert.deepEqual(app.catalog()[key].map(x=>x.id),[{'productos':'real-piece','clientes':'real-person','ubicaciones':'real-rack','promotoras':'real-agent','sucursales':'real-branch'}[key]],'sync '+key+' must not republish demo');
 });
}
test('a partial Ashley remnant is hidden and does not sync from an activated trial',async()=>{
 const seed=structuredClone(seeds[0]);for(const k of Object.keys(seed.data))seed.data[k]=k==='clientes'?[seed.data.clientes[0]]:[];
 const {app}=await fixture(seed,{instanceId:'fixture-trial'});assert.deepEqual((await app.request('/api/clientes')).map(c=>c.nombre),['Created customer']);assert.deepEqual(app.catalog().clientes.map(c=>c.nombre),['Created customer']);
});
test('a real customer with the same old id and a changed name/contact stays visible',async()=>{
 const seed=structuredClone(seeds[0]);seed.data.clientes=[{...seed.data.clientes[0],nombre:'Owner created Ashley',telefono:'555NEW'}];for(const k of Object.keys(seed.data))if(k!=='clientes')seed.data[k]=[];
 const {app}=await fixture(seed,{licenseCode:'SYNTHETIC',instanceId:'fixture-owner'});assert.ok((await app.request('/api/clientes')).some(c=>c.nombre==='Owner created Ashley'));assert.ok(app.catalog().clientes.some(c=>c.nombre==='Owner created Ashley'));
});
test('no technical demo workaround or demo label is shipped in commission copy',()=>{
 const index=fs.readFileSync(path.join(__dirname,'../docs/index.html'),'utf8');const i18n=fs.readFileSync(path.join(__dirname,'../docs/i18n.js'),'utf8');
 assert.doesNotMatch(index,/comm\.sampleRack|esPerchaSemillaVieja/,'never mark an owner-created rack as demo by id');
 assert.doesNotMatch(i18n,/came with an early version of the app|vino con una versión antigua de la app/,'never ask the owner to disable leaked sample data');
});
