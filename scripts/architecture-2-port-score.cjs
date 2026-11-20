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
   const patchNumC31=Number((/^v0\.8\.(\d+)$/.exec(version.version || '') || [])[1] || 0);
   const shellNumC31=Number((/^f123-shell-v(\d+)$/.exec(version.shell || '') || [])[1] || 0);
   assert(patchNumC31 >= 13,'C31 verified runtime requires v0.8.13+ release');
   assert(shellNumC31 >= 813,'C31 verified runtime requires f123-shell-v813+');
   const manifest=load('docs/version-manifest.json');
   const digest='sha256-'+crypto.createHash('sha256')
     .update(syncSrc.replace(/\r\n/g,'\n')).digest('hex');
   assert.equal(manifest.files['./sync-yjs.js'],digest,'C31 shipped facade integrity mismatch');
 }

 // C35: only 0.5/100 for the actual C34 compatible cash-sale event source,
 // not full production dispatch or a second cash/stock writer certificate.
 const cashMilestone=data.groups.flatMap(g=>g.milestones)
   .find(m=>m.id==='real-cash-sale-envelope-c34');
 if(cashMilestone?.done){
   assert.equal(cashMilestone.points,0.5,'C34 actual compatible cash envelope earns 0.5 only');
   const full=data.groups.flatMap(g=>g.milestones).find(m=>m.id==='production-business-dispatch');
   const c36Done=data.groups.flatMap(g=>g.milestones).some(m=>m.id==='stable-real-sale-opid-c36' && m.done);
   const c40Done=data.groups.flatMap(g=>g.milestones).some(m=>m.id==='real-business-do-receipt-c40' && m.done);
    const c42Done=data.groups.flatMap(g=>g.milestones).some(m=>m.id==='real-checkout-do-status-c42' && m.done);
    assert.equal(full?.points,c42Done?1:(c40Done?1.5:(c36Done?2:2.5)),'fixed economics budget C36 + C40 + C42');
   assert.equal(full.done,false,'C34 must not certify production business dispatch');
   assert.equal(data.commercialGo.certifiedGates,0,'no commercial GO for C34 QA');
   const backend=fs.readFileSync(path.join(root,'docs/mock-backend.js'),'utf8');
   const translator=fs.readFileSync(path.join(root,'docs/sync-yjs.js'),'utf8');
   for(const token of ['const _opVenta = { productoId: p.id, delta: -cant };',
     'const _metodo20 = String(infoVenta.formaPago || "")',
     '_opVenta.cantidad = cant;', '_opVenta.amountCents = _total20;',
     'emitirOpStock("venta", _opVenta, true);']){
     assert(backend.includes(token),'C34 actual product cash event missing '+token);
   }
   const saleStart=backend.indexOf('const _opVenta = { productoId: p.id, delta: -cant };');
   const saleEmit=backend.indexOf('emitirOpStock("venta", _opVenta, true);',saleStart);
   const saved=backend.indexOf('await guardarEstadoLocal(true, true)',saleStart);
   assert(saleStart>=0 && saved>saleStart && saleEmit>saved,
     'C34 event must remain published only AFTER local strict save');
   assert(translator.includes('API.traducirOpLegadoAComando20') &&
     translator.includes('Number.isSafeInteger(p.cantidad)') &&
     translator.includes('Number.isSafeInteger(p.amountCents)'),
     'C31 typed contract must actually consume C34 payload');
   const c34Test='test/p0-c34-real-sale-envelope-contract.test.cjs';
   assert(fs.existsSync(path.join(root,c34Test)),'C34 exact-source negative regression missing');
   const c34=fs.readFileSync(path.join(root,c34Test),'utf8');
   assert(c34.includes('assert.equal(translate(payload),null') &&
     c34.includes("payload.amountCents"), 'C34 must test exact valid cash and unsafe fallbacks');
   const c33='cloudflare-yparty-worker/qa/p0-c33-sync-yjs-cutover-workerd.test.mjs';
   assert(fs.existsSync(path.join(root,c33)),'C33 real Workerd E2E missing');
   const c33src=fs.readFileSync(path.join(root,c33),'utf8');
   assert(c33src.includes('assert.equal(sqlState.receipts, 3)') &&
     c33src.includes('assert.equal(sqlState.stock, 7)'),
     'C33 must have actual SQL ledger receipts and stock assertion');
   const manifest=load('docs/version-manifest.json');
   const v=load('docs/version.json');
   const patch=Number((/^v0\.8\.(\d+)$/.exec(v.version||'')||[])[1]||0);
   const shell=Number((/^f123-shell-v(\d+)$/.exec(v.shell||'')||[])[1]||0);
   assert(patch>=14 && shell>=814,'C34 source requires sealed v814+ shell');
   const normalized='sha256-'+crypto.createHash('sha256').update(backend.replace(/\r\n/g,'\n')).digest('hex');
   assert.equal(manifest.files['./mock-backend.js'],normalized,
     'C34 credited source must match actually shipped manifest hash');
 }
 // C37 stable product opId credit, NOT business-committed/physical GO.
 const c36=data.groups.flatMap(g=>g.milestones).find(m=>m.id==='stable-real-sale-opid-c36');
 if(c36?.done){
  assert.equal(c36.points,0.5,'C36 code only 0.5');
  const left=data.groups.flatMap(g=>g.milestones).find(m=>m.id==='production-business-dispatch');
  const c40Done=data.groups.flatMap(g=>g.milestones).some(m=>m.id==='real-business-do-receipt-c40' && m.done);
  const c42Done=data.groups.flatMap(g=>g.milestones).some(m=>m.id==='real-checkout-do-status-c42' && m.done);
  assert.equal(left?.points,c42Done?1:(c40Done?1.5:2),'commercial dispatch remains unearned after C42 QA');
  assert.equal(left.done,false,'C36 does not retire business 1.0 path');
  assert.equal(data.commercialGo.certifiedGates,0,'no GO from QA');
  const backend=fs.readFileSync(path.join(root,'docs/mock-backend.js'),'utf8');
  const realtime=fs.readFileSync(path.join(root,'docs/sync-realtime.js'),'utf8');
  for(const token of ['const opIdVenta = _opIdVenta || ventaId;',
    '_opVenta.opId = opIdVenta;','/^[A-Za-z0-9_-]{8,96}$/.test(opIdVenta)',
    'emitirOpStock("venta", _opVenta, true);']){
    assert(backend.includes(token),'C36 real backend id missing '+token);
  }
  for(const token of ['const opIdVentaDurable = tipo === "venta"',
    'Number.isSafeInteger(payload.cantidad)','Number.isSafeInteger(payload.amountCents)']){
    assert(realtime.includes(token),'C36 transport guard missing '+token);
  }
  assert.equal(realtime.split('opId: opIdVentaDurable').length-1,2,
    'exact original opId must appear in BOTH old-room and roomless journal paths');
  const testFile='test/p0-c36-real-sale-opid-e2e.test.cjs';
  assert(fs.existsSync(path.join(root,testFile)),'C36 real source test missing');
  const sourceTest=fs.readFileSync(path.join(root,testFile),'utf8');
  for(const token of ["require('./helpers/browser.cjs')",
    'assert.equal(duplicate.duplicate,true','assert.equal(onDisk.opId,sale.opId',
    'assert.equal(cmd?.opId,sale.opId']){
    assert(sourceTest.includes(token),'actual durable sale identity regression missing '+token);
  }
  const manifest=load('docs/version-manifest.json'),version=load('docs/version.json');
  assert(Number((/^v0\.8\.(\d+)$/.exec(version.version||'')||[])[1]||0)>=15,
    'C36 must ship in v0.8.15+');
  assert(Number((/^f123-shell-v(\d+)$/.exec(version.shell||'')||[])[1]||0)>=815,
    'C36 must ship in f123-shell-v815+');
  for(const [name,source] of [['mock-backend.js',backend],['sync-realtime.js',realtime]]){
    const hash='sha256-'+crypto.createHash('sha256').update(source.replace(/\r\n/g,'\n')).digest('hex');
    assert.equal(manifest.files['./'+name],hash,'C36 source SHA seal mismatch '+name);
  }
 }
 // C39: only 0.5/100 for the QA LOCAL C38 single-writer activation interlock.
 // It is not a physical A->B->A proof and never certifies full DO cutover.
 const c38=data.groups.flatMap(g=>g.milestones).find(m=>m.id==='local-legacy-relay-quiescence-gate-c38');
 if(c38?.done){
   assert.equal(c38.points,0.5,'C38 local relay quiescence only earns 0.5');
   const switchRest=data.groups.flatMap(g=>g.milestones).find(m=>m.id==='operational-switch');
   assert.equal(switchRest?.points,1,'1.0 budget still missing for real operational switch');
   assert.equal(switchRest?.done,false,'C38 must not certify actual migration switch');
   assert.equal(data.commercialGo.certifiedGates,0,'no physical GO from local cutover gate');
   const sync=fs.readFileSync(path.join(root,'docs/sync-yjs.js'),'utf8');
   const realtime=fs.readFileSync(path.join(root,'docs/sync-realtime.js'),'utf8');
   const manifest=load('docs/version-manifest.json');
   const version=load('docs/version.json');
   assert(Number((/^v0\.8\.(\d+)$/.exec(version.version||'')||[])[1]||0)>=16,
     'C38 cutover cannot earn credit before sealed v816+ shell');
   assert(Number((/^f123-shell-v(\d+)$/.exec(version.shell||'')||[])[1]||0)>=816,
     'C38 cutover requires f123-shell-v816+');
   const sourceSha='sha256-'+crypto.createHash('sha256').update(sync.replace(/\r\n/g,'\n')).digest('hex');
   assert.equal(manifest.files['./sync-yjs.js'],sourceSha,
     'C38 actual shipped activation source differs from official SHA manifest');
   for(const token of [
     'if (!relayAnterior) return false;',
     'relayAnterior.estado() === "apagado"',
     '!relayAnterior.salaActiva()',
     'relayAnterior.durabilidadPendiente() === false',
     'typeof relayAnterior.onEstado === "function"',
     'if (cortarComercio20 && !relayAnteriorApagadoYVacio())',
     'coord.failbackToLegacy("legacy-relay-restarted")',
     'API.modoCorte20Activo = false;',
     'typeof coord.activate20 !== "function"',
     'API.modoCorte20Activo === true &&'
   ])assert(sync.includes(token),'C38 actual source must preserve safety guard '+token);
   assert(realtime.includes('async function vaciarCola()') &&
     realtime.includes('window.OCSyncEmit = function (tipo, payload) {'),
     'C38 credit requires proven second legacy writer risk');
   const tests='test/p0-c38-legacy-transport-quiescence.test.cjs';
   assert(fs.existsSync(path.join(root,tests)),'C38 exact-source unit test absent');
   const testCode=fs.readFileSync(path.join(root,tests),'utf8');
   for(const token of [
      'assert.ok(realtime.includes',
      'withFacade:false',
      'missingActivator:true',
      'roleStart=src.indexOf',
      "off.activate({activarDespachoComercial:true",
      'legacy reactivation AFTER cutover'
   ])assert(testCode.includes(token),'C38 red-team regression absent '+token);
   const c31=fs.readFileSync(path.join(root,'test/p0-c31-runtime-commercial-photo-role-cutover.test.cjs'),'utf8');
   const c33=fs.readFileSync(path.join(root,'cloudflare-yparty-worker/qa/p0-c33-sync-yjs-cutover-workerd.test.mjs'),'utf8');
   assert(c31.includes("estado: () => 'apagado'") &&
     c33.includes("estado: () => 'apagado'"),
     'C31 and Workerd C33 tests must model old relay intentionally OFF before C21a activation');
 }
 // C41 C40 is credited only for REAL product browser source + Workerd DO receipt QA.
 const c40=data.groups.flatMap(g=>g.milestones).find(m=>m.id==='real-business-do-receipt-c40');
 if(c40?.done){
  assert.equal(c40.points,0.5,'C40 only 0.5 of original typed-economics budget');
  assert.equal(c40.source,'docs/sync-yjs.js');
  const typed=data.groups.find(g=>g.id==='typed-economics');
  const storage=data.groups.find(g=>g.id==='storage');
  assert.equal(typed?.weight,17);
  assert.equal(oneDecimal(typed.milestones.reduce((a,m)=>a+m.points,0)),17,'C40 cannot increase typed-economics weight');
  assert.equal(storage?.weight,17);
  assert.equal(oneDecimal(storage.milestones.reduce((a,m)=>a+m.points,0)),17,'C40 cannot change storage budget');
  const left=typed.milestones.find(m=>m.id==='production-business-dispatch');
  const c42Done=data.groups.flatMap(g=>g.milestones).some(m=>m.id==='real-checkout-do-status-c42' && m.done);
   assert.equal(left?.points,c42Done?1:1.5,'live business dispatch still unearned after C42 checkout status');
  assert.equal(left.done,false,'C40 is NOT a live customer cutover');
  assert.equal(data.commercialGo.certifiedGates,0,'C40 QA does not certify GO');
  assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0,'no physical A-B-A');
  assert.equal(quality.dimensions.find(d=>d.id==='business')?.score,c42Done?18.3:18.1);
  const src=fs.readFileSync(path.join(root,'docs/sync-yjs.js'),'utf8');
  for(const token of [
    'API.recibosComerciales20 = new Map();',
    'API.obtenerReciboComercial20 = function (opId)',
    'function _registrarReciboComercial20(opId, res)',
    'API.coordinadorCorte20.submitCommercial(comando)',
    '_registrarReciboComercial20(comando && comando.opId, res)',
    'new CustomEvent("oc-op-20-recibo", { detail: entry })'
  ])assert(src.includes(token),'real C40 browser receipt contract missing '+token);
  const proofPath='cloudflare-yparty-worker/qa/p0-c40-local-receipt-to-do-receipt-workerd.test.mjs';
  assert(fs.existsSync(path.join(root,proofPath)),'C40 Workerd E2E missing');
  const proof=fs.readFileSync(path.join(root,proofPath),'utf8');
  for(const token of [
    "from 'miniflare'",
    "assert.equal(recibo.committed, true)",
    "assert.equal(recibo.stage, 'business-committed')",
    "assert.equal(rt.receiptEvents.length, 1)",
    'assert.equal(await rt.API.puedeDespacharOpEnLegado(opIdVenta), false)',
    'assert.equal(sql.stock, 4)',
    'assert.equal(sql.cash, 2000)',
    'assert.equal(sql.effects, 1)',
    'assert.equal(sql.receipts, 1)'
  ])assert(proof.includes(token),'C40 real Workerd exactly-once proof missing '+token);
  const v=load('docs/version.json');
  assert(Number((/^v0\.8\.(\d+)$/.exec(v.version||'')||[])[1]||0)>=17,'requires v0.8.17+');
  assert(Number((/^f123-shell-v(\d+)$/.exec(v.shell||'')||[])[1]||0)>=817,'requires f123-shell-v817+');
  const digest='sha256-'+crypto.createHash('sha256').update(src.replace(/\r\n/g,'\n')).digest('hex');
  assert.equal(load('docs/version-manifest.json').files['./sync-yjs.js'],digest,'C40 shipped sync-yjs.js must be integrity sealed');
 }
 // C43: source-verified C42 checkout DO receipt truth and adversarial ACK protections.
 // QA-only code earns exactly 0.5, NOT full production dispatch or physical GO.
 const c42=data.groups.flatMap(g=>g.milestones).find(m=>m.id==='real-checkout-do-status-c42');
 if(c42?.done){
  assert.equal(c42.points,0.5,'C42 checkout observer award capped at 0.5');
  assert.equal(c42.source,'docs/mock-backend.js','credit actual product checkout, not workshop');
  const typed=data.groups.find(g=>g.id==='typed-economics');
  const storage=data.groups.find(g=>g.id==='storage');
  assert.equal(typed?.weight,17);
  assert.equal(oneDecimal(typed.milestones.reduce((a,m)=>a+m.points,0)),17,'C42 cannot inflate typed-economics budget');
  assert.equal(storage?.weight,17);
  assert.equal(oneDecimal(storage.milestones.reduce((a,m)=>a+m.points,0)),17,'C42 cannot steal storage budget');
  const residual=typed.milestones.find(m=>m.id==='production-business-dispatch');
  assert.equal(residual?.points,1,'live production business dispatcher still unearned 1.0');
  assert.equal(residual.done,false,'C42 does not enable commercial production cutover');
  assert.equal(data.commercialGo.certifiedGates,0,'C42 synthetic QA cannot certify live store GO');
  assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0,'no real PC→Safari acceptance evidence');
  assert.equal(quality.dimensions.find(d=>d.id==='business')?.score,18.3,'business quality bounded +0.2 for C42 adversarial QA');
  const mock=fs.readFileSync(path.join(root,'docs/mock-backend.js'),'utf8');
  const facade=fs.readFileSync(path.join(root,'docs/sync-yjs.js'),'utf8');
  for(const token of [
    'function _aplicarEstadoReciboDo20(detail)',
    'window.addEventListener("oc-op-20-recibo", function (ev)',
    'if (venta.reciboDo20 && venta.reciboDo20.committed === true &&',
    'detail.quarantine === true',
    'estado: "pendiente-reconciliacion-do"',
    'estado: "rechazado-sin-confirmar"',
    '_mergeSucio = true;',
    '_guardarMergePendienteYa();',
    'ventas: clonar(ventas)'
  ])assert(mock.includes(token),'C42 real product checkout/dirty snapshot missing '+token);
  for(const token of [
    'var mismatch = Boolean(receiptOpId && receiptOpId !== id);',
    'var incomingCommitted = !mismatch && Boolean(res.committed)',
    'prev && prev.committed === true',
    'stage: "receipt-opid-mismatch"',
    'reconcileRequired: Boolean(res.reconcileRequired)'
  ])assert(facade.includes(token),'C42 real facade authoritative ACK guard missing '+token);
  const testPath='test/p0-c42-redteam-receipt-identity.test.cjs';
  assert(fs.existsSync(path.join(root,testPath)),'C42 RED-to-GREEN independent exact source tests missing');
  const test=fs.readFileSync(path.join(root,testPath),'utf8');
  for(const token of [
    "mismatched DO receipt.opId cannot confirm another sale",
    'confirmed receipt is monotone; stale 202 cannot demote sale or DO Map',
    '409 with quarantine + reconcileRequired is quarantine',
    'delayed rejection after valid DO commit cannot demote cash receipt'
  ])assert(test.includes(token),'C42 red-team negative QA case missing '+token);
  assert(fs.existsSync(path.join(root,'test/p0-c42-checkout-receipt-status.test.cjs')),
    'C42 exact source checkout status test missing');
  assert(fs.existsSync(path.join(root,'cloudflare-yparty-worker/qa/p0-c40-local-receipt-to-do-receipt-workerd.test.mjs')),
    'C40 Workerd real SQLite authoritative receipt proof missing');
  const ver=load('docs/version.json');
  assert(Number((/^v0\.8\.(\d+)$/.exec(ver.version||'')||[])[1]||0)>=18,'C42 needs v0.8.18+');
  assert(Number((/^f123-shell-v(\d+)$/.exec(ver.shell||'')||[])[1]||0)>=818,'C42 needs f123-shell-v818+');
  const manifest=load('docs/version-manifest.json');
  for(const [name,src] of [['mock-backend.js',mock],['sync-yjs.js',facade]]){
   const hash='sha256-'+crypto.createHash('sha256').update(src.replace(/\r\n/g,'\n')).digest('hex');
   assert.equal(manifest.files['./'+name],hash,'C42 actual delivered browser source hash mismatch: '+name);
  }
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
