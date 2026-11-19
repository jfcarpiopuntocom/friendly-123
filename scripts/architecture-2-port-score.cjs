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

 // C24: DO NOT give browser-port credit merely because the JSON says DONE.
 // C23 must be in the REAL product browser entry, the compiled distributable
 // and the guarded sync facade, all sealed by the official shell manifest.
 const browserBridge=data.groups.flatMap(g=>g.milestones).find(m=>m.id==='compiled-client-bridges-c23');
 if(browserBridge?.done){
  assert.equal(browserBridge.points,1.5,'C23 bridge must not consume legacy-retirement budget');
  const src=fs.readFileSync(path.join(root,'src/yparty-piloto.js'),'utf8');
  const syncSrc=fs.readFileSync(path.join(root,'docs/sync-yjs.js'),'utf8');
  const vendor=fs.readFileSync(path.join(root,'docs/vendor/yparty-piloto.min.js'),'utf8');
  const manifest=load('docs/version-manifest.json');
  for(const api of ['crearAlmacenDurableOpsTipadas','crearClienteFotosShaCertificado',
                    'abrirEscritorDeltaCatalogoCertificado']){
   assert(src.includes(api),'missing C23 actual browser source method '+api);
   assert(syncSrc.includes('API.'+api),'missing C23 real Sync3 facade method '+api);
   assert(vendor.includes(api),'missing C23 compiled bundle method '+api);
  }
  assert(vendor.includes('settled_ops')&&vendor.includes('markCommitted'),
    'C21b permanent post-ACK same-do fence must exist in the actual v809 browser bundle');
  for(const [rel,bytes] of [['./vendor/yparty-piloto.min.js',vendor],['./sync-yjs.js',syncSrc]]){
   const sha='sha256-'+crypto.createHash('sha256').update(bytes.replace(/\r\n/g,'\n')).digest('hex');
   assert.equal(manifest.files[rel],sha,'C23 credit requires real bundled shell integrity seal for '+rel);
  }
 }
 // C26: browser-cutover credit requires the REAL V810 published C21a
 // coordinator, not simply a source-only module or a synthetic Worker test.
 const coordinatorStage=data.groups.flatMap(g=>g.milestones).find(m=>m.id==='bundled-c21a-coordinator-c25');
 if(coordinatorStage?.done){
  assert.equal(coordinatorStage.points,0.5,'only 0.5 of offline budget for browser seam');
  const pilot=fs.readFileSync(path.join(root,'src/yparty-piloto.js'),'utf8');
  const facade=fs.readFileSync(path.join(root,'docs/sync-yjs.js'),'utf8');
  const vendor=fs.readFileSync(path.join(root,'docs/vendor/yparty-piloto.min.js'),'utf8');
  const manifest=load('docs/version-manifest.json');
  assert(pilot.includes('createVerifiedCrossDeviceFailbackCoordinator')&&
    pilot.includes('crearCoordinadorCorte20'),'C25 coordinator source missing');
  assert(facade.includes('API.crearCoordinadorCorte20')&&
    facade.includes('piloto && typeof piloto.crearCoordinadorCorte20'),
    'C25 must be exposed ONLY via existing guarded browser pilot');
  for(const key of ['crearCoordinadorCorte20','settled_ops','markCommitted',
                    'abrirEscritorDeltaCatalogoCertificado']){
   assert(vendor.includes(key),'C25 actual shipped browser bundle lacks '+key);
  }
  assert(fs.existsSync(path.join(root,'test/p0-c25-browser-coordinator-factory.test.cjs')),
    'C25 real bundled browser VM regression must exist');
  for(const [pathName,contents] of [['./vendor/yparty-piloto.min.js',vendor],['./sync-yjs.js',facade]]){
   const hash='sha256-'+crypto.createHash('sha256').update(contents.replace(/\r\n/g,'\n')).digest('hex');
   assert.equal(manifest.files[pathName],hash,'C25 real bundled SHA identity mismatch '+pathName);
  }
 }
 // C30: the fixed 100.0 budget is not expanded. Split the original 2.5
 // pending browser legacy-retirement milestone into a 0.5 code-level C27+C29
 // fence plus the remaining 2.0 still unearned full dispatch/retirement.
 // A score-only JSON claim is insufficient: check the real v812 runtime
 // published to the browser, exact deterministic manifest, and RED→GREEN test.
 const guardStage=data.groups.flatMap(g=>g.milestones)
  .find(m=>m.id==='preinit-legacy-opid-fence-c27-c29');
 if(guardStage?.done){
  assert.equal(guardStage.points,0.5,'C27+C29 guard cannot earn commercial dispatch credit');
  const leftover=data.groups.flatMap(g=>g.milestones)
   .find(m=>m.id==='typed-delta-and-legacy-retirement');
  assert.equal(leftover?.points,1.5,'after C31 only 1.5 remains unearned; fixed browser budget unchanged');
  assert.equal(leftover.done,false,'C29 must not mark live legacy route retired');
  assert.equal(data.commercialGo.certifiedGates,0,'no physical/commercial GO from pilot');
  const src=fs.readFileSync(path.join(root,'docs/sync-yjs.js'),'utf8');
  for(const token of ['API.__port2DurableFenceAvailable = true',
    'API.puedeDespacharOpEnLegado = function (opId)',
    'store.loadCommittedOpIds()',
    'store.loadAll()',
    'function publicarOpLocal(op)',
    'coordActual.canDispatchOnLegacy(op.opId)']){
   assert(src.includes(token),'C29 runtime legacy/IDB guard absent: '+token);
  }
  assert(fs.existsSync(path.join(root,'test/p0-c29-preinit-durable-opid-fence.test.cjs')),
    'C29 exact source Safari preinit RED→GREEN regression missing');
  const manifest=load('docs/version-manifest.json');
  const v=load('docs/version.json');
  const shellNum = Number((/^f123-shell-v(\d+)$/.exec(v.shell || '') || [])[1] || 0);
  const patchNum = Number((/^v0\.8\.(\d+)$/.exec(v.version || '') || [])[1] || 0);
  assert(patchNum >= 12, 'C29 must be sealed with v0.8.12+ shell');
  assert(shellNum >= 812, 'C29 must be sealed with f123-shell-v812+');
  const actual='sha256-'+crypto.createHash('sha256')
   .update(src.replace(/\r\n/g,'\n')).digest('hex');
  assert.equal(manifest.files['./sync-yjs.js'],actual,
    'C29 credit requires official shipped Sync3 source hash');
 }
 // C32: credit exactly 0.5/100 for the real C31 QA-gated commercial route,
 // not the full live dispatch, physical customer rollout, or old-engine retirement.
 const c31=data.groups.flatMap(group=>group.milestones)
   .find(item=>item.id==='qa-gated-typed-commercial-route-c31');
 if(c31?.done){
   assert.equal(c31.points,0.5,'C31 QA seam must award at most 0.5');
   const legacy=data.groups.flatMap(group=>group.milestones)
     .find(item=>item.id==='typed-delta-and-legacy-retirement');
   assert.equal(legacy?.points,1.5,'remaining legacy retirement budget 1.5');
   assert.equal(legacy.done,false,'C31 does not retire 1.0 traffic');
   assert.equal(data.commercialGo.certifiedGates,0,'C31 synthetic tests cannot certify commercial GO');
   const syncSrc=fs.readFileSync(path.join(root,'docs/sync-yjs.js'),'utf8');
   for(const token of [
     'function _traducirOpLegadoAComando20(op, licenciaFallback)',
     'API.traducirOpLegadoAComando20 = function (op)',
     'API.modoCorte20Activo === true',
     'return API.despacharOpComercialCertificada(cmd20)',
     'API.activarCorte20Runtime = async function (opc)'
   ])assert(syncSrc.includes(token),'C31 true product dispatch source missing: '+token);
   const c31Test='test/p0-c31-runtime-commercial-photo-role-cutover.test.cjs';
   assert(fs.existsSync(path.join(root,c31Test)),'C31 browser exact-source test missing');
   const testText=fs.readFileSync(path.join(root,c31Test),'utf8');
   assert(testText.includes('assert.equal(opsRequests.length, 3)'),
     'C31 must exercise three typed commands via bundled browser coordinator');
   const version=load('docs/version.json');
   assert.equal(version.version,'v0.8.13','C31 browser shell version mismatch');
   assert.equal(version.shell,'f123-shell-v813','C31 browser shell mismatch');
   const manifest=load('docs/version-manifest.json');
   const digest='sha256-'+crypto.createHash('sha256')
     .update(syncSrc.replace(/\r\n/g,'\n')).digest('hex');
   assert.equal(manifest.files['./sync-yjs.js'],digest,'C31 shipped facade integrity mismatch');
 }
 assert.equal(oneDecimal(totalWeight),100,'milestone weights must sum to 100');
 assert.equal(oneDecimal(totalEarned),data.score,'score must equal actual checked milestones');
 assert(data.baseline.score>=0 && data.baseline.score<data.score);
 assert(oneDecimal(data.score-data.baseline.score)>=10,'C8-C13 baseline delta must be independently visible');
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
  portDelta:oneDecimal(data.score-data.baseline.score),quality:quality.score,qualityBefore:oneDecimal(qPrevious),
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
