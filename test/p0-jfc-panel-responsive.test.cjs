'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
const html=fs.readFileSync(path.join(__dirname,'../docs/panel.html'),'utf8');
const styles=[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(x=>x[1]).join('\n');
const row='<tr><td><input type=checkbox></td><td><span class=lic-badge>Full</span></td>'+
'<td class=mono>F123-SYNTHETIC-CODE <button class=lic-lapiz>✎</button>'+
'<button data-owner-pin-license="F123-SYNTHETIC-CODE" class="lic-lapiz lic-pin-pencil">✎ PIN</button></td>'+
'<td>Test business <button class=lic-lapiz>✎</button></td>'+
'<td>Synthetic device <button class=lic-lapiz>✎</button></td>'+
'<td>longtestdeviceaddress.synthetic@example.invalid</td><td>Test phone</td>'+
'<td>Paid <button class="btn-ok lic-mini">History</button></td><td>2026-10-31</td>'+
'<td>2026-10-31</td><td><select><option>Full</option></select>'+
'<button class="btn-ok lic-mini">More</button></td></tr>';
for(const [engine,name] of [[chromium,'chromium'],[webkit,'webkit']]){
 test('JFC panel license row stays fully usable without page overflow on '+name,{timeout:60000},async()=>{
  const browser=await engine.launch({headless:true});
  try{
   for(const width of [375,430,640,1280]){
    const page=await browser.newPage({viewport:{width,height:760}});
    try{
      await page.setContent('<html><head><meta name=viewport content="width=device-width,initial-scale=1"><style>'+styles+
       '</style></head><body><main><div class=tabla-wrap><table class=versiones id=lic-tabla style="display:table"><thead><tr>'+
       Array.from({length:11},()=>'<th>Heading</th>').join('')+'</tr></thead><tbody>'+row+
       '</tbody></table></div></main></body></html>');
      const dims=await page.evaluate(()=>{
        const b=document.querySelector('.lic-pin-pencil').getBoundingClientRect();
        return {scroll:document.documentElement.scrollWidth,view:innerWidth,visible:b.width>0&&b.height>0,
          within:b.left>=-1&&b.right<=innerWidth+1,display:getComputedStyle(document.getElementById('lic-tabla')).display,
          minTap:b.height};
      });
      if(width<=640){
        assert.ok(dims.scroll<=width+2,'overflow '+width+': '+JSON.stringify(dims));
        assert.equal(dims.display,'block');
        assert.ok(dims.visible&&dims.within,'PIN pencil clipped at '+width+': '+JSON.stringify(dims));
        assert.ok(dims.minTap>=36);
      }else{assert.equal(dims.display,'table');assert.ok(dims.visible)}
    }finally{await page.close()}
   }
  }finally{await browser.close()}
 });
}
