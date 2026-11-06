'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('src/app/app-inline-03.js','utf8');
const a=source.indexOf('if ("serviceWorker" in navigator) {');
const b=source.indexOf('// 4D: compare the PUBLIC shell',a);
assert.ok(a>=0&&b>a,'real production SW event listener exists');
const code=source.slice(a,b);
function scenario({hadController=false,hadVersion=false,announced='f123-shell-v674',initialShell='f123-shell-v674'}={}){
 const local=new Map(),session=new Map(),listeners={};
 if(hadVersion)local.set('f123_version_vista','shell v673|f123-shell-v673');
 const ctx={
  navigator:{serviceWorker:{controller:hadController?{id:'old-shell'}:null,
    addEventListener(type,listener){listeners[type]=listener}}},
  window:{addEventListener(){}},
  localStorage:{getItem:k=>local.get(k)??null,setItem:(k,v)=>local.set(k,String(v))},
  sessionStorage:{getItem:k=>session.get(k)??null,setItem:(k,v)=>session.set(k,String(v))}
 };
 vm.runInNewContext(code,ctx);
 ctx.window.__f123PrimerShellCargado=initialShell;
 local.set('f123_version_vista','shell v674|f123-shell-v674');
 listeners.message({data:{tipo:'shell-actualizado',shell:announced}});
 return session.get('f123_reload_al_entrar');
}
test('fresh origin first SW claim does not arm PIN-login reload',()=>assert.equal(scenario(),undefined));
test('older controller replacement still arms safe reload',()=>assert.equal(scenario({hadController:true,hadVersion:true}),'1'));
test('existing local version with no initial SW still honors real update',()=>assert.equal(scenario({hadVersion:true}),'1'));
test('later different new SW version on same first tab still arms safe reload',()=>assert.equal(scenario({announced:'f123-shell-v675'}),'1'));
