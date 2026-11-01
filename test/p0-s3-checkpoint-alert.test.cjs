'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const begin=source.indexOf('    function avisoCheckpoint(motivo) {');
const end=source.indexOf('    function hacerCkpt() {',begin);
test('S3 checkpoint error renders a visible, scoped status (without blocking the app)',()=>{
  assert.ok(begin>=0&&end>begin,'real checkpoint-visible-error handler is present');
  const els={};
  const parent={appendChild(e){els[e.id]=e; e.parentElement=parent;}};
  const badge={parentElement:parent};
  const doc={
    getElementById(id){return id==='oc-offline-badge'?badge:els[id]||null;},
    createElement(tag){return {tag,id:'',style:{},textContent:'',setAttribute(k,v){this[k]=v;}};}
  };
  const ctx=vm.createContext({document:doc,nombre:'catalogo',log(){},String});
  vm.runInContext(source.slice(begin,end),ctx);
  vm.runInContext('avisoCheckpoint("cuerpo demasiado grande")',ctx);
  const alert=els['f123-checkpoint-alert-catalogo'];
  assert.ok(alert);
  assert.equal(alert.role,'status');
  assert.match(alert.textContent,/checkpoint.*grande/i);
  assert.equal(alert.style.display,'inline-block');
});
test('S3 both client-size failure and rejected durable ACK call the visible alert',()=>{
  assert.match(source,/MAX_OP_BYTES\) \{[^\n]*avisoCheckpoint/);
  assert.match(source,/result\.kind === "ckpt"[^\n]*avisoCheckpoint/);
});
