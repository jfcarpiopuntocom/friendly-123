'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const cssPairs=[
 {name:'app',source:'src/app/app-style-02.css',bundle:'docs/app-style-02.min.css',selector:'header h1 #oc-negocio-nombre',html:'<header><h1><span id="oc-negocio-nombre">My small shop</span></h1></header>'},
 {name:'dashboard',source:'src/dashboard/dashboard-main.css',bundle:'docs/dashboard-main.min.css',selector:'.top #neg-nombre',html:'<div class="top"><span id="neg-nombre">My small shop</span></div>'}
];
function wordmarkRule(css,selector){
 const esc=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const matches=[...css.matchAll(new RegExp(esc+'\\s*\\{([^{}]+)\\}','g'))];
 const chosen=matches.find(m=>/-webkit-text-stroke:\\.08em\\s+#000/i.test(m[1]));
 assert.ok(chosen,'missing proportional public wordmark rule: '+selector);
 return chosen[1];
}
for(const p of cssPairs)test('P0 '+p.name+': source and shipped bundle use the EXACT responsive logo ink',()=>{
 for(const pathname of [p.source,p.bundle]){
  const content=read(pathname),rule=wordmarkRule(content,p.selector);
  assert.match(content,/:root\s*\{--f123-business-gold-ink\s*:\s*#EFC31A\}/i,
    pathname+' must define exact official yellow');
  assert.match(rule,/color:var\(--f123-business-gold-ink\)!important/i);
  assert.match(rule,/-webkit-text-fill-color:var\(--f123-business-gold-ink\)!important/i);
  assert.match(rule,/-webkit-text-stroke:\.08em\s+#000/i);
  assert.match(rule,/paint-order:stroke\s+fill/i);
  assert.doesNotMatch(rule,/-webkit-text-stroke:\s*\d+px/i,
    'a fixed-pixel stroke loses visual ratio on mobile');
 }
});
test('P0 browser: text stroke scales to 8% of computed letter size on mobile and desktop',async()=>{
 const {chromium,webkit}=require('playwright');
 for(const [browserName,engine] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch({headless:true});
  try{
   for(const width of [390,1440]){
    const page=await browser.newPage({viewport:{width,height:800}});
    try{
     for(const p of cssPairs){
      await page.setContent('<html><head></head><body>'+p.html+'</body></html>');
      await page.addStyleTag({content:read(p.bundle)});
      const actual=await page.locator(p.selector).evaluate(el=>{
       const cs=getComputedStyle(el);
       return {fontSize:parseFloat(cs.fontSize),outline:parseFloat(cs.webkitTextStrokeWidth),
        fill:cs.webkitTextFillColor,color:cs.color};
      });
      assert.ok(actual.fontSize>0,p.name+' '+browserName+' text must have size');
      assert.ok(Math.abs(actual.outline/actual.fontSize-0.08)<0.012,
       JSON.stringify({browserName,width,name:p.name,...actual}));
      assert.match(actual.fill,/rgb\(239,\s*195,\s*26\)/i,
       JSON.stringify({browserName,width,name:p.name,...actual}));
     }
    }finally{await page.close()}
   }
  }finally{await browser.close()}
 }
});
