'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8').replace(/\r\n/g,'\n');

function fixture(piloto, proveedor=null, sombra=undefined) {
  const calls=[];
  const channels=[
    ['catalogo','doc','canal','bc'],
    ['operaciones','opsDoc','opsCanal','opsBc']
  ];
  const listeners={};
  const API={};
  for(const [name,doc,channel,bc] of channels){
    API[doc]={on:(event,fn)=>{assert.equal(event,'update');listeners[name]=fn;}};
    API[channel]={proveedor:channel==='canal'?proveedor:null,enviarUpdate:()=>calls.push(name+':enviar')};
    if(channel==='canal'&&sombra!==undefined)API.canalSombra=sombra==='same'?API.canal:sombra&&{enviarUpdate:()=>calls.push('catalogo:sombra-legado')};
    API[bc]={postMessage:()=>calls.push(name+':otra-pestana')};
    const start=source.indexOf('    API.'+doc+'.on("update", function (update, origin) {');
    const end=source.indexOf('\n    });',start);
    assert.ok(start>=0&&end>start);
    vm.runInNewContext(source.slice(start,end+7),{API,piloto,pedirProcesarEventos:()=>calls.push('operaciones:aplicar')});
  }
  return {calls, listeners};
}
test('the default relay still sends locally created operations with Yjs origin null',()=>{
  const {calls,listeners}=fixture(null);
  for(const handle of Object.values(listeners))handle(new Uint8Array([1]),null);
  assert.deepEqual(calls,['catalogo:otra-pestana','catalogo:enviar','operaciones:otra-pestana','operaciones:enviar']);
});
test('a disconnected provider cannot turn a local update into a remote update',()=>{
  const {calls,listeners}=fixture({});
  listeners.operaciones(new Uint8Array([1]),null);
  assert.deepEqual(calls,['operaciones:otra-pestana','operaciones:enviar']);
});
test('an incoming update from the real catalog provider is shared across tabs without echo or shadow copy',()=>{
  const provider={};
  const {calls,listeners}=fixture({},provider,null);
  listeners.catalogo(new Uint8Array([1]),provider);
  assert.deepEqual(calls,['catalogo:otra-pestana'],'the origin device already shadow-wrote it to legacy');
});

test('(c) shadow write: with the pilot ON every local catalog update ALSO goes to the legacy relay',()=>{
  const {calls,listeners}=fixture({},{},'other');
  listeners.catalogo(new Uint8Array([1]),null);
  assert.deepEqual(calls,['catalogo:otra-pestana','catalogo:enviar','catalogo:sombra-legado']);
});

test('(c) after fallback the shadow channel IS the catalog channel: one legacy send, never two writers',()=>{
  const {calls,listeners}=fixture({},null,'same');
  listeners.catalogo(new Uint8Array([1]),null);
  assert.deepEqual(calls,['catalogo:otra-pestana','catalogo:enviar']);
});

function bootPiloto(rollout, cargarPiloto) {
  const start = source.indexOf('    var piloto = null;');
  const end = source.indexOf('    if (piloto) {', start);
  assert.ok(start >= 0 && end > start);
  return vm.runInNewContext('(async () => {\n' + source.slice(start,end) + '\nreturn piloto;\n})', {
    API: {rollout}, codigo: 'synthetic-only', cargarPiloto, log() {}
  });
}

test('(a) switch OFF (policy without yparty, failed or absent): the pilot script is never even requested',async()=>{
  let calls=0;
  for (const rollout of [undefined, null, {outboxV2:true,gzipWrite:false,yparty:false,stage:'owner-canary'},
    {outboxV2:false,gzipWrite:false,stage:'disabled'}, {yparty:'true'}, {yparty:1}])
    assert.equal(await bootPiloto(rollout, async()=>{calls++;return {};})(), null);
  assert.equal(calls,0);
});

test('a failed pilot import leaves the existing relay available to the boot sequence', async () => {
  const boot = bootPiloto({yparty:true}, async () => { throw Error('synthetic missing script'); });
  assert.equal(await boot(), null);
});

test('(b) switch ON for the store: the device key (second lock) still decides via cargarPiloto',async()=>{
  const pilot={};
  assert.equal(await bootPiloto({yparty:true}, async()=>pilot)(), pilot);
  assert.equal(await bootPiloto({yparty:true}, async()=>null)(), null, 'device without the second key stays legacy');
});

test('a stalled pilot script releases startup and its late load cannot select the provider', async () => {
  const start = source.indexOf('  async function cargarPiloto(');
  const end = source.indexOf('\n  // Fase 1:', start);
  assert.ok(start >= 0 && end > start);
  let expire, removed = false, factoryCalls = 0;
  const script = {remove() { removed = true; }};
  let appended;
  const scriptAppended = new Promise(resolve => { appended = resolve; });
  const load = vm.runInNewContext(source.slice(start, end) + '\ncargarPiloto;', {
    TextEncoder,
    crypto: {subtle: {digest: async () => new ArrayBuffer(32)}},
    localStorage: {getItem: key => key === 'f123_yparty_qa' ? '1' : '0'.repeat(32)},
    window: {F123YPartyPilot() { factoryCalls++; }},
    document: {createElement: () => script, head: {appendChild: appended}},
    setTimeout: callback => { expire = callback; return 1; },
    clearTimeout() {}
  });
  const pending = load('synthetic-only');
  await scriptAppended;
  assert.equal(typeof expire, 'function');
  expire();
  await assert.rejects(pending, /plazo/);
  assert.equal(removed, true);
  script.onload?.();
  assert.equal(factoryCalls, 0);
});
