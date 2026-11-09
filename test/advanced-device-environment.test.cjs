'use strict';
// Local-only device/browser hint in Advanced. No license, notebook or transport reads.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.resolve(__dirname,'../docs/index.html'),'utf8');
const match=html.match(/<script id="oc-device-label-script">([\s\S]*?)<\/script>/);
assert.ok(match,'Advanced must ship a self-contained environment label');
const script=match[1];

function render({ua='',platform='',touch=0,pwa=false,standalone=false,nickname=''}={}) {
  const el={'oc-advanced-device-env':{textContent:''},'oc-advanced-device-name':{textContent:''}};
  const events={};
  let name=nickname;
  const win={
    navigator:{userAgent:ua,platform,maxTouchPoints:touch,standalone},
    matchMedia:q=>({matches:q==='(display-mode: standalone)'&&pwa}),
    OCMicelio:{miApodo:()=>name},
    t:key=>key==='device.name'?'Name this device':key,
    addEventListener:(key,fn)=>{events[key]=fn}
  };
  vm.runInNewContext(script,{window:win,document:{getElementById:id=>el[id]||null}});
  return {environment:()=>el['oc-advanced-device-env'].textContent,
    nickname:()=>el['oc-advanced-device-name'].textContent,
    rename:value=>{name=value;events['oc-micelio-cambio']()},
    login:()=>events['oc-login'](),
    changeLanguage:()=>events['oc-lang-change']()};
}
const iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Mobile/15E148 Safari/604.1';
const operaWin='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0';
test('iPhone Safari and iPhone installed PWA are distinguishable',()=>{
  assert.equal(render({ua:iphone,nickname:'Counter phone'}).environment(),'iPhone · Safari');
  const pwa=render({ua:iphone,standalone:true,nickname:'Counter PWA'});
  assert.equal(pwa.environment(),'iPhone · PWA','do not claim Safari is the app-origin browser');
  assert.equal(pwa.nickname(),'Counter PWA');
});
test('Opera/Opera iOS, Chrome Android, Windows PC and masquerading iPadOS are labelled',()=>{
  assert.equal(render({ua:operaWin}).environment(),'Windows PC · Opera');
  assert.equal(render({ua:iphone.replace('Version/17','OPiOS/17')}).environment(),'iPhone · Opera');
  assert.equal(render({ua:'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36'}).environment(),'Android phone · Chrome');
  assert.equal(render({ua:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',platform:'MacIntel',touch:5}).environment(),'iPad · Safari');
});
test('new name appears alongside detected environment and survives subsequent paint events',()=>{
  const a=render({ua:operaWin,nickname:''});
  assert.equal(a.nickname(),'Name this device');
  a.rename('My workstation');
  assert.equal(a.nickname(),'My workstation');
  a.login();a.changeLanguage();
  assert.equal(a.nickname(),'My workstation');
  assert.equal(a.environment(),'Windows PC · Opera');
});
test('unknown browser stays unknown instead of being falsely identified',()=>{
  assert.equal(render({ua:'OpaqueUA'}).environment(),'Device · Browser');
  assert.doesNotMatch(script,/fetch\(|localStorage|sessionStorage|WebSocket|ponerApodo\(/,'display-only detection must not write user identity');
});
