'use strict';
// C204 (JFC): "ellos pueden tener su foto completa en SU disco, pero la app syncea solo miniaturas".
// Una foto NUEVA de percha: el puntero/sync lleva una miniatura chica con su propio SHA; la foto completa
// queda SOLO en este aparato (clave "<hashMiniatura>.full", fuera del inventario que siembra el relay).
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const idbSrc=fs.readFileSync(path.join(root,'docs/idb-fotos.js'),'utf8');
const recover=require(path.join(root,'docs/application/recover-shelf-photo.js'));
const MAX_MINIATURA=40*1024;

async function conPagina(fn){
 const {chromium}=require('playwright');
 const browser=await chromium.launch();
 try{
  const page=await (await browser.newContext()).newPage();
  await page.route('https://f123.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>t</title>'}));
  await page.goto('https://f123.test/');
  await page.addScriptTag({content:idbSrc});
  return await fn(page);
 }finally{await browser.close();}
}
// Foto "de camara": 2000x1500 con ruido (peor caso: el JPEG casi no comprime).
const fotoGrande=()=>{const c=document.createElement('canvas');c.width=2000;c.height=1500;const x=c.getContext('2d');
 for(let i=0;i<4000;i++){x.fillStyle='hsl('+(i*37%360)+',70%,'+(20+i%60)+'%)';x.fillRect((i*97)%2000,(i*61)%1500,40+i%80,30+i%60);}
 return c.toDataURL('image/jpeg',0.82);};

test('C204 RED->GREEN: la miniatura es lo unico que entra al inventario de sync; la foto completa queda local y en el export',async()=>{
 const r=await conPagina(page=>page.evaluate(async fotoSrc=>{
  const O=window.OCFotos,mk=eval('('+fotoSrc+')');
  const full=mk();
  // Evidencia previa que JAMAS debe tocarse: foto por id y blob viejo por hash.
  const vieja='data:image/jpeg;base64,AAAA',hViejo=await O.hashDeDataUrl(vieja);
  await O.guardarFoto('shelf-old',vieja);await O.guardarPorHash(hViejo,vieja);
  const h=await O.guardarFotoConMiniatura(full);
  const thumb=await O.leerPorHash(h),inv=await O.hashesGuardados(),todo=await O.leerTodosPorHash();
  return{fullLen:full.length,thumbLen:thumb&&thumb.length,hashOk:thumb&&(await O.hashDeDataUrl(thumb))===h,
   hFull:await O.hashDeDataUrl(full),h,inv,fullLocal:await O.leerPorHash(h+'.full')===full,
   exportaFull:todo[h+'.full']===full,viejaPorId:await O.leerFoto('shelf-old'),viejoBlob:await O.leerPorHash(hViejo),vieja,hViejo};
 },fotoGrande.toString()));
 assert.ok(r.thumbLen<=MAX_MINIATURA,'miniatura <= 40 KB (fue '+r.thumbLen+' vs completa '+r.fullLen+')');
 assert.ok(r.thumbLen*3<=r.fullLen,'al menos 2/3 menos bytes por el sync');
 assert.equal(r.hashOk,true,'el puntero es el SHA de los bytes que viajan');
 assert.notEqual(r.h,r.hFull,'el puntero NO es el hash de la foto completa');
 assert.ok(r.inv.includes(r.h),'la miniatura si se siembra');
 assert.ok(!r.inv.includes(r.hFull)&&!r.inv.includes(r.h+'.full'),'la foto completa jamas entra al inventario de sync');
 assert.equal(r.fullLocal,true,'la foto completa vive en este aparato');
 assert.equal(r.exportaFull,true,'el respaldo manual (leerTodosPorHash) sigue incluyendo la foto completa');
 assert.equal(r.viejaPorId,r.vieja,'foto previa por id intacta');assert.equal(r.viejoBlob,r.vieja,'blob previo intacto');
 assert.ok(r.inv.includes(r.hViejo),'fotos viejas completas siguen en el inventario (nada se borra)');
});
test('C204 fail-open: si no hay codificador/imagen, se guarda la foto completa como hasta hoy (nada se pierde)',async()=>{
 const r=await conPagina(page=>page.evaluate(async()=>{
  const O=window.OCFotos,full='data:image/jpeg;base64,'+btoa('x'.repeat(300));
  const h=await O.guardarFotoConMiniatura(full);
  return{h,igual:h===await O.hashDeDataUrl(full),bytes:await O.leerPorHash(h)===full};
 }));
 assert.equal(r.igual,true);assert.equal(r.bytes,true);
});

const ports=(o)=>Object.assign({currentMappedHash:async()=>null,historyHashes:async()=>[],hashBytes:async b=>'h:'+b,
 readSyncByHash:async()=>null,preserveByHash:async()=>{},warn(){}},o);
test('C204: con puntero a miniatura se muestra la foto completa local y NO se pisa la foto por id',async()=>{
 const saved=[];
 const res=await recover.recoverShelfPhoto({id:'s1',fotoHash:'HT'},ports({
  readPerId:async()=>'FULL-BYTES-LONG',readByHash:async h=>h==='HT'?'THUMB':null,readFullByHash:async h=>h==='HT'?'FULL-BYTES-LONG':null,
  preserveById:async(id,b)=>{saved.push(b);}}));
 assert.equal(res.displayBytes,'FULL-BYTES-LONG');
 assert.deepEqual(saved,[],'la miniatura no sobrescribe la foto completa por id');
});
test('C204: aparato sin foto completa muestra la miniatura; una foto por id mas grande jamas se degrada',async()=>{
 const saved=[];
 const a=await recover.recoverShelfPhoto({id:'s1',fotoHash:'HT'},ports({readPerId:async()=>null,readByHash:async()=>'THUMB',preserveById:async(i,b)=>{saved.push(b);}}));
 assert.equal(a.displayBytes,'THUMB');assert.deepEqual(saved,['THUMB'],'comportamiento actual intacto para quien solo tiene la miniatura');
 saved.length=0;
 await recover.recoverShelfPhoto({id:'s1',fotoHash:'HT'},ports({readPerId:async()=>'MUCHO-MAS-GRANDE-QUE-LA-MINIATURA',readByHash:async()=>'THUMB',preserveById:async(i,b)=>{saved.push(b);}}));
 assert.deepEqual(saved,[],'no degradar la foto por id');
});
