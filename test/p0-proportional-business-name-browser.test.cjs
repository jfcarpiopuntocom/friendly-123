'use strict';
// Visual contract: glyph outline is a fixed proportion of *its own text size* on PC and mobile.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const base=path.join(__dirname,'..');
for(const [label,browserType] of [['Chromium',chromium],['WebKit',webkit]]){
 test('P0 proportional store wordmark '+label+' in web and dashboard, mobile and desktop',async()=>{
  const browser=await browserType.launch({headless:true});
  try{
   for(const [asset,selector,html] of [
    ['docs/app-style-02.min.css','#oc-negocio-nombre','<header><h1><span id="oc-negocio-nombre">My small shop USA</span></h1></header>'],
    ['docs/dashboard-main.min.css','#neg-nombre','<div class="top"><span id="neg-nombre">My small shop USA</span></div>']
   ]){
    const css=fs.readFileSync(path.join(base,asset),'utf8');
    for(const width of [390,1440]){
     const page=await browser.newPage({viewport:{width,height:900}});
     try{
      await page.route('**/*',route=>route.abort());
      await page.setContent('<style>'+css+'</style>'+html);
      const widths=[];
      for(const size of [20,30]){
       const value=await page.evaluate(({selector,size})=>{
        const el=document.querySelector(selector);
        el.style.setProperty('font-size',size+'px','important');
        const s=getComputedStyle(el);
        return {font:parseFloat(s.fontSize),outline:parseFloat(s.webkitTextStrokeWidth),
         fill:s.webkitTextFillColor,color:s.webkitTextStrokeColor};
       },{selector,size});
       assert.ok(Math.abs(value.font-size)<.1,label+' font-size '+asset);
       assert.ok(Math.abs(value.outline-size*.08)<.15,label+' '+asset+' '+width+' '+size+' expected 8% outline, got '+value.outline);
       assert.equal(value.fill,'rgb(239, 195, 26)',label+' exact logo yellow');
       assert.equal(value.color,'rgb(0, 0, 0)',label+' black outline');
       widths.push(value.outline);
      }
      assert.ok(widths[1]>widths[0]*1.4,label+' stroke grows with font');
     }finally{await page.close();}
    }
   }
  }finally{await browser.close();}
 });
}
