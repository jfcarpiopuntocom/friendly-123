'use strict';
// v735 (JFC 2026-11-11): el checkpoint se escribe UNA vez por capa durable activa, no solo cuando cambia el estado.
// Sintetico: sin red, sin datos de clientes.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../docs/sync-yjs.js'),'utf8');
test('la identidad del checkpoint incluye la capa durable activa',()=>{
  const i=src.indexOf('state = state + "|" + String((canal.ws && canal.ws.relayLayer)');
  assert.ok(i>0,'el sufijo de capa debe existir');
  const j=src.indexOf('if (state === _outbox.checkpoint',i);
  assert.ok(j>i&&j-i<200,'el sufijo se aplica antes de comparar con el checkpoint ya confirmado');
});
test('el acuse guarda la misma identidad con capa (entry.state)',()=>{
  assert.match(src,/_outbox\.checkpoint = entry\.state;/);
  assert.match(src,/guardarSobre\(Object\.assign\(\{ state: state \}, ckpt\)\)/);
});
test('las dos condiciones de seguridad del checkpoint siguen intactas',()=>{
  assert.match(src,/if \(canal\.recuperando \|\| \(_currentPullState && _currentPullState\.enCurso\)\) return;/);
  assert.match(src,/if \(doc\.store && \(doc\.store\.pendingStructs \|\| doc\.store\.pendingDs\)\) return;/);
});
