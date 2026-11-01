'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const cases=[
 {name:'store',src:'src/app/app-style-02.css',bundle:'docs/app-style-02.min.css',selector:'header h1 #oc-negocio-nombre',markup:'<header><h1><span id="oc-negocio-nombre">My small shop USA</span></h1></header>'},
 {name:'dashboard',src:'src/dashboard/dashboard-main.css',bundle:'docs/dashboard-main.min.css',selector:'.top #neg-nombre',markup:'<div class="top"><span id="neg-nombre">My small shop USA</span></div>'}
];
for(const item of cases)test('business logo black outline is 12% of font size in both '+item.name+' assets',()=>{
 for(const file of [item.src,item.bundle]){
  const css=read(file), selector=item.selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const rules=[...css.matchAll(new RegExp(selector+'\\s*\\{([^{}]+)\\}','g'))];
  const rule=rules.find(r=>r[1].includes('-webkit-text-stroke:.12em #000'))?.[1];
  assert.ok(rule,file+' must have proportional em stroke, not px');
  assert.match(css,/#EFC31A/i,file+' must contain official brand yellow');
  assert.ok(!rule.includes('-webkit-text-stroke:2px'),'a fixed px stroke is prohibited');
 }
});
test('real Chromium and WebKit paint proportional outline on mobile and PC',async()=>{
 const {chromium,webkit}=require('playwright');
 for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch({headless:true});
  try{
   for(const width of [390,1440])for(const item of cases){
    const page=await browser.newPage({viewport:{width,height:800}});
    try{
     await page.setContent('<!doctype html><html><head></head><body>'+item.markup+'</body></html>');
     await page.addStyleTag({content:read(item.bundle)});
     const v=await page.locator(item.selector).evaluate(el=>{
      const css=getComputedStyle(el);
      return {px:parseFloat(css.webkitTextStrokeWidth),font:parseFloat(css.fontSize),fill:css.webkitTextFillColor};
     });
     assert.ok(v.font>0&&Math.abs(v.px/v.font-.12)<.018,JSON.stringify({name,width,item:item.name,...v}));
     assert.equal(v.fill.replaceAll(' ',''),'rgb(239,195,26)',JSON.stringify({name,width,item:item.name,...v}));
    }finally{await page.close()}
   }
  }finally{await browser.close()}
 }
});