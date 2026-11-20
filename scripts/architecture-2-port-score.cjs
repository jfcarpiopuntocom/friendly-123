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
  assert.equal(leftover?.points,0.5,'after C31 only 1.5 remains unearned; fixed browser budget unchanged');
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
   assert.equal(legacy?.points,0.5,'remaining legacy retirement budget 1.5');
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
    assert.equal(full?.points,(data.groups.flatMap(g=>g.milestones).some(m=>m.id==='real-adjust-credit-browser-envelope-c44' && m.done))?0.5:(c42Done?1:(c40Done?1.5:(c36Done?2:2.5))),'fixed economics budget C36 + C40 + C42 + C44');
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
  assert.equal(left?.points,(data.groups.flatMap(g=>g.milestones).some(m=>m.id==='real-adjust-credit-browser-envelope-c44' && m.done))?0.5:(c42Done?1:(c40Done?1.5:2)),'commercial dispatch remains unearned after C44 QA');
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
   assert.equal(switchRest?.points,0.5,'C51 has earned 0.5 QA; real operational switch still missing 0.5');
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
   assert.equal(left?.points,(data.groups.flatMap(g=>g.milestones).some(m=>m.id==='real-adjust-credit-browser-envelope-c44' && m.done))?0.5:(c42Done?1:1.5),'live business dispatch still unearned after C44 QA');
  assert.equal(left.done,false,'C40 is NOT a live customer cutover');
  assert.equal(data.commercialGo.certifiedGates,0,'C40 QA does not certify GO');
  assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0,'no physical A-B-A');
  assert.equal(quality.dimensions.find(d=>d.id==='business')?.score,(data.groups.flatMap(g=>g.milestones).some(m=>m.id==='real-adjust-credit-browser-envelope-c44' && m.done))?18.5:(c42Done?18.3:18.1));
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
  assert.equal(residual?.points,(data.groups.flatMap(g=>g.milestones).some(m=>m.id==='real-adjust-credit-browser-envelope-c44' && m.done))?0.5:1,'live production business dispatcher remains unearned');
  assert.equal(residual.done,false,'C42 does not enable commercial production cutover');
  assert.equal(data.commercialGo.certifiedGates,0,'C42 synthetic QA cannot certify live store GO');
  assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0,'no real PC→Safari acceptance evidence');
  assert.equal(quality.dimensions.find(d=>d.id==='business')?.score,(data.groups.flatMap(g=>g.milestones).some(m=>m.id==='real-adjust-credit-browser-envelope-c44' && m.done))?18.5:18.3,'business quality bounded by actual C42/C44 QA');
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
 // C45: award only merged C44 QA integrations, split from the fixed 1.0
 // remaining live business-dispatch budget. Production cutover remains false.
 const c44=data.groups.flatMap(g=>g.milestones).find(m=>m.id==='real-adjust-credit-browser-envelope-c44');
 if(c44?.done){
   assert.equal(c44.points,0.5,'C44 is limited to 0.5 of existing economics budget');
   assert.equal(c44.source,'docs/mock-backend.js');
   const typed=data.groups.find(g=>g.id==='typed-economics');
   assert.equal(oneDecimal(typed.milestones.reduce((a,m)=>a+m.points,0)),17,'fixed business budget');
   assert.equal(typed.milestones.find(m=>m.id==='production-business-dispatch')?.points,0.5);
   assert.equal(typed.milestones.find(m=>m.id==='production-business-dispatch')?.done,false,'live customer dispatcher still pending');
   assert.equal(data.commercialGo.certifiedGates,0,'no commercial GO from C44');
   assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0,'no physical A-B-A from C44');
   assert.equal(quality.dimensions.find(d=>d.id==='business')?.score,18.5);
   assert.equal(quality.dimensions.find(d=>d.id==='business')?.previous,18.5);
   assert.equal(quality.comparison.previousScore,79.1);
   assert.equal(data.assessedProductSha,'6e802e6e0df0988922220dd634a40f7788638f05','C48 assessed real merged PR844 source SHA');
   const backend=fs.readFileSync(path.join(root,'docs/mock-backend.js'),'utf8');
   const realtime=fs.readFileSync(path.join(root,'docs/sync-realtime.js'),'utf8');
   const sync=fs.readFileSync(path.join(root,'docs/sync-yjs.js'),'utf8');
   const firstSeen=backend.indexOf('if (!movimientos.some(m=>m.detalle && m.detalle.movimientoId===recibo.id)) {');
   const emit=backend.indexOf('window.OCSyncEmit("abono"',firstSeen);
   const balance=backend.indexOf('const info = await window.AMG.Cartera.saldoDeCliente',firstSeen);
   assert(firstSeen>0 && emit>firstSeen && balance>emit,
     'abono must emit only for first durable receipt, not after retry');
   assert(!/emitirOpStock\(["']abono["']/.test(backend.slice(firstSeen,balance)),
     'no invented inventario_abono EventBus fact on duplicate payment');
   assert(realtime.includes('window.OCSyncEmit = function (tipo, payload) {') &&
     realtime.includes('t === "ajuste"') && realtime.includes('t === "abono"'),
     'C44 real durable original opId guard for ajuste/abono absent');
   assert(sync.includes('credit.customer.payment.record') && sync.includes('stock.adjust'),
     'C44 real typed command translation absent');
   const testPath='test/p0-c44-ajuste-abono-envelope-and-opid.test.cjs';
   const workerdPath='cloudflare-yparty-worker/qa/p0-c44-ajuste-abono-workerd.test.mjs';
   const payPath='test/customer-payment-browser.test.js';
   for(const p of [testPath,workerdPath,payPath])assert(fs.existsSync(path.join(root,p)),'C44 exact-source regression missing '+p);
   const test=fs.readFileSync(path.join(root,testPath),'utf8');
   const worker=fs.readFileSync(path.join(root,workerdPath),'utf8');
   const pay=fs.readFileSync(path.join(root,payPath),'utf8');
   assert(test.includes('abono must emit window.OCSyncEmit') && test.includes('stock.adjust'),
     'C44 source contracts missing');
   for(const token of ['assert.equal(snap.stock, 8','assert.equal(snap.debt, 1500',
     'assert.equal(snap.receipts, 2','assert.equal(snap.effects, 2']){
     assert(worker.includes(token),'C44 real Workerd SQLite DO replay missing '+token);
   }
   assert(pay.includes("assert.deepEqual(final.facts,facts") &&
     pay.includes("['Chromium',chromium],['WebKit',webkit]"),
     'C44 real Chromium/WebKit lost-response retry regression absent');
   const v=load('docs/version.json');
   assert(Number((/^v0\.8\.(\d+)$/.exec(v.version||'')||[])[1]||0)>=19,'C44 requires v0.8.19+');
   assert(Number((/^f123-shell-v(\d+)$/.exec(v.shell||'')||[])[1]||0)>=819,'C44 requires shell v819+');
   const manifest=load('docs/version-manifest.json');
   for(const [name,bytes] of [['mock-backend.js',backend],['sync-realtime.js',realtime],['sync-yjs.js',sync]]){
     const digest='sha256-'+crypto.createHash('sha256').update(bytes.replace(/\r\n/g,'\n')).digest('hex');
     assert.equal(manifest.files['./'+name],digest,'C44 shipped SHA source mismatch '+name);
   }
 }
 // C48: C46 actually MERGED existing browser photo assembly and executed it against
 // real Workerd SQLite DO with two fake-IDB Owner devices plus cold Team readback.
 // Earn QA ONLY 0.5 split from existing photo UI cutover2.0, NOT physical acceptance.
 const c46=data.groups.flatMap(g=>g.milestones).find(m=>m.id==='real-photo-browser-do-readback-c46');
 if(c46?.done){
   assert.equal(c46.points,0.5,'C46 Workerd QA is capped at 0.5');
   assert.equal(c46.source,'docs/application/recover-shelf-photo.js',
     'C46 must credit the REAL application recovery path, not workshop');
   const photos=data.groups.find(g=>g.id==='photo-sha');
   assert.equal(photos?.weight,9,'photo budget unchanged');
   assert.equal(oneDecimal(photos.milestones.reduce((a,m)=>a+m.points,0)),9,'no new photo points');
   const leftover=photos.milestones.find(m=>m.id==='browser-photo-cutover');
   assert.equal(leftover?.points,1.0,'C49 has earned 0.5 new CAS QA; real UI/physical photo cutover remains 1.0');
   assert.equal(leftover.done,false,'C46 synthetic QA is not physical photo cutover');
   assert.equal(data.groups.flatMap(g=>g.milestones)
     .find(m=>m.id==='verified-cross-device-downpath')?.done,false,
     'virtual Workerd handoff is not a true PC-iPhone downpath');
   assert.equal(data.commercialGo.certifiedGates,0,'no commercial GO from virtual clients');
   assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0,'no physical devices tested');
   assert.equal(quality.dimensions.find(d=>d.id==='photos')?.score,7.7);
   assert.equal(quality.dimensions.find(d=>d.id==='photos')?.previous,7.7);
   assert.equal(quality.dimensions.find(d=>d.id==='sync')?.score,15.9);
   assert.equal(quality.dimensions.find(d=>d.id==='sync')?.previous,15.9);
   assert.equal(quality.comparison.previousScore,79.1);
   const testPath='cloudflare-yparty-worker/qa/p0-c46-cross-device-photo-and-downpath-workerd.test.mjs';
   const workerd=fs.readFileSync(path.join(root,testPath),'utf8');
   for(const token of [
      'from \'miniflare\'',
      'vm.runInContext(IDB_FOTOS_SRC',
      'vm.runInContext(RECOVER_PHOTO_SRC',
      'assert.equal(devA.API.fotosMap.size, 0',
      'assert.equal(recovered?.displayBytes, shelfDataUrl',
      'const opB2 =',
      'const opA3 =',
      'assert.equal(sql.stock, 0',
      'assert.equal(sql.cash, 8000',
      'assert.equal(sql.effects, 5',
      'assert.equal(sql.receipts, 5'
   ])assert(workerd.includes(token),'C46 real Workerd double-cycle evidence absent '+token);
   const yjs=fs.readFileSync(path.join(root,'docs/sync-yjs.js'),'utf8');
   const idb=fs.readFileSync(path.join(root,'docs/idb-fotos.js'),'utf8');
   const recover=fs.readFileSync(path.join(root,'docs/application/recover-shelf-photo.js'),'utf8');
   const vendor=fs.readFileSync(path.join(root,'docs/vendor/yparty-piloto.min.js'),'utf8');
   assert(yjs.includes('_instalarLectorFotoShaBajoDemanda')&&yjs.includes('function sembrarFotosAlRelay()'),
     'real C46 Sync3 SHA photo bridge absent');
   assert(idb.includes('async function leerPorHash(') && recover.includes('async function recoverShelfPhoto('),
     'real C46 app IDB photo recovery absent');
   const manifest=load('docs/version-manifest.json');
   for(const [name,bytes] of [['sync-yjs.js',yjs],['idb-fotos.js',idb],
       ['application/recover-shelf-photo.js',recover],['vendor/yparty-piloto.min.js',vendor]]){
     const digest='sha256-'+crypto.createHash('sha256').update(bytes.replace(/\r\n/g,'\n')).digest('hex');
     assert.equal(manifest.files['./'+name],digest,'C46 actual shipped source mismatch '+name);
   }
   assert.equal(data.assessedProductSha,'6e802e6e0df0988922220dd634a40f7788638f05',
     'C46 only credits exact actual PR844 merged source');
 }
 // C50: real product C47 v0.8.20 role/epoch wiring, verified RED -> GREEN.
 // Earn at most 0.5 from the original 1.5 identity switch budget; never physical GO.
 const c47=data.groups.flatMap(g=>g.milestones).find(m=>m.id==='real-auth-role-epoch-qa-c47');
 if(c47?.done){
   const identity=data.groups.find(g=>g.id==='identity-rooms');
   assert.equal(identity?.weight,14,'C47 must use original 14-point identity weight');
   assert.equal(oneDecimal(identity.milestones.reduce((a,m)=>a+m.points,0)),14,'C47 must not invent identity points');
   assert.equal(c47.points,0.5,'C47 role/epoch QA must be capped at 0.5');
   assert.equal(c47.source,'docs/sync-yjs.js','C47 credit requires shipped application facade');
   const pending=identity.milestones.find(m=>m.id==='commercial-role-switch');
   assert.equal(pending?.points,0.5,'C58 leaves 0.5 real commercial/physical role budget unearned');
   assert.equal(pending?.done,false,'no synthetic role QA can earn the physical commercial cutover');
   assert.equal(data.commercialGo.certifiedGates,0,'role QA must not certify commercial readiness');
   assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0,'role QA is not physical acceptance');
   assert.equal(quality.dimensions.find(d=>d.id==='security')?.score,10.9);
   assert.equal(quality.dimensions.find(d=>d.id==='security')?.previous,10.9);
   assert.equal(quality.comparison.previousScore,79.1);
   const sync=fs.readFileSync(path.join(root,'docs/sync-yjs.js'),'utf8');
   const roleQA=fs.readFileSync(path.join(root,'test/p0-c47-auth-role-switch-20.test.cjs'),'utf8');
   for(const token of [
     'window.addEventListener("oc-login"',
     'window.addEventListener("oc-logout"',
     'window.OCAuth',
     'auth.rolActual()',
     'auth.esDemo()',
     'oc-login-role-mismatch',
     'API.__authEpoch20',
     'auth-changed-during-activation',
     'failbackToLegacy('
   ])assert(sync.includes(token),'C47 authenticated role/epoch code absent '+token);
   for(const token of [
     'forged oc-login role',
     'live demo session',
     'logout during in-flight',
     'assert.rejects(activation'
   ])assert(roleQA.includes(token),'C47 adversarial RED->GREEN test missing '+token);
   const manifest=load('docs/version-manifest.json'),ver=load('docs/version.json');
   const syncSha='sha256-'+crypto.createHash('sha256').update(sync.replace(/\r\n/g,'\n')).digest('hex');
   assert.equal(manifest.files['./sync-yjs.js'],syncSha,'C47 real shell sync integrity SHA mismatch');
   assert(Number((/^v0\.8\.(\d+)$/.exec(ver.version||'')||[])[1]||0)>=20,'C47 requires v0.8.20+');
   assert(Number((/^f123-shell-v(\d+)$/.exec(ver.shell||'')||[])[1]||0)>=820,'C47 requires shell v820+');
   assert.equal(data.assessedProductSha,'6e802e6e0df0988922220dd634a40f7788638f05',
     'C50 must pin real merged C47 product SHA, not a test or workshop SHA');
 }
 // C52: REAL merged C49 shelf photo CAS 409/200 Workerd SQLite plus C51 Web Locks
 // bounded timeout and commercial runtime double QA boot. Both are partial QA
 // slices of already existing 100.0 points; commercial GO and physical remain 0.
 const ms52=data.groups.flatMap(g=>g.milestones);
 const c49=ms52.find(m=>m.id==='c49-real-photo-cas-workerd-qa');
 const c51=ms52.find(m=>m.id==='c51-bounded-locks-and-double-qa-bootstrap');
 if(c49?.done || c51?.done){
   assert.equal(c49?.done,true,'C49 photo CAS QA must be certified');
   assert.equal(c51?.done,true,'C51 operational WebLocks QA must be certified');
   assert.equal(c49.points,0.5,'C49 source CAS limited to 0.5 of existing photo budget');
   assert.equal(c49.source,'docs/mock-backend.js','C49 must credit REAL product backend');
   assert.equal(c51.points,0.5,'C51 precommercial bootstrap limited to 0.5 of storage budget');
   assert.equal(c51.source,'docs/sync-yjs.js','C51 must credit REAL sync facade');
   const photoBudget=data.groups.find(g=>g.id==='photo-sha');
   const storageBudget=data.groups.find(g=>g.id==='storage');
   assert.equal(photoBudget.weight,9);
   assert.equal(storageBudget.weight,17);
   assert.equal(oneDecimal(photoBudget.milestones.reduce((a,m)=>a+m.points,0)),9,'photo weight must stay fixed');
   assert.equal(oneDecimal(storageBudget.milestones.reduce((a,m)=>a+m.points,0)),17,'storage weight must stay fixed');
   assert.equal(photoBudget.milestones.find(m=>m.id==='browser-photo-cutover')?.points,1.0,
     'C49 must leave real photo UI/device cutover1.0 unearned');
   assert.equal(photoBudget.milestones.find(m=>m.id==='browser-photo-cutover')?.done,false);
   assert.equal(storageBudget.milestones.find(m=>m.id==='operational-switch')?.points,0.5,
     'C51 must leave live operational switch0.5 unearned');
   assert.equal(storageBudget.milestones.find(m=>m.id==='operational-switch')?.done,false);
   assert.equal(ms52.find(m=>m.id==='verified-cross-device-downpath')?.done,false,
     'Workerd QA does not replace physical PC to Safari acceptance');
   assert.equal(data.commercialGo.certifiedGates,0,'2.0 QA-only flags do not authorize customer GO');
   assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0,'no physical GO');
   assert.equal(quality.dimensions.find(d=>d.id==='photos')?.score,7.7);
   assert.equal(quality.dimensions.find(d=>d.id==='photos')?.previous,7.7);
   assert.equal(quality.dimensions.find(d=>d.id==='durability')?.score,18.5);
   assert.equal(quality.dimensions.find(d=>d.id==='durability')?.previous,18.4);
   assert.equal(quality.comparison.previousScore,79.1);
   const c49qa=fs.readFileSync(path.join(root,
     'cloudflare-yparty-worker/qa/p0-c49-vista-perchas-cas-workerd.test.mjs'),'utf8');
   for(const token of [
     "from 'miniflare'",
     "const r1 = putUbicacionFotoCas(",
     'assert.equal(r1.status, 200)',
     'assert.equal(rStale.status, 409)',
     "'PHOTO_POINTER_CONFLICT'",
     'assert.equal(ubicaciones[0].fotoHash, hashA',
     'assert.equal(r2.status, 200)',
     'assert.equal(devA.API.fotosMap.size, 0)',
     'F123Application.recoverShelfPhoto(',
     'assert.equal(rec?.displayBytes, dataUrlB)'
   ])assert(c49qa.includes(token),'C49 Workerd CAS proof missing '+token);
   const c51qa=fs.readFileSync(path.join(root,
     'test/p0-c51-weblocks-timeout-and-operational-switch.test.cjs'),'utf8');
   for(const token of [
     'hung navigator.locks.request aborts',
     'REAL_IDB_WRITE_FAILURE',
     'double-QA operational switch stays OFF by default',
     'assert.equal(getFallbackCalls(), 1'
   ])assert(c51qa.includes(token),'C51 negative outbox/QA test missing '+token);
   const mock=fs.readFileSync(path.join(root,'docs/mock-backend.js'),'utf8');
   const sync=fs.readFileSync(path.join(root,'docs/sync-yjs.js'),'utf8');
   const idb=fs.readFileSync(path.join(root,'docs/idb-fotos.js'),'utf8');
   const recovery=fs.readFileSync(path.join(root,'docs/application/recover-shelf-photo.js'),'utf8');
   for(const token of ['expectedFotoHash','expectedFotoRev','PHOTO_POINTER_CONFLICT'])
     assert(mock.includes(token),'C49 actual mock-backend CAS source missing '+token);
   for(const token of ['API.corte20QaHabilitado','f123_yparty_qa','f123_corte20_qa',
     'mutarOutboxAtomicoSinLocks','AbortController','API.__outboxLockTimeoutMs',
     'authQa.rolActual()','authQa.esDemo()', 'cortarComercio: true'])
     assert(sync.includes(token),'C51 certified guarded bootstrap or timeout missing '+token);
   const ver=load('docs/version.json'),manifest=load('docs/version-manifest.json');
   assert(Number((/^v0\.8\.(\d+)$/.exec(ver.version||'')||[])[1]||0)>=21,'C51 needs actual v0.8.21+');
   assert(Number((/^f123-shell-v(\d+)$/.exec(ver.shell||'')||[])[1]||0)>=821,'C51 needs actual shell v821+');
   for(const [name,bytes] of [['mock-backend.js',mock],['sync-yjs.js',sync],
     ['idb-fotos.js',idb],['application/recover-shelf-photo.js',recovery]]){
     const digest='sha256-'+crypto.createHash('sha256').update(bytes.replace(/\r\n/g,'\n')).digest('hex');
     assert.equal(manifest.files['./'+name],digest,'C49/C51 shipped manifest does not match '+name);
   }
   assert.equal(data.assessedProductSha,'6e802e6e0df0988922220dd634a40f7788638f05',
     'C52 assessed SHA must pin product after BOTH C49 and C51 merged');
 }
 // C53 fixed100: REAL merged C52 v0.8.22 on SAME app, only three legacy
 // Yjs outbound senders retired under cutover; explicitly not entire 1.0 retired.
 const c52ms=data.groups.flatMap(g=>g.milestones);
 const c52legacy=c52ms.find(m=>m.id==='c52-legacy-yjs-senders-retired-under-cutover');
 if(c52legacy?.done){
   const browser=data.groups.find(g=>g.id==='browser-cutover');
   assert.equal(browser?.weight,10,'C52 cannot change original browser budget10');
   assert.equal(oneDecimal(browser.milestones.reduce((a,m)=>a+m.points,0)),10);
   assert.equal(c52legacy.points,0.5,'C52 partial legacy senders QA capped0.5');
   assert.equal(c52legacy.source,'docs/sync-yjs.js','C52 must credit actual shipped Yjs facade');
   const rest=browser.milestones.find(m=>m.id==='typed-delta-and-legacy-retirement');
   assert.equal(rest?.points,0.5,'C52 must leave full legacy writer shutdown1.0 unearned');
   assert.equal(rest?.done,false,'QA sender guards cannot certify full 1.0 retirement');
   assert.equal(c52ms.find(m=>m.id==='verified-cross-device-downpath')?.done,false);
   assert.equal(data.commercialGo.certifiedGates,0);
   assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0);
   assert.equal(quality.dimensions.find(d=>d.id==='migration')?.score,7.7);
   assert.equal(quality.dimensions.find(d=>d.id==='migration')?.previous,7.7);
   assert.equal(quality.comparison.previousScore,79.1);
   const sync=fs.readFileSync(path.join(root,'docs/sync-yjs.js'),'utf8');
   const test=fs.readFileSync(path.join(root,'test/p0-c52-legacy-channel-retirement.test.cjs'),'utf8');
   for(const token of [
     'if (!API.modoCorte20Activo && API.canalSombra && API.canalSombra !== API.canal) API.canalSombra.enviarUpdate(update);',
     'if (!API.corteFotosShaActivo) API.fotosCanal.enviarUpdate(update);',
     'if (!API.modoCorte20Activo) API.opsCanal.enviarUpdate(update);',
     'API.canal.enviarUpdate(update);',
     'API.corte20QaHabilitado'
   ])assert(sync.includes(token),'C52 real old-channel guard missing: '+token);
   for(const token of [
     'legacy Yjs senders retire when modoCorte20Activo/corteFotosShaActivo=true and resume on failback',
     'modoCorte20Activo = true',
     'corteFotosShaActivo = true',
     'modoCorte20Activo = false',
     'corteFotosShaActivo = false',
     'canalSombra: 0, fotosCanal: 0, opsCanal: 0',
     'canalSombra: 1, fotosCanal: 1, opsCanal: 1'
   ])assert(test.includes(token),'C52 old sender on/off VM test missing: '+token);
   const manifest=load('docs/version-manifest.json'),ver=load('docs/version.json');
   const digest='sha256-'+crypto.createHash('sha256').update(sync.replace(/\r\n/g,'\n')).digest('hex');
   assert.equal(manifest.files['./sync-yjs.js'],digest,'v0.8.22 source integrity seal');
   assert(Number((/^v0\.8\.(\d+)$/.exec(ver.version||'')||[])[1]||0)>=22,'C52 requires real v0.8.22+');
   assert(Number((/^f123-shell-v(\d+)$/.exec(ver.shell||'')||[])[1]||0)>=822,'C52 requires actual shell v822+');
   assert.equal(data.assessedProductSha,'6e802e6e0df0988922220dd634a40f7788638f05',
     'C53 must pin actual merged C52 product SHA, not workshop/PR-only source');
 }
 // C55: the REAL v0.8.23 merged source fences primary OLD relay selected when
 // the YParty pilot fails, preserving new YParty writer + normal failback.
 const c55legacy=data.groups.flatMap(g=>g.milestones).find(m=>m.id==='c54-primary-fallback-old-yjs-writer-fence');
 if(c55legacy?.done){
   const browser=data.groups.find(g=>g.id==='browser-cutover');
   assert.equal(browser?.weight,10,'original browser budget stays fixed10');
   assert.equal(oneDecimal(browser.milestones.reduce((n,m)=>n+m.points,0)),10);
   assert.equal(c55legacy.points,0.5,'old selected-primary source QA limited to 0.5');
   assert.equal(c55legacy.source,'docs/sync-yjs.js','credit requires actual product Yjs');
   assert.equal(browser.milestones.find(m=>m.id==='typed-delta-and-legacy-retirement')?.points,0.5,
     'C55 must leave full 1.0 writer retirement unearned 0.5');
   assert.equal(browser.milestones.find(m=>m.id==='typed-delta-and-legacy-retirement')?.done,false);
   assert.equal(data.commercialGo.certifiedGates,0,'source QA does not certify shop activation');
   assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0,'QA not physical PC/phone');
   assert.equal(quality.dimensions.find(d=>d.id==='migration')?.score,7.7);
   assert.equal(quality.dimensions.find(d=>d.id==='migration')?.previous,7.7);
   assert.equal(quality.comparison.previousScore,79.1);
   const sync=fs.readFileSync(path.join(root,'docs/sync-yjs.js'),'utf8');
   const test=fs.readFileSync(path.join(root,'test/p0-c52-legacy-channel-retirement.test.cjs'),'utf8');
   for(const token of [
     'API.canal = canalesRespaldo[0]',
     'if (!API.modoCorte20Activo || API.canal === API.canalPiloto) API.canal.enviarUpdate(update);',
     'if (!API.modoCorte20Activo && API.canalSombra && API.canalSombra !== API.canal) API.canalSombra.enviarUpdate(update);',
     'if (!API.corteFotosShaActivo) API.fotosCanal.enviarUpdate(update);',
     'if (!API.modoCorte20Activo) API.opsCanal.enviarUpdate(update);'
   ])assert(sync.includes(token),'C54 source guard missing '+token);
   for(const token of [
     'API.canalPiloto = API.canal;',
     'API.canal = API.canalSombra;',
     'a legacy primary selected by pilot failover MUST NOT publish during active 2.0',
     'the selected legacy primary resumes without any duplicate shadow write',
     'original C52 failback contract: all three old channels have resumed once'
   ])assert(test.includes(token),'C54 RED->GREEN failover fixture missing '+token);
   const manifest=load('docs/version-manifest.json'),version=load('docs/version.json');
   assert.equal(manifest.files['./sync-yjs.js'],
     'sha256-'+crypto.createHash('sha256').update(sync.replace(/\r\n/g,'\n')).digest('hex'),
     'C54 source integrity seal exact');
   assert(Number((/^v0\.8\.(\d+)$/.exec(version.version||'')||[])[1]||0)>=23,'C54 v0.8.23+ required');
   assert(Number((/^f123-shell-v(\d+)$/.exec(version.shell||'')||[])[1]||0)>=823,'C54 v823 shell required');
   assert.equal(data.assessedProductSha,'6e802e6e0df0988922220dd634a40f7788638f05',
     'C55 credits ONLY merged same-app C54 SHA, not test-only or workshop code');
 }
 // C57 source-backed QA of commercial two-device Workerd SQL cutover and failback.
 // This does NOT certify physical PC/Safari or independent Firebase HEAD.
 const stageC57=data.groups.flatMap(g=>g.milestones).find(m=>m.id==='c56-workerd-commercial-three-receipts-a-b-a-qa');
 if(stageC57?.done){
   const offline=data.groups.find(g=>g.id==='offline-failback');
   assert.equal(offline?.weight,5,'fixed original offline/failback budget');
   assert.equal(oneDecimal(offline.milestones.reduce((n,m)=>n+m.points,0)),5);
   assert.equal(stageC57.points,0.5,'synthetic three business receipts capped at0.5 QA');
   assert.equal(stageC57.source,'src/port2-cross-device-failback.mjs','must credit real C21a source');
   const pending=offline.milestones.find(m=>m.id==='verified-cross-device-downpath');
   assert.equal(pending?.points,1.0,'physical two cycles remain unearned1.0');
   assert.equal(pending?.done,false,'synthetic Workerd != physical iPhone');
   assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0);
   assert.equal(data.commercialGo.certifiedGates,0);
   assert.equal(quality.dimensions.find(d=>d.id==='sync')?.score,15.9);
   assert.equal(quality.dimensions.find(d=>d.id==='sync')?.previous,15.9);
   assert.equal(quality.comparison.previousScore,79.1);
   const source=fs.readFileSync(path.join(root,'src/port2-cross-device-failback.mjs'),'utf8');
   assert(source.includes('failbackToLegacy') && source.includes('canDispatchOnLegacy'),
     'existing real same-app coordinator must own the durable downpath');
   const test=fs.readFileSync(path.join(root,
     'cloudflare-yparty-worker/qa/p0-c56-commercial-cold-failback-receipt-workerd.test.mjs'),'utf8');
   for(const token of [
      "from 'miniflare'",
      'seeded-real-yparty-business-worker.mjs',
      "if (this.name === this.env.SALA_PILOTO + '-ops') return null;",
      'requireBusinessCommitted(devA.API, op.opId)',
      "requireBusinessCommitted(devB.API, 'op_c53_sale_b_4')",
      "'business-committed'",
      '{stock: 8, cash: 3500, effects: 3, receipts: 3, debt: 3000}',
      'duplicateSqlResponse',
      'C54: selected primary is an OLD relay and MUST NOT publish',
      "historical ops/economic cut not certified"
   ])assert(test.includes(token),'C56 real Workerd money+stock QA evidence missing '+token);
   assert.equal(data.assessedProductSha,'6e802e6e0df0988922220dd634a40f7788638f05',
      'C57 credits ONLY C56 merged real product/QA Workerd SHA');
 }
 // C59: real source C58 v824 authenticated identity epoch releases the
 // previous Owner -cat writer BEFORE reattaching new Owner/Admin/Team photos.
 // No physical/commercial certification is earned by source-only VM.
 const c58=data.groups.flatMap(g=>g.milestones).find(m=>m.id==='c58-verified-login-revokes-old-catalog-lease');
 if(c58?.done){
   const identity=data.groups.find(g=>g.id==='identity-rooms');
   assert.equal(identity?.weight,14,'original identity budget fixed');
   assert.equal(oneDecimal(identity.milestones.reduce((a,m)=>a+m.points,0)),14);
   assert.equal(c58.points,0.5,'C58 QA source only 0.5 of original role pending1.0');
   assert.equal(c58.source,'docs/sync-yjs.js');
   const pending=identity.milestones.find(m=>m.id==='commercial-role-switch');
   assert.equal(pending?.points,0.5,'live physical/commercial role switch still unearned0.5');
   assert.equal(pending?.done,false,'C58 synthetic source QA cannot certify role on real clients');
   assert.equal(quality.dimensions.find(d=>d.id==='security')?.score,10.9);
   assert.equal(quality.dimensions.find(d=>d.id==='security')?.previous,10.9);
   assert.equal(quality.comparison.previousScore,79.1);
   assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0);
   assert.equal(data.commercialGo.certifiedGates,0);
   const sync=fs.readFileSync(path.join(root,'docs/sync-yjs.js'),'utf8');
   const start=sync.indexOf('window.addEventListener("oc-login", function (ev) {');
   const end=sync.indexOf('\n        });',start);
   assert(start>0&&end>start,'C58 must wire real source oc-login event');
   const code=sync.slice(start,end);
   for(const token of [
     'auth.rolActual()',
     'auth.esDemo()',
     'if (liveDemo || liveRole !== r)',
     'API.__authEpoch20 = (API.__authEpoch20 || 0) + 1;',
     'API.modoCorte20Activo = false;',
     'API.corteFotosShaActivo = false;',
     'API.fotoSha = null;',
     'API.rolComercial20Activo = null;',
     '!API.coordinadorCorte20) return;',
     'API.coordinadorCorte20.failbackToLegacy(',
     'r === "empleado" ? "role-switch-empleado" : "oc-login-session-change"',
     'API.cambiarRolComercial20(r, { cortarLegadoFotos: fotosActivas });'
   ])assert(code.includes(token),'C58 real auth role/lease fail-closed source missing: '+token);
   assert(code.indexOf('API.modoCorte20Activo = false;') <
     code.indexOf('API.coordinadorCorte20.failbackToLegacy('),
     'C58 must disarm old writer synchronously before async failback');
   const qa=fs.readFileSync(path.join(root,'test/p0-c47-auth-role-switch-20.test.cjs'),'utf8');
   for(const token of [
     'C58 RED: real Owner -> admin login revokes previous -cat coordinator lease',
     'C58 RED: re-authenticated Owner cannot keep stale 2.0 writer lease',
     'C58 RED: failed Team credential construction cannot expose old Owner PUT photo client'
   ])assert(qa.includes(token),'C58 RED->GREEN regression fixture missing '+token);
   const version=load('docs/version.json'),manifest=load('docs/version-manifest.json');
   assert(Number((/^v0\.8\.(\d+)$/.exec(version.version||'')||[])[1]||0)>=24,'C58 v0.8.24+');
   assert(Number((/^f123-shell-v(\d+)$/.exec(version.shell||'')||[])[1]||0)>=824,'C58 shell v824+');
   assert.equal(manifest.version,version.version);
   assert.equal(manifest.shell,version.shell);
   assert.equal(manifest.files['./sync-yjs.js'],
     'sha256-'+crypto.createHash('sha256').update(sync.replace(/\r\n/g,'\n')).digest('hex'),
     'C58 exact source SHA256 seal required');
   assert.equal(data.assessedProductSha,'6e802e6e0df0988922220dd634a40f7788638f05',
      'C59 credits ONLY C58 merged real same-app product SHA');
 }
 // C61: real C60 source admits canonical PUBLIC catalog value-equivalence
 // despite JS object insertion order in BOTH legacy numeric and paged Yjs.
 // Only a 0.3 QA slice; independently certified REAL Firebase economic HEAD
 // and unknown v1-only root privacy defense remain explicitly unearned.
 const c60=data.groups.flatMap(g=>g.milestones).find(m=>m.id==='c60-frozen-public-field-key-order-verified');
 if(c60?.done){
   const hist=data.groups.find(g=>g.id==='frozen-history');
   assert.equal(hist?.weight,18,'original history budget fixed');
   assert.equal(oneDecimal(hist.milestones.reduce((n,m)=>n+m.points,0)),18);
   assert.equal(c60.points,0.3,'C60 source QA earns0.3 of original HEAD pending2.5 only');
   assert.equal(c60.source,'cloudflare-yparty-worker/src/trusted-frozen-source.mjs');
   const pending=hist.milestones.find(m=>m.id==='real-firebase-head-complete');
   const c62Done=hist.milestones.some(m=>m.id==='c62-legacy-frozen-private-root-rejection'&&m.done);
   assert.equal(pending?.points,c62Done?2.0:2.2,'actual Firebase HEAD remains unearned (2.0 after C62, otherwise 2.2)');
   assert.equal(pending?.done,false);
   const r2=hist.milestones.find(m=>m.id==='r2-service-binding-installed');
   assert.equal(r2?.points,2.0,'real R2 binding still not installed');
   assert.equal(r2?.done,false);
   assert.equal(quality.dimensions.find(d=>d.id==='durability')?.score,18.5);
   assert.equal(quality.dimensions.find(d=>d.id==='durability')?.previous,18.4);
   assert.equal(quality.comparison.previousScore,79.1);
   assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0);
   assert.equal(data.commercialGo.certifiedGates,0);
   const src=fs.readFileSync(path.join(root,
     'cloudflare-yparty-worker/src/trusted-frozen-source.mjs'),'utf8');
   for(const token of [
      "import {projectPublicCatalog",
      'const keys=Object.keys(original),allowed=Object.keys(row);',
      'allowed.some(key=>!Object.prototype.hasOwnProperty.call(original,key)',
      'original[key]!==row[key]))throw fail();',
      'expectedProjectedSha256'
   ])assert(src.includes(token),'C60 actual source PUBLIC-only field validation missing: '+token);
   assert(!src.includes('JSON.stringify(source?.get(id))'),
      'C60 cannot regress to order-dependent Yjs JSON comparisons');
   const qa=fs.readFileSync(path.join(root,
     'cloudflare-yparty-worker/qa/p0-gate-d-trusted-paged-source.test.mjs'),'utf8');
   for(const token of [
      'C60 RED: numeric v1 frozen public Yjs catalog accepts semantically identical',
      'C60 RED: paged v2 frozen public Yjs catalog accepts reordered allowed keys',
      'C60 private ownerPin/costo still fail closed in both v1 numeric and v2 paged'
   ])assert(qa.includes(token),'C60 RED→GREEN source QA missing '+token);
   assert.equal(data.assessedProductSha,'6e802e6e0df0988922220dd634a40f7788638f05',
      'C61 must credit exact C60 source merged into real friendly-123');
 }
 // C63 source-backed privacy gate: -cat roots are EXACT PUBLIC allowlist in
 // both v1 legacy numeric and v2 paged, and private-only roots cannot skip it.
 const c62=data.groups.flatMap(g=>g.milestones).find(m=>m.id==='c62-legacy-frozen-private-root-rejection');
 if(c62?.done){
   const hist=data.groups.find(g=>g.id==='frozen-history');
   assert.equal(hist?.weight,18,'original history budget fixed18');
   assert.equal(oneDecimal(hist.milestones.reduce((n,m)=>n+m.points,0)),18);
   assert.equal(c62.points,0.2,'C62 private-only roots engineering QA capped0.2');
   assert.equal(c62.source,'cloudflare-yparty-worker/src/trusted-frozen-source.mjs');
   const head=hist.milestones.find(m=>m.id==='real-firebase-head-complete');
   assert.equal(head?.points,2.0,'actual Firebase economic HEAD still unearned2.0');
   assert.equal(head?.done,false);
   const r2=hist.milestones.find(m=>m.id==='r2-service-binding-installed');
   assert.equal(r2?.points,2.0);
   assert.equal(r2?.done,false);
   assert.equal(quality.dimensions.find(d=>d.id==='security')?.score,10.9);
   assert.equal(quality.dimensions.find(d=>d.id==='security')?.previous,10.9);
   assert.equal(quality.comparison.previousScore,79.1);
   assert.equal(quality.dimensions.find(d=>d.id==='durability')?.score,18.5);
   assert.equal(quality.dimensions.find(d=>d.id==='durability')?.previous,18.4);
   assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0);
   assert.equal(data.commercialGo.certifiedGates,0);
   const src=fs.readFileSync(path.join(root,
      'cloudflare-yparty-worker/src/trusted-frozen-source.mjs'),'utf8');
   for(const token of [
      "if(channel==='cat'){",
      "for(const root of doc.share.keys())if(root!=='productos'&&root!=='ubicaciones')throw fail();",
      "async function validateDocument(frames,channel,scope={}){",
      "validateDocument(frames,channel,{room,",
      "validateDocument(all,channel,{room,",
      "const keys=Object.keys(original),allowed=Object.keys(row);"
   ])assert(src.includes(token),'C62 REAL source strict public roots v1/v2 required: '+token);
   assert(!src.includes("if(strictCatalog||[...doc.share.keys()]"),
     'C62 must never allow unknown-only v1 catalog roots');
   const qa=fs.readFileSync(path.join(root,
      'cloudflare-yparty-worker/qa/p0-gate-d-trusted-paged-source.test.mjs'),'utf8');
   for(const token of [
      'C62 RED P0: legacy v1 unknown/private-only catalog roots are refused',
      "['products','banco_privado','eventos']",
      'C60 private ownerPin/costo still fail closed in both v1 numeric and v2 paged'
   ])assert(qa.includes(token),'C62 adversarial ROOT test missing '+token);
   const onStart=fs.readFileSync(path.join(root,
      'cloudflare-yparty-worker/qa/p0-gate-d-real-onstart-workerd.test.mjs'),'utf8');
   for(const token of [
      "const publicCatalog=new Y.Doc(),catUpdates=[]",
      "publicCatalog.getMap('productos').set(id,{",
      "const opsDoc=new Y.Doc(),opsFrames=[]",
      "getMap('eventos')"
   ])assert(onStart.includes(token),'C62 Workerd real split PUBLIC -cat / private -ops fixture missing '+token);
   assert.equal(data.assessedProductSha,'6e802e6e0df0988922220dd634a40f7788638f05',
      'C63 must pin C62 exact real product source merge, not workshop');
 }

 // C65: a separate source-audited QA quality bump on top of C63's original
 // fixed-100 migration checklist. C64 real product code proves that a
 // certified frozen import cannot be reopened from journal-only or an
 // unrelated legacy snapshot. It does not certify live Firebase HEAD/R2.
 assert.equal(quality.lastAuditedProductSha,
   'ca86aa4bbe7df1d9da0293e803896edbac53380b',
   'C65 quality credit pins exact merged functional C64 source');
 const c64Source=fs.readFileSync(path.join(root,
   'cloudflare-yparty-worker/src/open-existing-store.mjs'),'utf8');
 assert(c64Source.includes("if(now.snapshotKind!=='blocks')"),
   'C65 no credit without fail-closed C64 blocked snapshot readback');
 const c64QA=fs.readFileSync(path.join(root,
   'cloudflare-yparty-worker/qa/p0-c64-frozen-base-readback.test.mjs'),'utf8');
 for(const token of [
   'C64 RED P0: receipt cannot ACK a cold reopened room',
   'C64 RED P0: a legacy snapshot cannot impersonate the missing blocked frozen import'
 ])assert(c64QA.includes(token),'C65 negative source-executed evidence missing '+token);
 assert.equal(data.score,92.0,'C64 durability QA does not earn real Firebase/R2/physical migration');
 assert.equal(quality.score,79.2);
 assert.equal(quality.dimensions.find(d=>d.id==='durability')?.score,18.5);
 assert.equal(quality.dimensions.find(d=>d.id==='durability')?.previous,18.4);
 assert.equal(quality.dimensions.find(d=>d.id==='security')?.score,10.9);
 assert.equal(data.groups.flatMap(g=>g.milestones).filter(m=>!m.done)
   .reduce((n,m)=>n+m.points,0),8.0,'original C63 unearned port points stay unearned');
 assert.equal(data.commercialGo.certifiedGates,0);
 assert.equal(quality.dimensions.find(d=>d.id==='physical')?.score,0);
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
