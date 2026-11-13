'use strict';
// v763: the catalog checkpoint must fit the RPC limit and be renewed. Measured on QA store limpia1 (v0.7.58, 13 nov 2026):
// catalog Y.Doc 1,069,757 B plain (actividad 800 KB = 75 %, productos 43 KB, photo bytes 0), gc-compaction gains 0 B,
// gzip 123,524 B. Before v763 that checkpoint was skipped forever ("ckpt fuera del límite de RPC").
// This test runs the REAL hacerCkpt, _gzipYjs and _compactarYjsSinCambiarCausalidad with real Yjs and real AES-GCM.
// Synthetic data only: no network, no customer data.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const vendor=fs.readFileSync(path.join(__dirname,'../docs/vendor/yjs-bundle.min.js'),'utf8');
const cut=(a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i);assert.ok(i>=0&&j>i,a);return src.slice(i,j);};
const FB='f123_relay_cupo_fb_v1',SB='f123_relay_cupo_v1';
const ctx=vm.createContext({console,TextEncoder,TextDecoder,Uint8Array,Response,CompressionStream,DecompressionStream,crypto:webcrypto,btoa,atob,Promise,Date,Math,JSON,Object,Number,String});
ctx.window=ctx;vm.runInContext(vendor,ctx);
vm.runInContext(cut('  function _frame(tag, payload)','\n  // Progressive per-license')+cut('  function _compactarYjsSinCambiarCausalidad','  function crearCanal(')+
  cut('  async function cifrarBin(clave, bytes)','\n  // =====')+
  '\nfunction armar(){'+cut('    var MAX_OP_BYTES','    var MAX_GRUPOS_EN_VIVO')+cut('    function hacerCkpt() {','    function conectar() {')+
  '\nfunction _b64(buf){var u=new Uint8Array(buf),s="";for(var i=0;i<u.length;i++)s+=String.fromCharCode(u[i]);return btoa(s);}'+
  '\nreturn hacerCkpt;}',ctx);
const Y=ctx.Y,J=o=>JSON.parse(JSON.stringify(o)); // values cross the vm realm: compare data, not prototypes
const hex=n=>Array.from(webcrypto.getRandomValues(new Uint8Array(n)),b=>b.toString(16).padStart(2,'0')).join('');
// Shape of mock-backend.js _actividadExportable: {id, origen, clase, versiones:[movimiento sellado]}.
function tienda(nProd,nAct){
  const d=new Y.Doc(),prods=d.getMap('productos'),act=d.getMap('actividad'),origenes=Array.from({length:6},()=>hex(16));
  for(let i=0;i<nProd;i++){
    const id='p'+hex(8);
    for(let r=1;r<=28;r++) prods.set(id,{id,nombre:'Producto de prueba '+i,precio:1.25+i,costo:0.8+i,stock:30-r,categoria:'cat'+(i%5),codigo:'779'+String(1e9+i),fotoHash:'sha256:'+hex(32),rev:r,actualizado:1762990000000+r});
  }
  for(let i=0;i<nAct;i++){
    const origen=origenes[i%6],mid=hex(16);
    act.set(origen+':evento:'+mid,{id:origen+':evento:'+mid,origen,clase:'evento',versiones:[{id:mid,tipo:i%3?'venta':'ajuste',productoId:'p'+hex(8),cantidad:1+i%4,total:(2.5*(1+i%4)).toFixed(2),usuario:'u'+(i%3),ts:1762990000000+i*61000,sello:hex(32),prevSello:hex(32)}]});
  }
  return d;
}
async function correr(doc,capa){
  const clave=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
  const logs=[],sobres=[],diag=[];
  Object.assign(ctx,{_soloMemoria:false,permiteCkpt:true,nombre:'catalogo',doc,
    canal:{recuperando:false,ws:{readyState:1,peerOnly:false,relayLayer:capa}},
    API:{clave,rollout:{outboxV2:true,gzipWrite:false}},_currentPullState:null,_appliedPullCursor:{rev:7,seq:1762990000000},
    _outbox:{checkpoint:'',pending:[]},_durableQueue:Promise.resolve(),_durableInFlight:{},
    log:m=>logs.push(String(m)),diagnosticarCkpt:(m,b)=>diag.push(m),guardarSobre:s=>sobres.push(s),
    updateHash:async b=>Buffer.from(await webcrypto.subtle.digest('SHA-256',b)).toString('hex'),
    F123Relay:{ckptFrameBytes:768*1024}});
  ctx.window.F123Relay=ctx.F123Relay;
  vm.runInContext('armar()()',ctx);
  await new Promise(r=>setTimeout(r,1500));
  return {clave,logs,sobres,diag};
}
// A new device applying the checkpoint through the same reader rules as manejar(): tag 0 raw, tag 7 gzip (pull only).
async function reconstruir(sobre,clave){
  const claro=await vm.runInContext('descifrarBin',ctx)(clave,Buffer.from(sobre.c,'base64'));
  const tag=claro[0],payload=claro.subarray(1);
  const update=tag===7?await vm.runInContext('_gzipYjs',ctx)(payload,true):tag===0?payload:null;
  assert.ok(update,'readable frame tag '+tag);
  const nuevo=new Y.Doc();Y.applyUpdate(nuevo,update);return {nuevo,tag};
}
for(const [nombre,nProd,nAct] of [['limpia1 (41 productos, 2100 actividades)',41,2100],['limpia3 (7 productos)',7,40]]){
  test('v763 '+nombre+': checkpoint en Firebase cabe y un aparato nuevo reconstruye el mismo estado',async()=>{
    const doc=tienda(nProd,nAct),plano=Y.encodeStateAsUpdate(doc).length;
    const r=await correr(doc,FB);
    console.log(nombre,JSON.stringify({planoB:plano,sobres:r.sobres.length,cifradoB:r.sobres[0]&&Buffer.from(r.sobres[0].c,'base64').length,logs:r.logs}));
    assert.deepEqual(r.diag,[],'sin snapshot-over-limit');
    assert.equal(r.sobres.length,1,'checkpoint escrito');
    const cif=Buffer.from(r.sobres[0].c,'base64').length;
    assert.ok(cif<=768*1024,'cabe en el limite del RPC: '+cif);
    const {nuevo,tag}=await reconstruir(r.sobres[0],r.clave);
    if(plano+29<=768*1024) assert.equal(tag,0,'lo que ya cabia sigue en el formato viejo (aparatos <636)');
    assert.deepEqual(J(nuevo.getMap('productos').toJSON()),J(doc.getMap('productos').toJSON()),'productos completos iguales');
    for(const m of ['productos','actividad']) assert.deepEqual(J(nuevo.getMap(m).toJSON()),J(doc.getMap(m).toJSON()),'mapa '+m+' completo igual');
    assert.deepEqual(Array.from(Y.encodeStateVector(nuevo)),Array.from(Y.encodeStateVector(doc)),'mismo vector de estado');
  });
}
// v765: a browser without DecompressionStream (Safari <16.4) must read the same compressed checkpoint.
test('v765: sin DecompressionStream el lector JS reconstruye el mismo estado y rechaza un CRC alterado',async()=>{
  const zlib=require('node:zlib'),gunzipJs=vm.runInContext('_gunzipJs',ctx);
  const doc=tienda(41,2100),full=Y.encodeStateAsUpdate(doc);
  const nativo=await vm.runInContext('_gzipYjs',ctx)(full,false);
  const viejo=vm.createContext({Uint8Array,Int32Array,Uint16Array,Error,Promise,Math,window:{}});
  vm.runInContext(cut('  async function _gzipYjs','  // Progressive per-license'),viejo);
  const leido=await vm.runInContext('_gzipYjs',viejo)(nativo,true);
  assert.ok(leido,'el lector de respaldo devuelve bytes');
  assert.ok(Buffer.from(leido).equals(Buffer.from(full)),'mismos bytes que el estado original');
  const nuevo=new Y.Doc();Y.applyUpdate(nuevo,leido);
  for(const m of ['productos','actividad']) assert.deepEqual(J(nuevo.getMap(m).toJSON()),J(doc.getMap(m).toJSON()),'mapa '+m);
  const roto=Buffer.from(nativo);roto[roto.length-6]^=1;
  assert.equal(gunzipJs(new Uint8Array(roto)),null,'CRC alterado se rechaza');
  assert.equal(gunzipJs(new Uint8Array(nativo.subarray(0,nativo.length-20))),null,'truncado se rechaza');
  // Every DEFLATE block type and strategy zlib can emit (stored, fixed, dynamic, RLE, Huffman-only).
  const muestras=[Buffer.alloc(0),Buffer.from('a'),Buffer.alloc(70000,7),require("node:crypto").randomBytes(90000),Buffer.from(full.subarray(0,300000))];
  for(const m of muestras) for(const level of [0,1,6,9]) for(const strategy of [zlib.constants.Z_DEFAULT_STRATEGY,zlib.constants.Z_FIXED,zlib.constants.Z_RLE,zlib.constants.Z_HUFFMAN_ONLY]){
    const r=gunzipJs(new Uint8Array(zlib.gzipSync(m,{level,strategy})));
    assert.ok(r&&Buffer.from(r).equals(Buffer.from(m)),'zlib level '+level+' strategy '+strategy+' len '+m.length);
  }
});
test('v763: en Supabase (aparatos <636 que ignoran el marco 7) no se escribe gzip; el motivo queda en el log',async()=>{
  const r=await correr(tienda(41,2100),SB);
  assert.equal(r.sobres.length,0);
  assert.ok(r.logs.some(m=>/ckpt fuera del límite de RPC \(\d+B\) en catalogo/.test(m)),r.logs.join('|'));
});
