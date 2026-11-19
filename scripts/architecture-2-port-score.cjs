#!/usr/bin/env node
'use strict';
// PORT = code assembled into friendly-123, not a separately shipped app.
// Reproducible weighted capabilities, with physical/customer GO kept separate.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const load=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
function oneDecimal(n){return Math.round((n+Number.EPSILON)*10)/10;}
function inspect(){
 const data=load('docs/engineering/architecture-2-port-score.json');
 const quality=load('docs/engineering/architecture-2-quality-score.json');
 assert.equal(data.schema,1);
 assert.equal(quality.schema,1);
 assert.equal(data.maximum,100);
 assert.equal(quality.maximum,100);
 assert.equal(data.assessedProductSha,quality.assessedProductSha);
 assert.match(data.assessedProductSha,/^[a-f0-9]{40}$/);
 assert.equal(data.commercialGo.separate,true);
 const cats=new Set(),stages=new Set();
 let totalWeight=0,totalEarned=0;
 for(const group of data.groups){
  assert(!cats.has(group.id),'duplicate group '+group.id);cats.add(group.id);
  assert(group.weight>0 && Number.isFinite(group.weight));
  totalWeight+=group.weight;let capacity=0;
  for(const item of group.milestones){
   assert(!stages.has(item.id),'duplicate milestone '+item.id);stages.add(item.id);
   assert(typeof item.done==='boolean');
   assert(item.points>0&&Number.isFinite(item.points));
   capacity+=item.points;
   if(item.done){
    assert(typeof item.source==='string'&&item.source.length>0,'missing code source '+item.id);
    assert(fs.existsSync(path.join(root,item.source)),'credited code missing: '+item.id+': '+item.source);
    assert(item.evidence?.includes('/blob/'+data.assessedProductSha+'/'),'evidence must be pinned to assessed product SHA '+item.id);
    totalEarned+=item.points;
   }
  }
  assert.equal(oneDecimal(capacity),oneDecimal(group.weight),'incorrect category budget '+group.id);
 }
 const compiledStage=data.groups.flatMap(group=>group.milestones).find(item=>item.id==='read-only-browser-join');
 if(compiledStage?.done){
  const vendor=fs.readFileSync(path.join(root,'docs/vendor/yparty-piloto.min.js'),'utf8');
  assert(vendor.includes('leerCatalogoPublicoCertificado'),
    'C12 credits are invalid unless the real shipped browser bundle has the method');
  const manifest=load('docs/version-manifest.json');
  const digest='sha256-'+crypto.createHash('sha256')
    .update(vendor.replace(/\r\n/g,'\n')).digest('hex');
  assert.equal(manifest.files['./vendor/yparty-piloto.min.js'],digest,
    'C12 credits require the exact real browser vendor integrity seal');
 }
 const wiredReaderStage=data.groups.flatMap(group=>group.milestones).find(item=>item.id==='real-public-reader-on-client');
 if(wiredReaderStage?.done){
  const syncSrc=fs.readFileSync(path.join(root,'docs/sync-yjs.js'),'utf8');
  assert(syncSrc.includes('_crearLectorCatalogoPublicoCertificado')&&
    syncSrc.includes('API.leerCatalogoPublicoCertificado'),
    'C13 credits are invalid unless docs/sync-yjs.js wires the certified reader lifecycle');
  const manifest=load('docs/version-manifest.json');
  const digest='sha256-'+crypto.createHash('sha256')
    .update(syncSrc.replace(/\r\n/g,'\n')).digest('hex');
  assert.equal(manifest.files['./sync-yjs.js'],digest,
    'C13 credits require the exact docs/sync-yjs.js integrity seal in version-manifest.json');
 }
 assert.equal(oneDecimal(totalWeight),100,'milestone weights must sum to 100');
 assert.equal(oneDecimal(totalEarned),data.score,'score must equal actual checked milestones');
 assert(data.baseline.score>=0 && data.baseline.score<data.score);
 assert(oneDecimal(data.score-data.baseline.score)>=10,'C8-C13 baseline delta must be independently visible');
 // Quality points above the previous 6.5/10 photo baseline are earned
 // only while the SHIPPED v804 source is CAS-safe and its integrity manifest
 // matches the exact bytes served to customers. The commercial GO is separate.
 const photoQuality=quality.dimensions.find(d=>d.id==='photos');
 if(photoQuality?.score>=7){
  const ui=fs.readFileSync(path.join(root,'docs/vista-perchas.js'),'utf8');
  const manifest=load('docs/version-manifest.json');
  const digest='sha256-'+crypto.createHash('sha256').update(ui.replace(/\r\n/g,'\n')).digest('hex');
  assert.equal(manifest.files['./vista-perchas.js'],digest,
    'Belén CAS quality credit requires sealed real browser code');
  assert(ui.includes('expectedFotoHash')&&ui.includes('expectedFotoRev'),
    'Belén CAS quality credit requires both preimage fields');
  assert(ui.includes('if (!Object.prototype.hasOwnProperty.call(preimagenPorId, String(id))) return false;')&&
    ui.includes("if (!preimagenFoto) throw new Error('Photo CAS preimage unavailable');")&&
    ui.includes("if (!preimagenRestore) throw new Error('Photo CAS preimage unavailable');"),
    'Belén CAS quality credit requires fail-closed preimage in recovery, camera and vault');
  assert(fs.existsSync(path.join(root,'test/p0-belen-vista-perchas-cas-e2e.test.cjs')),
    'Belén CAS quality credit needs its real-source regression test');
  assert(quality.latestQualityEvidence?.verifiedProductMergeSha==='49fe066024ab529b182327bd98ae76884b13ded2'&&
    quality.latestQualityEvidence.qualityDelta===0.5 &&
    quality.latestQualityEvidence.portDelta===0,
    'Belén CAS source and metric must have immutable merge evidence and no fictitious PORT points');
 }
 const dims=new Set();let qWeight=0,qScore=0,qPrevious=0;
 for(const d of quality.dimensions){
  assert(!dims.has(d.id),'duplicate quality dimension '+d.id);dims.add(d.id);
  assert(d.score>=0&&d.score<=d.weight);
  assert(d.previous>=0&&d.previous<=d.weight);
  assert(typeof d.justification==='string'&&d.justification.length>15);
  if(d.score!==d.previous)assert(d.evidence?.startsWith('https://github.com/'),'delta must link evidence');
  qWeight+=d.weight;qScore+=d.score;qPrevious+=d.previous;
 }
 assert.equal(oneDecimal(qWeight),100);
 assert.equal(oneDecimal(qScore),quality.score);
 assert.equal(oneDecimal(qPrevious),quality.comparison.previousScore);
 return Object.freeze({sha:data.assessedProductSha,port:data.score,portBefore:data.baseline.score,
  portDelta:oneDecimal(data.score-data.baseline.score),quality:quality.score,qualityBefore:qPrevious,
  qualityDelta:oneDecimal(quality.score-qPrevious),go:data.commercialGo.certifiedGates+'/'+data.commercialGo.totalGates});
}
if(require.main===module){
 try{const result=inspect();
  if(process.argv.includes('--json'))console.log(JSON.stringify(result));
  else console.log('APP REAL '+result.sha+' | PORT '+result.port.toFixed(1)+'/100 (+'+
    result.portDelta.toFixed(1)+' vs post-D7) | calidad '+result.quality.toFixed(1)+
    '/100 (+'+result.qualityDelta.toFixed(1)+') | GO '+result.go);}
 catch(error){console.error('PORT SCORE INVALID: '+error.message);process.exitCode=1;}
}
module.exports={inspect};
