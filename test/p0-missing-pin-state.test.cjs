'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const auth=fs.readFileSync(path.join(__dirname,'../docs/auth-ui.js'),'utf8');
const begin=auth.indexOf('    // A licensed browser with no local verifier');
const end=auth.indexOf('    const sb = window.OCSecure.segundosBloqueo',begin);
if(begin<0||end<0)throw new Error('missing PIN-state guard');
const guard=auth.slice(begin,end);
async function check(activated,state){
 let messages=[],fallback=false;
 const context={dispositivoApropiado:()=>activated,window:{OCSecure:{estadoSecreto:()=>state}},error:m=>messages.push(m)};
 vm.createContext(context);
 const output=vm.runInContext('(function(){'+guard+'return "continue";})()',context);
 return {output,messages};
}
test('activated and missing PIN verifier is not labelled wrong PIN',async()=>{
 const r=await check(true,'vacio');
 assert.equal(r.output,undefined);assert.equal(r.messages.length,1);
 assert.match(r.messages[0],/no saved PIN credentials/);
});
test('existing verifier continues the ordinary PIN check',async()=>{
 const r=await check(true,'ok');assert.equal(r.output,'continue');assert.equal(r.messages.length,0);
});
test('new demo onboarding preserves its existing PIN behavior',async()=>{
 const r=await check(false,'vacio');assert.equal(r.output,'continue');assert.equal(r.messages.length,0);
});
test('corrupt verifier reaches existing corruption recovery guard',async()=>{
 const r=await check(true,'corrupto');assert.equal(r.output,'continue');assert.equal(r.messages.length,0);
});
