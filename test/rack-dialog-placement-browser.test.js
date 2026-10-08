const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]) {
 test(`rack dialogs (${name}): centered, four corners, scrollable and close without altering data`,async()=>{
  const browser=await engine.launch({headless:true});
  try{
   const page=await browser.newPage({viewport:{width:390,height:844}});
   await page.goto(pathToFileURL(path.resolve(__dirname,'../docs/index.html')).href,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.VPerchas&&window.OCAuth&&window.OCI18n);
   const ids=await page.evaluate(async()=>{
    OCAuth.rolActual=()=> 'dueno';OCAuth.puedeGestionar=()=>true;
    // This fixture installs an owner role without logging in with a real PIN.
    // Remove only its synthetic login wall so pointer events exercise dialogs.
    const gate=document.getElementById('oc-gate');if(gate)gate.style.display='none';
    const req=async(u,m='GET',b)=>(await fetch(u,{method:m,body:b?JSON.stringify(b):undefined})).json();
    const rack=await req('/api/ubicaciones','POST',{nombre:'Synthetic dialog rack',tipo:'socio'});
    const prod=await req('/api/productos','POST',{nombre:'Synthetic dialog cup',barcode:'DIALOG-CUP',precio:100,costo:20,stockInicial:2,ubicacionId:rack.id});
    document.querySelectorAll('.vista').forEach(v=>v.classList.remove('activa'));
    document.getElementById('vista-perchas').classList.add('activa');
    await VPerchas.cargar();
    return {rack:rack.id,prod:prod.id};
   });
   for(const size of [{width:390,height:844},{width:1280,height:800},{width:390,height:430}]) {
    await page.setViewportSize(size);
    for(const [overlay,trigger,close] of [
     ['vp-carpeta-modal','button[data-vp-abrir="'+ids.rack+'"]','vp-carpeta-cerrar'],
     ['vp-gestion-modal','[data-vp-rename="'+ids.rack+'"]','vp-g-cerrar'],
     ['vp-agregar-modal','#vp-btn-agregar','vp-a-cerrar']]){
     await page.locator(trigger).first().focus();
     await page.locator(trigger).first().click();
     await page.waitForFunction(id=>document.getElementById(id).style.display==='flex',overlay);
     const box=await page.locator('#'+overlay+' > div').evaluate(el=>{
      const r=el.getBoundingClientRect(),s=getComputedStyle(el);
      return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height,vh:innerHeight,vw:innerWidth,
       corners:[s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomLeftRadius,s.borderBottomRightRadius],
       role:el.getAttribute('role'),modal:el.getAttribute('aria-modal'),overflow:s.overflowY};
     });
     assert.ok(box.top>=15&&box.bottom<=box.vh-15,`${overlay} needs margin above and below: ${JSON.stringify(box)}`);
     assert.ok(Math.abs((box.top+box.bottom)/2-box.vh/2)<3,`${overlay} must be centered`);
     assert.ok(box.left>=15&&box.right<=box.vw-15,'no horizontal overflow');
     assert.ok(box.corners.every(x=>parseFloat(x)>0),'four complete corners');
     assert.equal(box.role,'dialog');assert.equal(box.modal,'true');assert.equal(box.overflow,'auto');
     await page.locator('#'+close).click();
     assert.equal(await page.locator('#'+overlay).isVisible(),false);
     const focused=await page.locator(trigger).first().evaluate(el=>({ok:el===document.activeElement||el.contains(document.activeElement),active:document.activeElement.outerHTML.slice(0,250)}));
     assert.equal(focused.ok,true,'restore focus to opener: '+JSON.stringify({overlay,trigger,focused}));
     if(size.height===844){
      await page.locator(trigger).first().click();
      await page.locator('#'+close).focus();await page.keyboard.press('Shift+Tab');
      assert.equal(await page.locator('#'+overlay).evaluate(el=>el.contains(document.activeElement)),true,'Tab stays inside');
      await page.keyboard.press('Escape');assert.equal(await page.locator('#'+overlay).isVisible(),false);
     }
    }
   }
   const data=await page.evaluate(async()=> (await fetch('/api/respaldo/exportar')).json());
   assert.equal(data.ubicaciones.find(x=>x.id===ids.rack).nombre,'Synthetic dialog rack');
   assert.equal(data.productos.find(x=>x.id===ids.prod).stockActual,2);
  }finally{await browser.close();}
 });
}
