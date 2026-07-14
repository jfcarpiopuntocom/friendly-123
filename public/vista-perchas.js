// vista-perchas.js — Panel de perchas tipo CARPETA con semáforo de META.
// AMIGABLE (demo de Amigable: punto de venta y control de inventario)
// JFC 2026-07-02.
//
// MODELO CARPETA (pedido JFC 2026-07-02): cada percha es una CARPETA y su foto
// es la portada. Tocar la percha ABRE la carpeta y muestra las tarjetas de sus
// productos (los "archivos"); tocar un producto abre su ficha (conecta la info,
// se puede vender/editar ahí). El dueño puede RENOMBRAR la percha y cambiar su
// FOTO, igual que en las fotos de productos.
//
//   - FOTO REAL por percha: dueño toca 📷 → cámara → resize 640px → localStorage.
//   - semáforo por CUMPLIMIENTO DE META: verde ≥100% · amarillo 70-99% ·
//     rojo <70% · azul sin meta.
//   - badge inferior izquierdo: "% meta cumplida"; badge "dormida Xd" si aplica.
//   - fila de datos (Ventas/Meta/Comisión/Promotora/e): SOLO dueño.
//
// INTEGRACIÓN: el botón nav data-vista="perchas" y la sección #vista-perchas
// viven ESTÁTICOS en index.html. refrescarVistaActiva() llama VPerchas.cargar().

(function () {
  'use strict';

  const API = '/api';
  const $ = (id) => document.getElementById(id);
  const money = (n) => '$' + Number(n || 0).toFixed(2);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // Colores Simon exactos — mismos que .caja en index.html
  const SIMON = {
    verde:    { bg: '#1DB954', border: '#17a347', tx: '#ffffff', txs: '#e0ffe8' },
    amarillo: { bg: '#FFB300', border: '#E6A100', tx: '#1e1a12', txs: '#5d5340' },
    rojo:     { bg: '#E53935', border: '#C62828', tx: '#ffffff', txs: '#ffe0e0' },
    azul:     { bg: '#2196F3', border: '#1976D2', tx: '#ffffff', txs: '#daeeff' },
  };
  const ORDEN = { rojo: 0, amarillo: 1, verde: 2, azul: 3 };

  // Nombre de cada percha, cacheado del último cargar() para títulos de carpeta.
  let nombrePorId = {};

  // ── semáforo por cumplimiento de meta ──────────────────────────────────────
  function semaforoMeta(cumplimiento) {
    if (cumplimiento === null || cumplimiento === undefined) return 'azul';
    if (cumplimiento >= 100) return 'verde';
    if (cumplimiento >= 70)  return 'amarillo';
    return 'rojo';
  }

  // ── fotos en localStorage ──────────────────────────────────────────────────
  const FOTO_KEY = (id) => 'vp_foto_percha_' + id;
  const getFoto = (id) => { try { return localStorage.getItem(FOTO_KEY(id)); } catch { return null; } };

  function redimensionar(file, cb) {
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, 640 / img.width);
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * escala);
      cv.height = Math.round(img.height * escala);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(img.src);
      cb(cv.toDataURL('image/jpeg', 0.8));
    };
    img.src = URL.createObjectURL(file);
  }

  // ── tarjeta de percha (portada de la carpeta) ──────────────────────────────
  function _tarjeta(p) {
    const c = SIMON[p.semaforo];
    const esDueno = window.OCAuth && window.OCAuth.rolActual() === 'dueno';
    const foto = getFoto(p.id);

    const visual = foto
      ? `<img src="${foto}" alt="" style="width:100%;height:170px;object-fit:cover;display:block;">`
      : `<div style="width:100%;height:170px;display:flex;align-items:center;justify-content:center;
           background:${c.bg};color:${c.tx};font-family:var(--font-display);font-size:64px;font-weight:700;">
           ${esc((p.nombre || '?').trim().charAt(0).toUpperCase())}</div>`;

    const badgeMeta = p.cumplimiento === null ? 'sin meta' : p.cumplimiento.toFixed(0) + '% meta cumplida';

    const datos = esDueno ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;padding:12px 14px;background:var(--blanco-calido,#fbf5e8);">
        <div><span style="font-size:11px;font-family:var(--font-mono);color:var(--ink-soft);text-transform:uppercase;letter-spacing:.05em;display:block;">Ventas del mes</span>
          <strong style="font-size:16px;color:var(--ink);">${money(p.ventasMes)}</strong></div>
        <div><span style="font-size:11px;font-family:var(--font-mono);color:var(--ink-soft);text-transform:uppercase;letter-spacing:.05em;display:block;">Meta</span>
          <strong style="font-size:16px;color:var(--ink);">${p.meta ? money(p.meta) : '—'}</strong></div>
        <div><span style="font-size:11px;font-family:var(--font-mono);color:var(--ink-soft);text-transform:uppercase;letter-spacing:.05em;display:block;">Comisión</span>
          <strong style="font-size:16px;color:var(--ink);">${money(p.comision)}</strong></div>
        <div><span style="font-size:11px;font-family:var(--font-mono);color:var(--ink-soft);text-transform:uppercase;letter-spacing:.05em;display:block;">Promotora/e</span>
          <strong style="font-size:16px;color:var(--ink);">${p.promotor ? esc(p.promotor) : '—'}</strong></div>
      </div>` : '';

    // La tarjeta ENTERA abre la carpeta (data-vp-abrir). Los controles internos
    // (📷 foto, ✎ renombrar) llevan su propio data-* y frenan la propagación.
    return `
      <div class="tag-card vp-carpeta" data-vp-abrir="${esc(p.id)}" role="button" tabindex="0"
        title="Toca para ver sus productos"
        style="padding:0;overflow:hidden;border:3px solid ${c.border};border-radius:14px;cursor:pointer;">
        <div style="position:relative;">
          ${visual}
          <span style="position:absolute;top:10px;right:10px;width:18px;height:18px;border-radius:50%;
            background:${c.bg};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);"></span>
          <span style="position:absolute;bottom:10px;left:10px;font-family:var(--font-mono);font-size:13px;
            font-weight:700;background:rgba(0,0,0,.65);color:#fff;padding:4px 10px;border-radius:20px;">${badgeMeta}</span>
          ${(p.diasSinVenta != null && p.diasSinVenta >= 7) ? `<span style="position:absolute;top:10px;left:10px;font-family:var(--font-mono);font-size:12px;font-weight:700;background:#E53935;color:#fff;padding:3px 9px;border-radius:20px;">dormida ${p.diasSinVenta}d</span>` : ''}
          <!-- Abrir carpeta: pista visual -->
          <span style="position:absolute;bottom:10px;right:${esDueno ? '52px' : '10px'};font-family:var(--font-mono);font-size:12px;font-weight:700;background:#152840;color:#fff;padding:4px 9px;border-radius:20px;">Abrir ▸</span>
          ${esDueno ? `<button data-vp-foto="${esc(p.id)}" title="Cambiar foto" style="position:absolute;bottom:10px;right:10px;font-size:16px;line-height:1;
            background:rgba(0,0,0,.55);border:none;padding:6px 8px;border-radius:8px;color:#fff;cursor:pointer;">📷</button>` : ''}
        </div>
        <div style="padding:10px 14px ${esDueno ? '0' : '12px'};background:var(--blanco-calido,#fbf5e8);display:flex;align-items:center;gap:8px;">
          <strong style="font-family:var(--font-display);font-size:17px;color:var(--ink);flex:1;">${esc(p.nombre)}</strong>
          ${p.activa === false ? '<span style="font-size:11px;font-family:var(--font-mono);color:var(--rojo,#a3392a);">INACTIVA</span>' : ''}
          ${esDueno ? `<button data-vp-rename="${esc(p.id)}" title="Renombrar percha" style="font-size:15px;line-height:1;background:transparent;border:none;color:var(--azul-medio,#2c4a68);cursor:pointer;padding:2px 4px;">✎</button>` : ''}
        </div>
        ${datos}
      </div>`;
  }

  // ── carga y render del grid de portadas ────────────────────────────────────
  async function cargar() {
    const grid = $('vp-grid');
    if (!grid) return;
    grid.innerHTML = '<p style="font-size:14px;color:var(--ink-soft);font-family:var(--font-mono);padding:8px 0;">Cargando perchas…</p>';
    try {
      const [perchas, liq, promotoras] = await Promise.all([
        fetch(`${API}/ubicaciones?todas=1`).then((r) => r.json()),
        fetch(`${API}/liquidaciones`).then((r) => r.json()).catch(() => []),
        fetch(`${API}/promotoras`).then((r) => r.json()).catch(() => []),
      ]);
      if (!Array.isArray(perchas) || !perchas.length) {
        grid.innerHTML = '<p style="font-size:15px;color:var(--ink-soft);">No hay perchas. Créalas en Inventario → Perchas.</p>';
        return;
      }
      const liqPor = {}; (Array.isArray(liq) ? liq : []).forEach((f) => { liqPor[f.ubicacionId] = f; });
      const promPor = {}; (Array.isArray(promotoras) ? promotoras : []).forEach((pr) => { promPor[pr.id] = pr.nombre; });
      nombrePorId = {};

      const ms = perchas.map((u) => {
        const f = liqPor[u.id];
        const cumplimiento = f ? f.cumplimientoMeta : null;
        nombrePorId[u.id] = u.nombre;
        return {
          id: u.id, nombre: u.nombre, activa: u.activa !== false,
          semaforo: semaforoMeta(cumplimiento),
          cumplimiento: cumplimiento,
          ventasMes: f ? f.ventasBrutas : 0,
          meta: f ? f.metaMensual : (u.metaMensual || 0),
          comision: f ? f.comisionSocio : 0,
          promotor: u.promotoraId ? (promPor[u.promotoraId] || null) : null,
          diasSinVenta: f ? f.diasSinVenta : null,
        };
      });
      ms.sort((a, b) => (ORDEN[a.semaforo] ?? 5) - (ORDEN[b.semaforo] ?? 5));
      grid.innerHTML = ms.map(_tarjeta).join('');
    } catch (err) {
      console.error('[VPerchas]', err);
      grid.innerHTML = `<p style="color:var(--rojo,#a3392a);font-size:14px;">No se pudo cargar: ${esc(err.message)}</p>`;
    }
  }

  // ── CARPETA: modal con las tarjetas de producto de una percha ──────────────
  // Reutiliza abrirFichaDesdeInventario() (global de index.html) para que tocar
  // un producto abra su ficha (vender/editar/foto). Así se "conecta la info".
  const modal = document.createElement('div');
  modal.id = 'vp-carpeta-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9996;background:rgba(21,40,64,.85);display:none;align-items:flex-end;justify-content:center;padding:0;';
  modal.innerHTML = `<div id="vp-carpeta-sheet" style="background:var(--blanco-calido,#fbf5e8);width:100%;max-width:560px;max-height:84vh;overflow-y:auto;border-radius:16px 16px 0 0;padding:18px 16px 24px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <strong id="vp-carpeta-titulo" style="font-family:var(--font-display);font-size:20px;color:var(--ink);flex:1;"></strong>
        <button id="vp-carpeta-cerrar" style="font-size:14px;padding:8px 14px;border-radius:8px;border:2px solid var(--azul-medio,#2c4a68);background:var(--azul-medio,#2c4a68);color:#fbf5e8;cursor:pointer;">Cerrar</button>
      </div>
      <div id="vp-carpeta-body"></div>
    </div>`;

  function cerrarCarpeta() { modal.style.display = 'none'; }

  async function abrirCarpeta(perchaId) {
    const titulo = $('vp-carpeta-titulo');
    const body = $('vp-carpeta-body');
    titulo.textContent = nombrePorId[perchaId] || 'Percha';
    body.innerHTML = '<p style="font-size:14px;color:var(--ink-soft);font-family:var(--font-mono);">Cargando productos…</p>';
    modal.style.display = 'flex';
    try {
      const prods = await fetch(`${API}/productos?ubicacionId=${encodeURIComponent(perchaId)}`).then((r) => r.json());
      if (!Array.isArray(prods) || !prods.length) {
        body.innerHTML = '<p style="font-size:15px;color:var(--ink-soft);">Esta percha aún no tiene productos. Agrégalos en Inventario o Escanear.</p>';
        return;
      }
      body.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;">${
        prods.map((p) => {
          const c = SIMON[p.estado] || SIMON.azul;
          const estrella = p.estrella ? '★ ' : '';
          return `<button data-vp-prod="${esc(p.id)}" style="text-align:left;border:2px solid ${c.border};border-radius:10px;padding:0;overflow:hidden;background:var(--blanco-calido,#fbf5e8);cursor:pointer;">
            <div style="height:8px;background:${c.bg};"></div>
            <div style="padding:10px 12px;">
              <strong style="font-family:var(--font-display);font-size:15px;color:var(--ink);display:block;line-height:1.2;">${estrella}${esc(p.nombre)}</strong>
              <div style="font-size:13px;color:var(--ink-soft);margin-top:4px;">Stock: ${p.stockActual} · ${money(p.precio)}</div>
            </div>
          </button>`;
        }).join('')
      }</div>`;
    } catch (err) {
      body.innerHTML = `<p style="color:var(--rojo,#a3392a);font-size:14px;">No se pudo cargar: ${esc(err.message)}</p>`;
    }
  }

  // ── tap en la foto: cámara → resize → localStorage → re-render ────────────
  let perchaFotoPendiente = null;
  const inputFoto = document.createElement('input');
  inputFoto.type = 'file';
  inputFoto.accept = 'image/*';
  inputFoto.setAttribute('capture', 'environment');
  inputFoto.style.display = 'none';
  inputFoto.addEventListener('change', () => {
    const file = inputFoto.files && inputFoto.files[0];
    const id = perchaFotoPendiente;
    inputFoto.value = ''; perchaFotoPendiente = null;
    if (!file || !id) return;
    redimensionar(file, (dataUrl) => {
      try { localStorage.setItem(FOTO_KEY(id), dataUrl); } catch (e) {
        alert('No se pudo guardar la foto (espacio lleno). Borra alguna foto vieja.');
        return;
      }
      cargar();
    });
  });

  // ── un solo listener delegado para todo el panel ───────────────────────────
  document.addEventListener('click', async (e) => {
    // Cerrar carpeta (botón o fondo)
    if (e.target.id === 'vp-carpeta-cerrar' || e.target === modal) { cerrarCarpeta(); return; }
    // Abrir ficha de un producto desde la carpeta
    const prodBtn = e.target.closest('[data-vp-prod]');
    if (prodBtn) {
      cerrarCarpeta();
      if (window.abrirFichaDesdeInventario) window.abrirFichaDesdeInventario(prodBtn.dataset.vpProd);
      return;
    }
    // Cambiar foto (📷) — antes que abrir carpeta, y sin propagar
    const fotoBtn = e.target.closest('[data-vp-foto]');
    if (fotoBtn) { e.stopPropagation(); perchaFotoPendiente = fotoBtn.dataset.vpFoto; inputFoto.click(); return; }
    // Renombrar percha (✎)
    const renBtn = e.target.closest('[data-vp-rename]');
    if (renBtn) {
      e.stopPropagation();
      const id = renBtn.dataset.vpRename;
      const nuevo = (prompt('Nuevo nombre de la percha:', nombrePorId[id] || '') || '').trim();
      if (!nuevo) return;
      const res = await fetch(`${API}/ubicaciones/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: nuevo }) });
      if (res.ok) { cargar(); if (window.cargarUbicaciones) window.cargarUbicaciones(); }
      return;
    }
    // Abrir carpeta (tarjeta entera)
    const abrir = e.target.closest('[data-vp-abrir]');
    if (abrir) { abrirCarpeta(abrir.dataset.vpAbrir); }
  });

  // Accesibilidad: Enter/Espacio sobre una portada abre su carpeta.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const abrir = e.target.closest && e.target.closest('[data-vp-abrir]');
    if (abrir) { e.preventDefault(); abrirCarpeta(abrir.dataset.vpAbrir); }
  });

  function init() {
    document.body.appendChild(inputFoto);
    document.body.appendChild(modal);
  }
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : init();

  window.VPerchas = { cargar };
})();
