'use strict';
// v577 narrow branding invariant: no app behavior or customer-data dependency.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const docs=path.join(__dirname,'../docs');
const read=f=>fs.readFileSync(path.join(docs,f));
const html=f=>read(f).toString('utf8');
const version=JSON.parse(html('version.json'));
const manifest=JSON.parse(html('manifest.json'));
const hashes=JSON.parse(html('version-manifest.json'));
const names={
 small:'icons/f123-color-v577-16.png',
 favicon:'icons/f123-color-v577-32.png',
 apple:'icons/f123-color-v577-180.png',
 app192:'icons/f123-color-v577-192.png',
 app512:'icons/f123-color-v577-512.png',
 mask:'icons/f123-color-v577-maskable-512.png',
 ico:'favicon-v577.ico'
};
test('approved official logo remains untouched, never recolored or replaced',()=>{
 const src=read('img/logo-720.png');
 assert.equal(crypto.createHash('sha256').update(src).digest('hex'),
   '621d161800503a13f3aa6248b6829ce69d9265b708d2d228e5eb051b9bd775ae');
});
test('index and Dashboard use IDENTICAL new Apple / desktop icon links',()=>{
 const index=html('index.html'),dashboard=html('dashboard.html');
 for(const file of [index,dashboard]){
   for(const name of [names.small,names.favicon,names.apple,names.ico])
     assert.ok(file.includes('./'+name),'missing icon reference '+name);
   assert.doesNotMatch(file,/<link[^>]*apple-touch-icon[^>]*href="(?:\.\/)?(?:logo\.png|icons\/apple-touch-icon\.png)"/);
 }
 assert.match(index,/<link rel="manifest" href="\.\/manifest\.json">/);
 assert.equal((dashboard.match(/Dashboard v\d+/)||[])[0],'Dashboard '+version.releaseName);
});
test('PWA install assets and maskable purpose match the same 123 brand set',()=>{
 assert.deepEqual(manifest.icons.map(({src,sizes,purpose})=>[src,sizes,purpose]),[
  ['./'+names.app192,'192x192','any'],
  ['./'+names.app512,'512x512','any'],
  ['./'+names.mask,'512x512','maskable']
 ]);
 const all=html('sw.js');
 assert.equal(version.shell,'f123-shell-v577');
 assert.equal(hashes.shell,version.shell);
 assert.match(all,/const CACHE = "f123-shell-v577"/);
 for(const name of Object.values(names))assert.ok(all.includes('./'+name),'SW must cache '+name);
});
test('new PNGs are real sized binaries, hashed exactly in the offline integrity manifest',()=>{
 for(const [f,expected] of [[names.small,16],[names.favicon,32],[names.apple,180],[names.app192,192],[names.app512,512],[names.mask,512]]){
   const buf=read(f);
   assert.equal(buf.subarray(0,8).toString('hex'),'89504e470d0a1a0a',f+' PNG signature');
   assert.equal(buf.readUInt32BE(16),expected,f+' width');
   assert.equal(buf.readUInt32BE(20),expected,f+' height');
   const hash=crypto.createHash('sha256').update(buf).digest('hex');
   assert.equal(hashes.files['./'+f],'sha256-'+hash,f+' immutable hash');
 }
 const ico=read(names.ico);
 assert.equal(ico.readUInt16LE(0),0);
 assert.equal(ico.readUInt16LE(2),1);
 assert.equal(hashes.files['./'+names.ico],
  'sha256-'+crypto.createHash('sha256').update(ico).digest('hex'));
});
test('v577 changes no app logic: core content remains on immutable approved shell',()=>{
 assert.equal(version.releaseName,'v577');
 assert.equal(version.cacheGeneration,'golden128');
 assert.ok(version.changelog.includes('icons'));
 assert.equal(manifest.background_color,'#F8F9FB');
 assert.equal(manifest.theme_color,'#0F1923');
});
