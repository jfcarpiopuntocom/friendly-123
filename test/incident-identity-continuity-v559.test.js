"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

const sync=fs.readFileSync(path.join(__dirname,"../docs/sync-yjs.js"),"utf8");
const crypto=fs.readFileSync(path.join(__dirname,"../docs/crypto-store.js"),"utf8");

function actualSyncApply(recuperando){
  const a=sync.indexOf("    var ultimaAplicacionVisible =");
  const b=sync.indexOf("    function valores(col)",a);
  const c=sync.indexOf("    // Cambios locales del catálogo",b);
  assert.ok(a>0&&b>a&&c>b,"production Yjs store apply functions found");
  const ctx={
    // Extracted apply() excludes the independently tested physical PN index.
    incorporarTestigosStock:items=>items,
    API:{
      meta:{get:key=>({nombreNegocio:"Synthetic Owner Shop",nombreRev:8,nombreTs:1700000000000,nombreEsDueno:true,
        pinsRol:{owner:"843"}}[key]??null)},
      canal:{recuperando},
      get:col=>col==="productos"?{"synthetic-item":{id:"synthetic-item",fotoHash:"synthetic-photo-hash"}}:{}
    },
    COLECCIONES:["productos","ubicaciones","usuarios","clientes","promotoras","sucursales","ventas","gastos","transferencias","dispositivos","categorias","ajustes"],
    _aplicando:false,ultimaAplicacionVisible:Promise.resolve(false),
    _primerMergeAceptado:false,_otroRemoto:false,_productosRemotos:new Set(),_actividadRemota:new Set(),
    _retryAplicar:{pedir(){},cancelar(){}}, // scheduler behavior is covered by yjs-application-retry.test.cjs
    window:{OCSync:{aplicarCatalogo:(remote,role)=>{ctx.received={remote,role};return {ok:true};}},dispatchEvent(){}},
    Promise,Number,Object,Array,JSON,setTimeout,CustomEvent:class{}
  };
  vm.createContext(ctx);
  const apply=vm.runInContext(`(function(){${sync.slice(a,c)};return aplicar;})()`,ctx);
  apply();
  return ctx.received;
}

function actualIdentifyPin(){
  const a=crypto.indexOf("  async function identificarPin(pin) {");
  const b=crypto.indexOf("\n  function limpiarLockouts()",a);
  assert.ok(a>0&&b>a,"production local PIN validator found");
  const ctx={
    leerSecreto:()=>({salt:"synthetic-salt",ownerHash:"synthetic-owner-hash"}),
    hashPin:async()=>"synthetic-owner-hash",segundosBloqueo:()=>0,
    registrarExito(){},registrarFallo(){},leerPinQueAbre:()=>({}),
    directorioNormalizado:()=>({}),leerPinsEquipo:()=>({}),
    String,RegExp,Array,Promise
  };
  vm.createContext(ctx);
  return vm.runInContext(`(function(){${crypto.slice(a,b)};return identificarPin;})()`,ctx);
}

test("a locally verified owner PIN remains usable while unrelated Yjs history is pending",async()=>{
  const identify=actualIdentifyPin();
  assert.equal(await identify("843"),"dueno");
});

test("partial recovery forwards name/photo metadata but withholds credential mutation",()=>{
  // Synthetic current metadata and photo pointer; no client data or relay traffic.
  const received=actualSyncApply(true);
  assert.equal(received.role,"dueno");
  assert.equal(received.remote.nombreNegocio,"Synthetic Owner Shop");
  assert.equal(received.remote.productos[0].fotoHash,"synthetic-photo-hash");
  assert.equal(received.remote.pinsRol,null,
    "unknown legacy causal parents may still contain newer credentials");
});

test("custom PIN becomes available only after complete recovery",()=>{
  const received=actualSyncApply(false);
  assert.deepEqual(received.remote.pinsRol,{owner:"843"});
});
