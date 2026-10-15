const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../docs/origin-handoff.js'),'utf8');
const LEGACY='https://jfcarpiopuntocom.github.io',OFFICIAL='https://friendly123.com';

function fakeElement(id='') {
 const callbacks={};
 const el={id,style:{},children:[],textContent:'',disabled:false,
  setAttribute(){}, addEventListener(type,fn){callbacks[type]=fn;},
  trigger(type){if(callbacks[type])callbacks[type]({currentTarget:el});},
  appendChild(child){el.children.push(child);return child;},remove(){el.removed=true;},
  insertAdjacentElement(where,child){el.inserted=child;return child;}
 };
 return el;
}
function fakeWindow(origin,saved={}) {
 const values={...saved},listeners={},pending=[];
 const gate=fakeElement('oc-gate'),join=fakeElement('oc-unirse-equipo');
 const els={'oc-gate':gate,'oc-unirse-equipo':join};
 const win={location:{origin,hash:''},localStorage:{getItem:k=>values[k]??null,setItem:(k,v)=>values[k]=String(v)},
   document:{body:fakeElement('body'),getElementById:id=>els[id]||null,createElement:()=>fakeElement()},
   crypto:{getRandomValues:a=>{a.fill(7);return a;}}, Uint8Array,
   addEventListener:(t,f)=>(listeners[t]=listeners[t]||[]).push(f),
   removeEventListener:(t,f)=>listeners[t]=(listeners[t]||[]).filter(x=>x!==f),
   dispatchMessage:ev=>(listeners.message||[]).forEach(fn=>fn(ev)),
   setTimeout:(f)=>pending.push(f), flush(){while(pending.length)pending.shift()();},
   open(){return null;}, _els:els, _join:join, _values:values };
 return win;
}
function load(win){new Function('window',source)(win);}

test('v523 official address offers user-directed one-time recovery, no implicit join',()=>{
 const official=fakeWindow(OFFICIAL);
 let joined=0,license='';
 official.OCSyncControl={unirse:(c)=>{joined++;license=c;return {ok:true};}};
 const legacy=fakeWindow(LEGACY,{f123_owned:JSON.stringify({licenseCode:'F123-TEST-0000'})});
 legacy.opener=official;
 official.open=(url,target)=>{
   assert.match(url,/^https:\/\/jfcarpiopuntocom.github.io\/friendly-123\/#f123-handoff=[a-f0-9]{32}$/);
   assert.equal(url.includes('F123-'),false,'license must never enter a URL');
   legacy.location.hash='#'+url.split('#')[1];
   load(legacy);
   return legacy;
 };
 legacy.postMessage=(data,target)=>{if(target===LEGACY)legacy.dispatchMessage({origin:OFFICIAL,source:official,data});};
 official.postMessage=(data,target)=>{if(target===OFFICIAL)official.dispatchMessage({origin:LEGACY,source:legacy,data});};
 load(official);
 const button=official._join.inserted;
 assert.ok(button,'recovery is adjacent to the existing Join team control');
 assert.equal(joined,0);
 button.trigger('click');
 legacy.flush(); // legacy page ready -> official request -> owner approval
 assert.equal(joined,0,'old-origin approval is mandatory');
 const approval=legacy.document.body.children[0];
 assert.ok(approval,'owner sees an explicit approval dialog in the legacy origin');
 const card=approval.children[0],yes=card.children.find(c=>/Authorize|Autorizar/.test(c.textContent));
 assert.ok(yes);
 // Spoofed origin and nonce never cause an unintended join.
 official.dispatchMessage({origin:'https://evil.invalid',source:legacy,data:{tag:'f123-origin-handoff-v1',nonce:'07'.repeat(16),type:'grant',code:'F123-FAKE'}});
 official.dispatchMessage({origin:LEGACY,source:legacy,data:{tag:'f123-origin-handoff-v1',nonce:'deadbeef',type:'grant',code:'F123-FAKE'}});
 assert.equal(joined,0);
 yes.trigger('click');
 assert.equal(joined,1);
 assert.equal(license,'F123-TEST-0000');
 assert.equal(official._values.f123_owned,undefined,'handoff never directly overwrites identity');
});
test('v523 source without prior team code never transmits a made-up license',()=>{
 const official=fakeWindow(OFFICIAL),legacy=fakeWindow(LEGACY);
 legacy.opener=official;
 let joins=0;official.OCSyncControl={unirse:()=>{joins++;return {ok:true};}};
 official.open=(url)=>{legacy.location.hash='#'+url.split('#')[1];load(legacy);return legacy;};
 legacy.postMessage=(data,t)=>{if(t===LEGACY)legacy.dispatchMessage({origin:OFFICIAL,source:official,data});};
 official.postMessage=(data,t)=>{if(t===OFFICIAL)official.dispatchMessage({origin:LEGACY,source:legacy,data});};
 load(official);official._join.inserted.trigger('click');legacy.flush();
 assert.equal(joins,0);assert.equal(legacy.document.body.children.length,0,'no approval dialog for absent license');
});
test('v523 an existing licensed local notebook is never automatically switched',()=>{
 const official=fakeWindow(OFFICIAL,{f123_owned:JSON.stringify({instanceId:'synthetic',licenseCode:'F123-TEST-0000'})});
 load(official);assert.equal(official._join.inserted,undefined);
});
