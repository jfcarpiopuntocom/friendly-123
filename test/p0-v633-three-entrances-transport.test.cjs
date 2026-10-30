'use strict';
// Three synthetic browser storage profiles using the real bundled Yjs CRDT.
// This is not a physical-device performance or relay certification.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {browser}=require('./helpers/browser.cjs');
const {webcrypto}=require('node:crypto');
const vendor=fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8');
function peer(name,origin){
  const w=browser();delete w.JSON;Object.assign(w,{crypto:webcrypto,TextEncoder,TextDecoder});w.location.origin=origin;vm.runInContext(vendor,w);
  w.localStorage.setItem('f123_owned',JSON.stringify({licenseCode:'F123-SYNTHETIC-SAME-ROOM',instanceId:name}));
  const doc=new w.Y.Doc();
  return {w,doc,meta:doc.getMap('_meta'),sales:doc.getMap('ventas'),facts:doc.getMap('hechos')};
}
function exchange(a,b){
  const u=a.w.Y.encodeStateAsUpdate(a.doc),v=b.w.Y.encodeStateAsUpdate(b.doc);
  a.w.Y.applyUpdate(a.doc,v,'red');b.w.Y.applyUpdate(b.doc,u,'red');
}
test('PWA + second browser + official site merge PIN, sales and stock facts by ID',()=>{
  const a=peer('pwa','https://jfcarpiopuntocom.github.io');
  const b=peer('other-browser','https://jfcarpiopuntocom.github.io');
  const c=peer('official','https://friendly123.com');
  assert.notEqual(a.w.localStorage,b.w.localStorage);
  assert.notEqual(b.w.localStorage,c.w.localStorage);
  for(const p of [a,b,c])assert.equal(JSON.parse(p.w.localStorage.getItem('f123_owned')).licenseCode,'F123-SYNTHETIC-SAME-ROOM');
  a.meta.set('pinsRol',{owner:'642',emp:'583',acct:'914'});
  a.meta.set('ownerPinConfirmado','642');a.meta.set('ownerPinCambioRev',0);
  exchange(a,b);exchange(a,c);
  a.doc.transact(()=>{a.meta.set('pinsRol',{owner:'731',emp:'583',acct:'914'});a.meta.set('ownerPinConfirmado','731');a.meta.set('ownerPinCambioRev',1)});
  a.sales.set('sale-a',{id:'sale-a',amount:12});
  b.sales.set('sale-b',{id:'sale-b',amount:14});
  b.facts.set('payment-b',{id:'payment-b',kind:'payment',amount:4});
  c.facts.set('stock-c',{id:'stock-c',kind:'stock',delta:-1});
  for(let i=0;i<4;i++){exchange(a,b);exchange(b,c);exchange(c,a)}
  for(const p of [a,b,c]){
    assert.equal(p.meta.get('ownerPinConfirmado'),'731');
    assert.equal(p.meta.get('ownerPinCambioRev'),1);
    assert.equal(p.meta.get('pinsRol').emp,'583');
    assert.equal(p.sales.size,2);assert.equal(p.facts.size,2);
  }
  const count=c.sales.size;exchange(c,a);exchange(a,c);assert.equal(c.sales.size,count);
  for(const p of [a,b,c])p.doc.destroy();
});
