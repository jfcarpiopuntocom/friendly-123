'use strict';
/* Read-only OpenChain evidence checks. No network, writes, third-party installs or release changes. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const manifest=JSON.parse(read('docs/version-manifest.json'));
const evidence=JSON.parse(read('compliance/asset-identity-v558.json'));

test('evidence states partial verification and never claims certification',()=>{
 assert.equal(evidence.assets.length,6);
 assert.ok(evidence.limitations.some(s=>/not exact upstream binary/i.test(s)));
 assert.ok(evidence.limitations.some(s=>/Yjs composition/i.test(s)));
 assert.equal(new Set(evidence.assets.map(a=>a.path)).size,6);
 for(const a of evidence.assets) assert.match(a.provenanceStatus,/PARTIAL|OPEN/);
});
for(const a of evidence.assets){
 test('asset matches evidence and v558 manifest: '+a.path,()=>{
  assert.match(a.path,/^docs\/(?:fonts\/[^/]+\.woff2|qrcode-local\.js|vendor\/yjs-bundle\.min\.js)$/);
  assert.match(a.sha256,/^[a-f0-9]{64}$/);
  assert.equal(sha(read(a.path)),a.sha256);
  assert.equal(manifest.files['./'+a.path.slice(5)],'sha256-'+a.sha256);
 });
}
test('font version evidence does not claim exact upstream bytes',()=>{
 const fonts=evidence.assets.filter(a=>a.kind==='font');
 assert.equal(fonts.length,4);
 for(const a of fonts){
  assert.match(a.embeddedVersion,/^Version \d/);
  assert.equal(a.upstreamLicense,'OFL-1.1');
  assert.match(a.provenanceStatus,/exact upstream binary not proven/);
 }
});
test('QR header names upstream and MIT but version remains unverified',()=>{
 const qr=evidence.assets.find(a=>a.path==='docs/qrcode-local.js');
 const txt=read(qr.path).toString('utf8');
 assert.match(txt.slice(0,700),/Copyright \(c\) 2009 Kazuhiko Arase/);
 assert.match(txt.slice(0,700),/MIT license/);
 assert.equal(qr.embeddedVersion,null);
});
test('Yjs exports identified while bundle composition remains open',()=>{
 const bundle=evidence.assets.find(a=>a.path==='docs/vendor/yjs-bundle.min.js');
 const txt=read(bundle.path).toString('utf8');
 assert.match(txt,/globalThis\.Y=/);
 assert.match(txt,/globalThis\.IndexeddbPersistence=/);
 assert.match(bundle.provenanceStatus,/OPEN/);
});
test('tampered bytes cannot pass integrity checks',()=>{
 const item=evidence.assets[0];
 assert.notEqual(sha(Buffer.concat([read(item.path),Buffer.from([1])])),item.sha256);
});
