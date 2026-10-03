const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

async function openApp() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await page.goto(pathToFileURL(path.resolve(__dirname, '../docs/index.html')).href, { waitUntil: 'networkidle' });
  return { browser, page };
}

test('Shelves view excludes inactive/archived shelves and keeps active ones', async () => {
  const { browser, page } = await openApp();
  try {
    const out = await page.evaluate(async () => {
      const req = async (url, method = 'GET', body) => {
        const res = await fetch(url, {
          method,
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined
        });
        const data = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(data));
        return data;
      };
      const active = await req('/api/ubicaciones', 'POST', { nombre: 'CI ACTIVE SHELF' });
      const archived = await req('/api/ubicaciones', 'POST', { nombre: 'CI ARCHIVED SHELF' });
      await req('/api/ubicaciones/' + archived.id + '/desactivar', 'POST');
      await window.VPerchas.cargar();
      await new Promise(r => setTimeout(r, 60));
      const grid = document.getElementById('vp-grid');
      return {
        activeVisible: (grid.textContent || '').includes('CI ACTIVE SHELF'),
        archivedVisible: (grid.textContent || '').includes('CI ARCHIVED SHELF')
      };
    });
    assert.equal(out.activeVisible, true);
    assert.equal(out.archivedVisible, false);
  } finally {
    await browser.close();
  }
});

test('Shelf photo already stored by hash appears after the shelf hash arrives and refresh event fires', async () => {
  const { browser, page } = await openApp();
  try {
    const out = await page.evaluate(async () => {
      const req = async (url, method = 'GET', body) => {
        const res = await fetch(url, {
          method,
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined
        });
        const data = await res.json();
        if (!res.ok) throw new Error(JSON.stringify(data));
        return data;
      };
      const shelf = await req('/api/ubicaciones', 'POST', { nombre: 'CI PHOTO SHELF' });
      document.getElementById('vista-perchas').classList.add('activa');
      await window.VPerchas.cargar();
      const before = document.querySelector('.vp-carpeta[data-vp-abrir="' + shelf.id + '"] img');

      const dataUrl = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="black"/></svg>');
      const hash = 'ci-photo-hash-already-local';
      const stored = await window.OCFotos.guardarPorHash(hash, dataUrl);
      await req('/api/ubicaciones/' + shelf.id, 'PUT', { fotoHash: hash });

      window.dispatchEvent(new CustomEvent('oc-fotos-actualizadas'));
      await new Promise(r => setTimeout(r, 120));

      const card = document.querySelector('.vp-carpeta[data-vp-abrir="' + shelf.id + '"]');
      const img = card && card.querySelector('img');
      return { hadPhotoBefore: !!before, stored, src: img ? img.getAttribute('src') : null, expected: dataUrl };
    });
    assert.equal(out.hadPhotoBefore, false);
    assert.equal(out.stored, true);
    assert.equal(out.src, out.expected);
  } finally {
    await browser.close();
  }
});

test('sync-yjs repaints shelf UI after photo reconciliation even when blobs were already local', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../docs/sync-yjs.js'), 'utf8');
  const start = src.indexOf('function volcarFotosAlStore()');
  const end = src.indexOf('/* SEMBRAR FOTOS AL RELAY', start);
  assert.ok(start >= 0 && end > start, 'photo reconciliation function must exist');
  const block = src.slice(start, end);
  assert.match(block, /if \(pend\.length\)[\s\S]*oc-fotos-actualizadas/);
  const huboClose = block.indexOf('if (hubo)');
  const eventPos = block.indexOf('oc-fotos-actualizadas');
  assert.ok(eventPos > huboClose, 'refresh event must be outside the writes-only path');
});
