'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const begin=source.indexOf('    function diagnosticarCkpt(motivo, bytes) {');
const end=source.indexOf('    function hacerCkpt() {',begin);
test('S3 checkpoint error renders a visible, scoped status (without blocking the app)',()=>{
  assert.ok(begin>=0&&end>begin,'real checkpoint-visible-error handler is present');
  const els={};
  const parent={appendChild(e){els[e.id]=e;e.parentElement=parent;},removeChild(e){delete els[e.id];}};
  const badge={parentElement:parent};
  const doc={
    getElementById(id){return id==='oc-offline-badge'?badge:els[id]||null;},
    createElement(tag){return {tag,id:'',style:{},textContent:'',setAttribute(k,v){this[k]=v;}};}
  };
  const ctx=vm.createContext({document:doc,nombre:'catalogo',API:{esLicenciaPruebaJfc:true},window:{dispatchEvent(){}},CustomEvent:class {constructor(t,opts){this.type=t;this.detail=opts.detail;}},log(){},String});
  vm.runInContext(source.slice(begin,end),ctx);
  vm.runInContext('diagnosticarCkpt("cuerpo demasiado grande", 262145)',ctx);
  const alert=els['f123-checkpoint-alert-catalogo'];
  assert.ok(alert);
  assert.equal(alert.role,'status');
  assert.match(alert.textContent,/checkpoint.*grande/i);
  assert.equal(alert.style.display,'inline-block');
});
test('S3 failures are visible for oversize, negative durable ACK and encryption',()=>{
  assert.match(source,/diagnosticarCkpt\("snapshot-over-limit", buf\.byteLength\)/);
  assert.match(source,/diagnosticarCkpt\("checkpoint-rpc-ack-failed", 0\)/);
  assert.match(source,/diagnosticarCkpt\("checkpoint-encrypt-or-gzip-failed", 0\)/);
});
