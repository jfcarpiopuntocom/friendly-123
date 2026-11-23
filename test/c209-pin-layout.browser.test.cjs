'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium, webkit} = require('playwright');

const root = path.resolve(__dirname, '..');
const ui2 = fs.readFileSync(path.join(root, 'docs/ui2.css'), 'utf8');
const auth = fs.readFileSync(path.join(root, 'docs/auth-ui.js'), 'utf8');
const css = auth.match(/css\.textContent\s*=\s*`([\s\S]*?)`;/)?.[1];
assert.ok(css, 'read real auth PIN stylesheet from source');
assert.doesNotMatch(ui2, /html\.ui2\s+\.caja(?:\s|[:>{,.])/,
  'unscoped card selector must never target the PIN gate');
assert.match(ui2, /html\.ui2 #gridInventario \.caja>div:not\(\.ajuste-rapido\)/);
assert.match(ui2, /html\.ui2 #oc-gate \.caja\{box-sizing:border-box/);

for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  test('C209 real ' + name + ': PIN stays horizontal at phone widths, with inventory layout unchanged', async () => {
    const browser = await engine.launch({headless:true});
    try {
      for (const [width,height] of [[320,667],[375,812],[390,844],[667,375]]) {
        const page = await browser.newPage({viewport:{width,height},isMobile:true,hasTouch:true});
        try {
          await page.setContent('<!doctype html><html class="ui2"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="oc-gate"><div class="caja"><div class="oc-slots" id="oc-slots"><div class="slot"></div><div class="slot"></div><div class="slot"></div></div><div class="oc-pad" id="oc-pad">' + Array.from({length:10}, (_,i)=>'<button type="button"><span class="dig">'+i+'</span></button>').join('') + '</div></div></div><div id="gridInventario"><div class="caja"><div class="nombre">Item</div><div class="detalle">Detail</div></div></div></body></html>');
          await page.addStyleTag({content:ui2});
          await page.addStyleTag({content:css});
          const values = await page.evaluate(() => {
            const gate=document.querySelector('#oc-gate .caja');
            const slots=[...document.querySelectorAll('#oc-slots .slot')].map(e=>e.getBoundingClientRect());
            const keys=[...document.querySelectorAll('#oc-pad button')].map(e=>e.getBoundingClientRect());
            return {
              slots:getComputedStyle(document.querySelector('#oc-slots')).display,
              pad:getComputedStyle(document.querySelector('#oc-pad')).display,
              columns:getComputedStyle(document.querySelector('#oc-pad')).gridTemplateColumns.trim().split(/\s+/).length,
              gateLeft:gate.getBoundingClientRect().left,gateRight:gate.getBoundingClientRect().right,
              cardBox:getComputedStyle(gate).boxSizing,
              slotX:slots.map(x=>x.x),slotY:slots.map(x=>x.y),
              keysX:keys.slice(0,5).map(x=>x.x),keysY:keys.slice(0,5).map(x=>x.y),
              inventoryChild:getComputedStyle(document.querySelector('#gridInventario .nombre')).display
            };
          });
          assert.equal(values.slots,'flex',name+' '+width+' slots must be a row');
          assert.equal(values.pad,'grid',name+' '+width+' PIN pad must be grid');
          assert.equal(values.columns,5,name+' '+width+' PIN has five columns');
          assert.equal(values.cardBox,'border-box');
          assert.ok(values.gateLeft>=-1 && values.gateRight<=width+1,name+' '+width+' PIN card in viewport '+JSON.stringify(values));
          assert.ok(values.slotX[0]<values.slotX[1] && values.slotX[1]<values.slotX[2],name+' '+width+' PIN slots horizontal');
          assert.equal(values.slotY[0],values.slotY[1]);
          assert.ok(values.keysX[0]<values.keysX[1] && values.keysX[1]<values.keysX[2]);
          assert.equal(values.keysY[0],values.keysY[4]);
          assert.equal(values.inventoryChild,'block');
        } finally {await page.close();}
      }
    } finally {await browser.close();}
  });
}
