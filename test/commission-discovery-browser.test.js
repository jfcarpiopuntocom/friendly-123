const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
for(const [engineName,engine] of [['Chromium',chromium],['WebKit',webkit]]) for(const lang of ['en','es']) {
 test(`commission choice (${engineName}, ${lang}): partial is visible before clicking; device rename reports immediately`,async()=>{
  const web=await engine.launch({headless:true});
  try {
   const page=await web.newPage({viewport:{width:390,height:844}});
   await page.goto(pathToFileURL(path.resolve(__dirname,'../docs/index.html')).href,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.OCAuth&&window.OCMicelio&&typeof cargarComisiones==='function');
   const r=await page.evaluate(async(lang)=>{
    window.OCAuth.rolActual=()=> 'dueno'; window.OCI18n.setLang(lang);
    const req=async(u,m='GET',b)=> (await fetch(u,{method:m,body:b?JSON.stringify(b):undefined})).json();
    const a=await req('/api/promotoras','POST',{nombre:'Choice Fixture',comisionBase:40});
    const rack=await req('/api/ubicaciones','POST',{nombre:'Choice rack',tipo:'socio'});
    await req('/api/ubicaciones/'+rack.id,'PUT',{promotoraId:a.id});
    const p=await req('/api/productos','POST',{nombre:'Choice cup',barcode:'CHOICE-FIXTURE',precio:100,costo:20,stockInicial:2,ubicacionId:rack.id});
    await req('/api/productos/'+p.id+'/venta','POST',{cantidad:1});
    await cargarComisiones();
    document.querySelectorAll('.vista').forEach(v=>v.classList.remove('activa'));
    document.getElementById('vista-comisiones').classList.add('activa');
    const product=document.querySelector('[data-comm-pay-from-product="'+rack.id+'"]');
    document.getElementById('comm-tab-rack').click();
    const person=document.querySelector('[data-comm-person-card][data-payee-id="'+a.id+'"] [data-comm-pay-person]');
    const rect=person.getBoundingClientRect();
    const original=window.fetch; const reports=[];
    window.fetch=async(u,opt)=>{if(String(u).includes('/checkin')){reports.push(JSON.parse(opt.body));return {ok:true,status:200,json:async()=>({})};} return original(u,opt);};
    localStorage.setItem('f123_owned',JSON.stringify({instanceId:'fixture-choice-device',licenseCode:'F123-TEST-0000-0000-00000',nombreNegocio:'Choice Fixture shop',nombreNegocioRev:5,nombreNegocioTs:123}));
    window.OCMicelio.ponerApodo('Choice phone');
    await new Promise(resolve=>setTimeout(resolve,50));
    return {product:product.innerText,person:person.innerText,left:rect.left,right:rect.right,width:innerWidth,reports};
   },lang);
   const partial=lang==='es'?/parcial/i:/partial/i;
   assert.equal(r.reports.length,1,'changing device nickname must send one immediate license checkin');
   assert.equal(r.reports[0].apodo,'Choice phone');
   assert.equal(r.reports[0].nombreNegocio,'Choice Fixture shop');
   assert.equal(r.reports[0].nombreNegocioRev,5);
   assert.match(r.product,partial,'product button must announce partial payment');
   assert.match(r.person,partial,'person button must announce partial payment');
   assert.ok(r.left>=0&&r.right<=r.width+1,'payment stays inside mobile viewport');
  } finally {await web.close();}
 });
}
