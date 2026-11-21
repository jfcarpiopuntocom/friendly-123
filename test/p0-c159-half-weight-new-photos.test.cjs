'use strict';
// C159 JFC HARD RULE: target half the stored/transmitted bytes of new photos,
// without re-encoding the existing JPEG and without reducing the chosen pixels.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const storage=fs.readFileSync(path.join(root,'docs/idb-fotos.js'),'utf8');
function api(){const window={};vm.runInNewContext(storage,{window,console});return window.OCFotos;}
function url(mime,size){const prefix='data:image/'+mime+';base64,';return prefix+'A'.repeat(Math.max(0,size-prefix.length));}
function canvas(sizes){let qualities=[],mime=[];const cv={width:1200,height:800,toDataURL(type,quality){mime.push(type);qualities.push(quality);const k=quality>=.92?'high':quality>=.88?'medium':'low';return url('webp',sizes[k]);}};return{cv,qualities,mime};}

test('C159 RED: high-fidelity WebP reduces eligible new shelf/receipt photo to <= 50% at unchanged resolution',()=>{
 const s=api(),base=url('jpeg',160000),{cv,qualities}=canvas({high:142000,medium:107000,low:74500});
 assert.equal(typeof s.optimizarCapturaFoto,'function','the actual photo module exports the one shared optimizer');
 const out=s.optimizarCapturaFoto(cv,base,180000);
 assert.match(out,/^data:image\/webp;base64,/);
 assert.ok(out.length<=base.length*.5,'target half of the legacy JPEG bytes when feasible at high quality');
 assert.equal(cv.width,1200);assert.equal(cv.height,800);
 assert.ok(qualities.every(q=>q>=.84),'never sacrifice photo quality to an arbitrary lower JPEG setting');
});
test('C159: choose the highest quality meeting target, not the smallest lossy output',()=>{
 const {cv,qualities}=canvas({high:72000,medium:51000,low:33000});
 const out=api().optimizarCapturaFoto(cv,url('jpeg',160000),180000);
 assert.equal(out.length,72000);
 assert.deepEqual(qualities,[.92],'stop once 50% is reached at the highest visual quality');
});
test('C159: no WebP encoder or exceptions => original JPEG unchanged, never invent output or lose receipt',()=>{
 const base=url('jpeg',100000),s=api();
 assert.equal(s.optimizarCapturaFoto({toDataURL:()=>url('png',40000)},base),base);
 assert.equal(s.optimizarCapturaFoto({toDataURL:()=>{throw Error('encoder failed')}},base),base);
 assert.equal(s.optimizarCapturaFoto(null,base),base);
});
test('C159: above-target WebP only replaces JPEG if smaller and under 180K relay cap',()=>{
 const s=api(),base=url('jpeg',160000),{cv}=canvas({high:130000,medium:121000,low:119000});
 const out=s.optimizarCapturaFoto(cv,base,180000);
 assert.match(out,/^data:image\/webp;base64,/);
 assert.ok(out.length<base.length,'never increase payload just to switch format');
 assert.ok(out.length<=180000);
 const huge=canvas({high:190000,medium:185000,low:181000}).cv;
 assert.equal(s.optimizarCapturaFoto(huge,base,180000),base,'oversize candidate never chosen');
});
test('C159: shelf and expenses both optimize from original pixels before durable hash/storage',()=>{
 const shelf=fs.readFileSync(path.join(root,'docs/vista-perchas.js'),'utf8');
 const receipt=fs.readFileSync(path.join(root,'docs/expense-receipt.js'),'utf8');
 assert.match(shelf,/OCFotos\.optimizarCapturaFoto\(/);
 assert.match(receipt,/OCFotos\.optimizarCapturaFoto\(/);
 assert.ok(shelf.indexOf('optimizarCapturaFoto')<shelf.indexOf('OCFotos.guardarFoto(id, dataUrl)'));
 assert.ok(receipt.indexOf('optimizarCapturaFoto')<receipt.indexOf('OCFotos.hashDeDataUrl(data)'));
 assert.match(storage,/guardarPorHash/);
});


test('C159: iOS Safari WebP-encoding fallback safely saves a smaller JPEG at original resolution',()=>{
 const base=url('jpeg',160000),calls=[],cv={width:1300,height:950,
  toDataURL(type,q){calls.push([type,q]);return type==='image/webp'?url('png',60000):url('jpeg',76000);}};
 const out=api().optimizarCapturaFoto(cv,base,180000,{jpegQuality:.82,jpegFloor:.74});
 assert.match(out,/^data:image\/jpeg;base64,/);
 assert.equal(out.length,76000);
 assert.ok(out.length<=base.length*.5);
 assert.equal(cv.width,1300);assert.equal(cv.height,950);
 assert.ok(calls.some(([t])=>t==='image/webp'));
 assert.ok(calls.some(([t,q])=>t==='image/jpeg'&&q>=.74));
});
test('C159: already downscaled/low-quality Safari JPEG stays intact, never recompressed below readability floor',()=>{
 const base=url('jpeg',80000),calls=[],cv={toDataURL(type,q){calls.push([type,q]);return url('png',40000);}};
 assert.equal(api().optimizarCapturaFoto(cv,base,180000,{jpegQuality:.7,jpegFloor:.77}),base);
 assert.equal(calls.filter(([t])=>t==='image/jpeg').length,0,'source q<floor cannot degrade further');
});
