/* REGLA DURA de JFC (2026-09-24): "odio los modales de notificaciones de backup y
   cosas asi". Los avisos RUTINARIOS (recordatorio y confirmacion de respaldo,
   oferta de resumen semanal) solo se disparan cuando el usuario ENTRA a
   Advanced y su rol tiene clearance. Nunca al hacer login ni al abrir la app.
   Ver DECISIONES-JFC.md, seccion "Modales y avisos rutinarios". Si este test
   falla, NO lo relajes: alguien volvio a colgar un aviso rutinario del login. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const leer = (f) => fs.readFileSync(path.join(__dirname, '../docs', f), 'utf8');

test('routine notices never fire on login or app start', () => {
  const sched = leer('backup-scheduler.js');
  const html = leer('index.html');
  assert.doesNotMatch(sched, /addEventListener\("oc-login"[\s\S]{0,80}chequearAlArrancar/, 'respaldo: nada colgado del login');
  assert.doesNotMatch(html, /addEventListener\("oc-login"[^\n]*ofrecerResumenSemanalSiToca/, 'resumen semanal: nada colgado del login');
});

test('routine notices are offered from Advanced, owner/admin only, and only while Advanced is on screen', () => {
  const html = leer('index.html');
  const cuerpo = html.slice(html.indexOf('async function cargarAvanzado(){'), html.indexOf('async function cargarAvanzado(){') + 3000);
  assert.match(cuerpo, /avisosRutinariosDeAvanzado\(\)/, 'cargarAvanzado ofrece los avisos rutinarios');
  assert.match(html, /function avisosRutinariosDeAvanzado\(\)[\s\S]{0,600}"dueno"[\s\S]{0,80}"admin"/, 'solo dueno/admin');
  const sched = leer('backup-scheduler.js');
  assert.match(sched, /function mostrarRecordatorioRespaldo\(\) \{\s*if \(!enAvanzado\(\)\) return;/, 'recordatorio solo con Advanced en pantalla');
  assert.match(sched, /function mostrarAssurance\(\) \{\s*if \(!enAvanzado\(\)\) return;/, 'confirmacion solo con Advanced en pantalla');
});
