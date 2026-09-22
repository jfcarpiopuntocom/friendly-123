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
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const { browser: fixtureBrowser } = require('./helpers/browser.cjs');

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

test('a real business name is removed from static translation ownership', () => {
  // Un nombre real no debe quedar como una etiqueta traducible.
  const { span, eventos, i18n } = montar();
  eventos.get('oc-negocio-actualizado')({ detail: { nombre: 'Tienda fixture' } });
  assert.equal(span.hasAttribute('data-i18n'), false, 'con nombre real, i18n no es dueño');
  i18n.setLang('es');
  assert.equal(span.textContent, 'Tienda fixture');
});

test('real language buttons preserve a synchronized name and translate the location selector after redraw', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(__dirname, '../docs/index.html')).href,
      { waitUntil: 'networkidle' });
    const result = await page.evaluate(async () => {
      const name = 'Fixture synchronized business';
      const originalName = window.OCTienda.nombreActivo;
      const originalPrompt = window.prompt;
      window.OCTienda.nombreActivo = () => name;
      try {
        window.dispatchEvent(new CustomEvent('oc-negocio-actualizado', { detail: { nombre: name } }));
        document.querySelector('.oc-lang-btn[data-lang="es"]').click();
        await cargarUbicaciones();
        let renamePrompt = '';
        window.prompt = message => { renamePrompt = message; return null; };
        document.getElementById('oc-negocio-editar').click();
        const spanish = {
          header: document.getElementById('oc-negocio-nombre').textContent,
          all: document.querySelector('#selectUbicacion option[value="todas"]').textContent,
          lang: document.documentElement.lang,
          saved: localStorage.getItem('f123_lang'),
          renamePrompt
        };
        document.querySelector('.oc-lang-btn[data-lang="en"]').click();
        return { spanish, englishHeader: document.getElementById('oc-negocio-nombre').textContent };
      } finally {
        window.OCTienda.nombreActivo = originalName;
        window.prompt = originalPrompt;
      }
    });
    assert.equal(result.spanish.header, 'Fixture synchronized business');
    assert.equal(result.spanish.lang, 'es');
    assert.equal(result.spanish.saved, 'es');
    assert.equal(result.spanish.all, 'Todas las ubicaciones');
    assert.equal(result.spanish.renamePrompt, 'Nombre de tu negocio (mostrado arriba):');
    assert.equal(result.englishHeader, 'Fixture synchronized business');
  } finally {
    await browser.close();
  }
});

test('sync carries the business name while each device keeps its own language', async () => {
  const englishDevice = fixtureBrowser();
  const spanishDevice = fixtureBrowser();
  englishDevice.localStorage.setItem('f123_lang', 'en');
  spanishDevice.localStorage.setItem('f123_lang', 'es');

  await englishDevice.request('/api/instancia/nombre', 'POST', { nombre: 'Fixture shared name' });
  spanishDevice.receive(englishDevice);

  const instance = await spanishDevice.request('/api/instancia');
  assert.equal(instance.nombreNegocio, 'Fixture shared name');
  assert.equal(spanishDevice.localStorage.getItem('f123_lang'), 'es',
    'el idioma es una preferencia del aparato, no un dato que el sync reescribe');
});
