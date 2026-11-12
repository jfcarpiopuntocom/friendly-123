'use strict';
// v735 + v739 (JFC 2026-11-11): el checkpoint se recuerda por (hash, capas que lo confirmaron); cada capa durable
// recibe una vez la copia completa. Sintetico: sin red, sin datos de clientes.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
const a=src.indexOf('function ckptCapas(guardado, hash)'),b=src.indexOf('function ckptMarcar',a);
assert.ok(a>0&&b>a,'los ayudantes del checkpoint por capa deben existir');
const fin=src.indexOf('\n',src.indexOf('{',b)+1);
const ctx={};vm.createContext(ctx);vm.runInContext(src.slice(a,fin+1)+'\nthis.yaEn=ckptYaEnCapa;this.marcar=ckptMarcar;',ctx);
const H='sha256:abc';
test('un checkpoint confirmado por Supabase NO cuenta para Firebase',()=>{
  const g=ctx.marcar('',H,'supabase');
  assert.equal(ctx.yaEn(g,H,'supabase'),true);
  assert.equal(ctx.yaEn(g,H,'firebase'),false,'Firebase todavia debe recibir la copia completa');
});
test('al confirmar en Firebase quedan las dos capas y alternar capas no reescribe',()=>{
  let g=ctx.marcar('',H,'supabase'); g=ctx.marcar(g,H,'firebase');
  assert.equal(ctx.yaEn(g,H,'supabase'),true);assert.equal(ctx.yaEn(g,H,'firebase'),true);
});
test('un estado nuevo (otro hash) empieza sin capas confirmadas',()=>{
  const g=ctx.marcar('',H,'supabase');
  assert.equal(ctx.yaEn(g,'sha256:otro','supabase'),false);
  assert.equal(ctx.marcar(g,'sha256:otro','firebase'),'sha256:otro#firebase');
});
test('un valor guardado por una version anterior (sin # o con sufijo de v735) se reescribe una vez',()=>{
  assert.equal(ctx.yaEn(H,H,'firebase'),false);
  assert.equal(ctx.yaEn(H+'|f123_relay_cupo_fb_v1',H,'f123_relay_cupo_fb_v1'),false);
});
test('el acuse usa la capa del socket que confirmo y las condiciones de seguridad siguen intactas',()=>{
  assert.match(src,/_outbox\.checkpoint = ckptMarcar\(_outbox\.checkpoint, entry\.state, canal\.ws && canal\.ws\.relayLayer\)/);
  assert.match(src,/if \(canal\.recuperando \|\| \(_currentPullState && _currentPullState\.enCurso\)\) return;/);
  assert.match(src,/if \(doc\.store && \(doc\.store\.pendingStructs \|\| doc\.store\.pendingDs\)\) return;/);
});
test('hacerCkpt compara EN LINEA (sin depender de los ayudantes) hash y capa confirmada',()=>{
  assert.match(src,/partesCk\[0\] === state && partesCk\[1\] && partesCk\[1\]\.split\(","\)\.indexOf\(capaCk\) !== -1/);
  assert.doesNotMatch(src.slice(src.indexOf('var capaCk'),src.indexOf('var capaCk')+400),/ckptYaEnCapa\(/,'hacerCkpt no debe llamar a ayudantes externos: las pruebas p0-s3 lo ejecutan aislado');
});
test('el vecino mudo solo se suelta si queda otra capa durable usable',()=>{
  assert.match(src,/hayCapaDurableUsable\(\)/);
  assert.match(src,/sinProgresoPeer >= 3 && hayOtraCapa/);
});
