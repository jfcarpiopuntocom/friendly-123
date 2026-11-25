'use strict';
// Synthetic notebook and storage only. No relay, credentials or customer data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browser } = require('./helpers/browser.cjs');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const settleUntil = async (condition) => {
  for (let i = 0; i < 500 && !condition(); i++) await Promise.resolve();
  assert.ok(condition(), 'synthetic durable sale must reach its blocked ACK');
};

test('partial recovery never queues a merge behind a sale and retries only after re-entry', async () => {
  const w = browser();
  let role = 'dueno';
  w.OCAuth = { rolActual: () => role, esDemo: () => false };
  const fixture = await w.request('/api/respaldo/exportar');
  fixture.productos = [{ id: 'fixture-sale', nombre: 'Synthetic sale', precio: 5, costo: 1,
    stockActual: 10, stockBase: 10, stockPN: {}, stockTs: 1, rev: { c: 1, d: 'fixture' } }];
  await w.request('/api/respaldo/importar', 'POST', fixture);

  Object.assign(w, { crypto: require('node:crypto').webcrypto, TextEncoder, TextDecoder });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/vendor/yjs-bundle.min.js'), 'utf8'), w);
  const doc = new w.Y.Doc();
  const remote = { ubicaciones: [], productos: [{ id: 'fixture-remote', nombre: 'Synthetic remote',
    precio: 3, stockActual: 4, rev: { c: 1000, d: 'remote' } }], nombreNegocio: '', pinsRol: null };
  doc.getMap('productos').set('fixture-remote', vm.runInContext('(' + JSON.stringify(remote.productos[0]) + ')', w));
  const beforeYjs = Buffer.from(w.Y.encodeStateAsUpdate(doc));

  const acks = [];
  w.OCEstadoIDB = {
    guardarConRevision: () => new Promise(resolve => acks.push(resolve)),
    guardar: () => new Promise(resolve => acks.push(resolve)),
  };
  const realSetItem = w.localStorage.setItem;
  w.localStorage.setItem = () => { throw Error('synthetic storage quota'); };
  const sale = w.request('/api/productos/fixture-sale/venta', 'POST', { cantidad: 1 });
  try {
    await settleUntil(() => acks.length > 0);
    const partial = w.OCSync.aplicarCatalogoParcialSeguro || w.OCSync.aplicarCatalogo;
    const result = partial.call(w.OCSync, remote, null, true);
    assert.ok(result === false || result.ok === false, 'sale in flight must refuse the partial merge');
    role = '';
    acks.shift()(true);
    await sale;
    for (let i = 0; i < 500 && acks.length; i++) acks.shift()(true);
    w.localStorage.setItem = realSetItem;
    delete w.OCEstadoIDB;
    let after = await w.request('/api/respaldo/exportar');
    assert.equal(after.productos.some(p => p.id === 'fixture-remote'), false, 'logout must not drain a partial merge');
    assert.deepEqual(Buffer.from(w.Y.encodeStateAsUpdate(doc)), beforeYjs, 'deferred facts stay in Yjs');

    role = 'dueno';
    const retried = w.OCSync.aplicarCatalogoParcialSeguro(remote, null, true);
    assert.equal(retried.ok, true, 'the same facts can merge after a verified re-entry');
    after = await w.request('/api/respaldo/exportar');
    assert.equal(after.productos.filter(p => p.id === 'fixture-remote').length, 1);
    assert.deepEqual(Buffer.from(w.Y.encodeStateAsUpdate(doc)), beforeYjs);
  } finally {
    role = '';
    while (acks.length) acks.shift()(false);
    w.localStorage.setItem = realSetItem;
    delete w.OCEstadoIDB;
    doc.destroy();
    await sale.catch(() => {});
  }
});

test('partial recovery does not queue during a retention save or apply after logout', async () => {
  const w=browser();let role='dueno';
  w.OCAuth={rolActual:()=>role,esDemo:()=>false};
  const acks=[];
  w.OCEstadoIDB={guardarConRevision:()=>new Promise(resolve=>acks.push(resolve)),guardar:()=>new Promise(resolve=>acks.push(resolve))};
  const set=w.localStorage.setItem;w.localStorage.setItem=()=>{throw Error('synthetic storage quota');};
  const remote={ubicaciones:[],productos:[{id:'fixture-retention-remote',nombre:'Synthetic',precio:3,stockActual:4,rev:{c:1000,d:'remote'}}]};
  const request=w.request('/api/config/retencion','PUT',{dias:14});
  try {
    await settleUntil(()=>acks.length>0);
    const result=w.OCSync.aplicarCatalogoParcialSeguro(remote,null,true);
    assert.equal(result.ok,false);
    role='';acks.shift()(true);await request;
    while(acks.length)acks.shift()(true);
    w.localStorage.setItem=set;delete w.OCEstadoIDB;
    assert.equal((await w.request('/api/respaldo/exportar')).productos.some(p=>p.id==='fixture-retention-remote'),false);
    role='dueno';assert.equal(w.OCSync.aplicarCatalogoParcialSeguro(remote,null,true).ok,true);
  } finally { role='';while(acks.length)acks.shift()(false);w.localStorage.setItem=set;delete w.OCEstadoIDB;await request.catch(()=>{}); }
});

test('partial recovery does not queue during a payout or apply after logout', async () => {
  const w=browser();let role='dueno';w.OCAuth={rolActual:()=>role,esDemo:()=>false};
  const person=await w.request('/api/promotoras','POST',{nombre:'Synthetic person',comisionBase:40});
  const rack=await w.request('/api/ubicaciones','POST',{nombre:'Synthetic rack',tipo:'socio'});
  await w.request('/api/ubicaciones/'+rack.id,'PUT',{promotoraId:person.id});
  const product=await w.request('/api/productos','POST',{nombre:'Synthetic',barcode:'SYN-PAYOUT',precio:100,costo:20,stockInicial:2,ubicacionId:rack.id});
  await w.request('/api/productos/'+product.id+'/venta','POST',{cantidad:1});
  const acks=[];w.OCEstadoIDB={guardarConRevision:()=>new Promise(resolve=>acks.push(resolve)),guardar:()=>new Promise(resolve=>acks.push(resolve))};
  const set=w.localStorage.setItem;w.localStorage.setItem=()=>{throw Error('synthetic storage quota');};
  const remote={ubicaciones:[],productos:[{id:'fixture-payout-remote',nombre:'Synthetic',precio:3,stockActual:4,rev:{c:1000,d:'remote'}}]};
  const request=w.request('/api/payouts','POST',{ubicacionId:rack.id,payeeId:person.id,amountCents:1500,medioPago:'efectivo',opId:'synthetic-partial'});
  try {
    await settleUntil(()=>acks.length>0);
    const result=w.OCSync.aplicarCatalogoParcialSeguro(remote,null,true);
    assert.equal(result.ok,false);
    role='';acks.shift()(true);await request;
    while(acks.length)acks.shift()(true);
    w.localStorage.setItem=set;delete w.OCEstadoIDB;
    assert.equal((await w.request('/api/respaldo/exportar')).productos.some(p=>p.id==='fixture-payout-remote'),false);
    role='dueno';assert.equal(w.OCSync.aplicarCatalogoParcialSeguro(remote,null,true).ok,true);
  } finally {role='';while(acks.length)acks.shift()(false);w.localStorage.setItem=set;delete w.OCEstadoIDB;await request.catch(()=>{});}
});
