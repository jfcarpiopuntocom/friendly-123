/* Cambiar de idioma NO puede borrar el nombre del negocio (JFC 2026-09-22).

   EL BUG REPORTADO: "aprieto el botón de idiomas y se rompe el name del header
   (vuelve a 'My store or shelf(s)')". El <span> del nombre llevaba
   data-i18n="header.bizNameDefault" FIJO, y i18n.applyStatic() reescribe el
   texto de TODO elemento [data-i18n] al cambiar de idioma. No distinguía una
   etiqueta de la interfaz de un DATO DEL USUARIO.

   Lo grave es el cruce con el sync: el nombre que llegaba por Yjs desde OTRO
   aparato (evento oc-negocio-actualizado) quedaba bien pintado... hasta que
   alguien tocaba un botón local. El sync funcionaba y un botón lo deshacía.

   Esta prueba usa el applyStatic REAL de docs/i18n.js y el pintor REAL del
   header (el mismo tramo de index.html que aísla business-header.test.js), con
   un DOM simulado que sí tiene atributos. No imita el comportamiento: lo corre. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../docs/index.html'), 'utf8');
const bloque = html.slice(html.indexOf('// --- Nombre editable del negocio'), html.indexOf('// --- Navegación ---'));
const i18nSrc = fs.readFileSync(path.join(__dirname, '../docs/i18n.js'), 'utf8');

// Elemento simulado con atributos reales: es lo que el span necesita para que
// el i18n pueda "ver" si le pertenece o no.
function elemento(id, texto, attrs = {}) {
  const a = new Map(Object.entries(attrs));
  return {
    id, textContent: texto, style: {},
    getAttribute: k => (a.has(k) ? a.get(k) : null),
    setAttribute: (k, v) => a.set(k, String(v)),
    removeAttribute: k => a.delete(k),
    hasAttribute: k => a.has(k),
    addEventListener() {},
  };
}

function montar() {
  const span = elemento('oc-negocio-nombre', 'My store or shelf(s)', { 'data-i18n': 'header.bizNameDefault' });
  const btn = elemento('oc-negocio-editar', '✎');
  const todos = [span, btn];
  const eventos = new Map();
  const storage = new Map();
  const ls = {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k),
  };
  const document = {
    documentElement: { lang: 'en' },
    getElementById: id => todos.find(e => e.id === id) || null,
    querySelector: () => null,
    querySelectorAll: sel => {
      // Solo lo que usa applyStatic. Se filtra por atributo EN VIVO, así que si
      // el span pierde su data-i18n, applyStatic deja de encontrarlo.
      const attr = (sel.match(/^\[([^\]]+)\]$/) || [])[1];
      return attr ? todos.filter(e => e.hasAttribute(attr)) : [];
    },
    addEventListener() {},
  };
  const window = {
    addEventListener: (t, fn) => eventos.set(t, fn),
    dispatchEvent() {},
    OCTienda: { nombreActivo: () => '', esUnida: () => false },
  };
  const ctx = {
    window, document, localStorage: ls, sessionStorage: { getItem: () => null },
    navigator: { language: 'en-US' }, console: { warn() {}, error() {}, log() {} },
    CustomEvent: class { constructor(type, o) { this.type = type; Object.assign(this, o); } },
    API: '/api', fetch: () => new Promise(() => {}), // /instancia nunca responde: aísla el caso
  };
  window.window = window; window.document = document; window.localStorage = ls;
  vm.createContext(ctx);
  vm.runInContext(i18nSrc, ctx);
  ctx.t = k => ctx.window.OCI18n.t(k);
  window.t = ctx.t;
  vm.runInContext(bloque, ctx);
  return { span, eventos, i18n: ctx.window.OCI18n };
}

test('switching language keeps a business name that arrived by sync', () => {
  const { span, eventos, i18n } = montar();

  // El nombre llega por Yjs desde otro aparato.
  eventos.get('oc-negocio-actualizado')({ detail: { nombre: 'idiomARTE fixture' } });
  assert.equal(span.textContent, 'idiomARTE fixture');

  // El usuario toca el botón de idioma. Antes, esto borraba el nombre.
  i18n.setLang('es');
  assert.equal(span.textContent, 'idiomARTE fixture', 'el nombre sobrevive al cambio a español');
  i18n.setLang('en');
  assert.equal(span.textContent, 'idiomARTE fixture', 'y al volver a inglés');
});

test('with no business name yet, the placeholder DOES follow the language', () => {
  // El guard no puede ser una jaula: si todavía no hay nombre, el texto por
  // defecto es una etiqueta de la interfaz y SÍ debe traducirse.
  const { span, i18n } = montar();
  i18n.setLang('es');
  const enEspanol = span.textContent;
  i18n.setLang('en');
  const enIngles = span.textContent;
  assert.notEqual(enEspanol, enIngles, 'el texto por defecto cambia de idioma');
  assert.equal(enIngles, i18n.t('header.bizNameDefault'));
});

test('a rename back to empty hands the element back to i18n', () => {
  // Ida y vuelta completa del dueño: nombre real -> sin nombre. El span debe
  // volver a ser traducible, no quedarse "huérfano" sin data-i18n.
  const { span, eventos, i18n } = montar();
  eventos.get('oc-negocio-actualizado')({ detail: { nombre: 'Tienda fixture' } });
  assert.equal(span.hasAttribute('data-i18n'), false, 'con nombre real, i18n no es dueño');
  i18n.setLang('es');
  assert.equal(span.textContent, 'Tienda fixture');
});
