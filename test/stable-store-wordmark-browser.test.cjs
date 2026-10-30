'use strict';
// ONLY visual header skin: uses actual static PWA and dashboard with synthetic notebook.
// Proves dynamic Unicode names stay complete and use the bundled display face.
// No production network, no user notebook and no mutations of real business data.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {startServer,openDevice,chromium}=require('./helpers/e2e-app.cjs');
// JFC 2026-10-28: use the logo yellow and a black outline in app and dashboard.
const GOLD='rgb(239, 195, 26)';
const DASH_GOLD=GOLD;
test('real PWA: dynamic store wordmark uses bundled display, accessible dark gold, no mobile header overflow', {timeout:120000},async()=>{
 const {srv,base}=await startServer();let browser;
 try{
  browser=await chromium.launch({headless:true});
  for(const width of [320,390,1024,1280]){
   const d=await openDevice(browser,base,{width,height:515});
   const page=d.page;
   await page.evaluate(()=>document.fonts.ready);
   const names=['Galería Belén ✨','Сafé São João 🎨','Una librería con nombre verdaderamente larguísimo '.repeat(20)+'✨'];
   for(const name of names){
    const result=await page.evaluate(value=>{
     const el=document.getElementById('oc-negocio-nombre');
     el.textContent=value;el.removeAttribute('data-i18n');
     const css=getComputedStyle(el),r=el.getBoundingClientRect();
     const header=document.querySelector('header'),h=header.getBoundingClientRect();
     return {text:el.textContent,html:el.innerHTML,font:css.fontFamily,weight:css.fontWeight,color:css.color,fill:css.webkitTextFillColor,strokeW:css.webkitTextStrokeWidth,strokeC:css.webkitTextStrokeColor,
       fontSize:parseFloat(css.fontSize),whiteSpace:css.whiteSpace,spanRight:r.right,headerRight:h.right,width:r.width,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth};
    },name);
    assert.equal(result.text,name,'full Unicode name survives DOM and exportable text');
    assert.ok(result.font.includes('Space Grotesk'),'reuse already bundled friendly display font');
    assert.equal(result.weight,'700');assert.equal(result.color,GOLD);assert.equal(result.fill,GOLD);
    assert.ok(Math.abs(parseFloat(result.strokeW)/result.fontSize-0.06)<0.001,'outline scales with the business name');
    assert.equal(result.strokeC,'rgb(0, 0, 0)');
    assert.equal(result.whiteSpace,'normal','show the whole business name');
    assert.ok(result.spanRight<=result.headerRight+2,`header branding overflow width=${width} nameLength=${name.length}: ${JSON.stringify(result)}`);
    assert.ok(result.scrollWidth<=result.clientWidth+1,'name wraps instead of clipping to the right');
    assert.ok(!result.html.includes('<svg'),'no generated per-client graphic nor HTML injection');
   }
   await d.ctx.close();
  }
 }finally{if(browser)await browser.close();await new Promise(resolve=>srv.close(resolve));}
});
test('real dashboard: the same dynamic business wordmark remains readable and selectable', {timeout:120000},async()=>{
 const {srv,base}=await startServer();let browser;
 try{
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  await context.route(url=>!url.href.startsWith(base)&&!url.href.startsWith('data:'),route=>route.abort());
  const page=await context.newPage();
  await page.goto(base+'/dashboard.html',{waitUntil:'domcontentloaded'});
  const r=await page.evaluate(()=>{
   const parent=document.getElementById('cabecera');parent.style.display='block';
   const el=document.getElementById('neg-nombre');el.textContent='Tienda Cóndor 🪙';
   const s=getComputedStyle(el);return {text:el.textContent,font:s.fontFamily,weight:s.fontWeight,color:s.color,fill:s.webkitTextFillColor,stroke:s.webkitTextStrokeColor,ratio:parseFloat(s.webkitTextStrokeWidth)/parseFloat(s.fontSize),whiteSpace:s.whiteSpace};
  });
  assert.equal(r.text,'Tienda Cóndor 🪙');assert.ok(r.font.includes('Space Grotesk'));
  assert.equal(r.weight,'700');assert.equal(r.color,DASH_GOLD);assert.equal(r.fill,DASH_GOLD);
  assert.equal(r.stroke,'rgb(0, 0, 0)');assert.ok(Math.abs(r.ratio-0.06)<0.001);assert.equal(r.whiteSpace,'normal');
  await context.close();
 }finally{if(browser)await browser.close();await new Promise(resolve=>srv.close(resolve));}
});
