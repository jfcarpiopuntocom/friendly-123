// Belen 2026-10-14 (v506): "pongo en buscador vino, me sale, pero no me sale para
// arreglar. Bajo y me sale para arreglar pero no por lo que quiero buscar si no
// orden cronologico". La busqueda de Sales log manda tambien sobre las ventas con
// lapiz y cada resultado trae "Corregir" que abre el editor de ESA venta.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]) for(const lang of ['en','es']){
 test(`Sold search (${name}, ${lang}): only matching sales stay editable and Fix opens that sale`,async()=>{
  const browser=await engine.launch({headless:true});
  try{
   const page=await browser.newPage({viewport:{width:390,height:844}});
   await page.goto(pathToFileURL(path.resolve(__dirname,'../docs/index.html')).href,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.OCAuth&&window.OCSalesAuditUI&&typeof cargarVentasSold==='function');
   const fx=await page.evaluate(async lang=>{
    window.OCAuth.rolActual=()=> 'dueno';window.OCI18n.setLang(lang);ubicacionActual='todas';
    document.querySelectorAll('[id*="gate"]').forEach(x=>x.style.display='none');
    document.querySelectorAll('.vista').forEach(x=>x.classList.remove('activa'));document.querySelector('#ventasSold').closest('.vista').classList.add('activa');document.getElementById('ventasSold').open=true;
    const req=async(u,m='GET',b)=>(await fetch(u,{method:m,body:b?JSON.stringify(b):undefined})).json();
    const rack=await req('/api/ubicaciones','POST',{nombre:'Synthetic bar',tipo:'propio'});
    const vino=await req('/api/productos','POST',{nombre:'SYN-WINE-GLASS',barcode:'SYNWINE',precio:5,costo:1,stockInicial:9,ubicacionId:rack.id});
    const otro=await req('/api/productos','POST',{nombre:'Synthetic cards',barcode:'SYN-CARDS',precio:30,costo:5,stockInicial:9,ubicacionId:rack.id});
    const a=await req('/api/productos/'+vino.id+'/venta','POST',{cantidad:1});
    for(let i=0;i<4;i++) await req('/api/productos/'+otro.id+'/venta','POST',{cantidad:1});
    await cargarVentasSold();return {vinoVenta:a.ventaId};
   },lang);
   const visibles=()=>page.evaluate(()=>[...document.querySelectorAll('#ventasSoldLista .oc-vs-row')].filter(r=>r.style.display!=='none').map(r=>r.innerText));
   assert.ok((await visibles()).length>=5,'sin busqueda se ven todas');
   await page.locator('#ventasSoldAudit [data-audit-query]').fill('SYN-WINE-GLASS');
   const solo=await visibles();
   assert.equal(solo.length,1,'con la busqueda solo queda la venta que coincide');
   assert.match(solo[0],/SYN-WINE-GLASS/);
   await page.locator(`#ventasSoldAudit [data-audit-edit="${fx.vinoVenta}"]`).click();
   const abierto=await page.evaluate(id=>{const r=[...document.querySelectorAll('#ventasSoldLista .oc-vs-row')].find(x=>x.getAttribute('data-id')===id);return r&&r.querySelector('.oc-vs-editor').style.display;},fx.vinoVenta);
   assert.equal(abierto,'block','Corregir abre el editor de esa venta');
   await page.locator('#ventasSoldAudit [data-audit-reset]').click();
   assert.ok((await visibles()).length>=5,'All history devuelve todas');
  }finally{await browser.close();}
 });
}
