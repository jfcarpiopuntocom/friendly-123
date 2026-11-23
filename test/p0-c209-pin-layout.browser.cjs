'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium,webkit}=require('playwright');
const auth=fs.readFileSync('docs/auth-ui.js','utf8');
const ui=fs.readFileSync('docs/ui2.css','utf8');
const cssMatch=/css\.textContent = `([\s\S]*?)`;/m.exec(auth);
assert.ok(cssMatch,'extract actual injected PIN CSS from shipped auth UI source');
const pageHtml='<!doctype html><html class="ui2"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+
  cssMatch[1]+'</style><style>'+ui+'</style></head><body>'+
  '<div id="oc-gate"><div class="caja"><div class="oc-slots">'+
  Array.from({length:3},()=>'<div class="slot"></div>').join('')+
  '</div><div class="oc-pad">'+
  Array.from({length:10},(_,i)=>'<button type="button"><span class="dig">'+i+'</span></button>').join('')+
  '</div></div></div><div id="gridInventario"><div class="caja"><div class="item-probe">Stock</div></div></div>'+
  '</body></html>';
for(const [name,engine] of [['Chromium',chromium],['WebKit',webkit]]){
 test('C209 '+name+' actual PIN CSS remains horizontal on iPhone widths and landscape',{timeout:120000},async()=>{
   const browser=await engine.launch({headless:true});
   try{
     for(const [width,height] of [[320,640],[375,667],[390,844],[568,320]]){
       const page=await browser.newPage({viewport:{width,height}});
       try{
         await page.setContent(pageHtml,{waitUntil:'load'});
         const x=await page.evaluate(()=>{
           const g=document.querySelector('#oc-gate'),card=g.querySelector('.caja');
           const slots=g.querySelector('.oc-slots'),pad=g.querySelector('.oc-pad');
           const r=el=>el.getBoundingClientRect();
           return {slots:getComputedStyle(slots).display,pad:getComputedStyle(pad).display,
             grid:getComputedStyle(pad).gridTemplateColumns.split(' ').length,
             cardRight:r(card).right,cardLeft:r(card).left,viewport:innerWidth,
             slotXs:[...slots.children].map(el=>r(el).left),
             keyXs:[...pad.children].map(el=>r(el).left),
             keyYs:[...pad.children].map(el=>r(el).top),
             inventoryRule:getComputedStyle(document.querySelector('#gridInventario .item-probe')).display};
         });
         assert.equal(x.slots,'flex',name+' '+width+' PIN slots must flex');
         assert.equal(x.pad,'grid',name+' '+width+' PIN keys must grid');
         assert.equal(x.grid,5,name+' '+width+' PIN must have five columns');
         assert.ok(x.cardLeft>=-1&&x.cardRight<=x.viewport+1,name+' '+width+' card fits viewport '+JSON.stringify(x));
         assert.ok(x.slotXs[0]<x.slotXs[1]&&x.slotXs[1]<x.slotXs[2],name+' '+width+' slots horizontal');
         assert.ok(x.keyXs[0]<x.keyXs[1]&&x.keyXs[1]<x.keyXs[2]&&x.keyXs[2]<x.keyXs[3]&&x.keyXs[3]<x.keyXs[4],name+' '+width+' keys horizontal');
         assert.ok(x.keyYs[5]>x.keyYs[0],name+' '+width+' second keypad row');
         assert.equal(x.inventoryRule,'block',name+' inventory style still active');
       }finally{await page.close()}
     }
   }finally{await browser.close()}
 });
}
