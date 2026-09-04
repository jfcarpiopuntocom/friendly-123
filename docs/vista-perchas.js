// COMPARTIDO: portado y mantenido identico entre apps hermanas a proposito.
// vista-perchas.js — Panel de perchas tipo CARPETA con semáforo de META.
// AMIGABLE (demo de Amigable: punto de venta y control de inventario)
// JFC 2026-07-02. Gestion completa (renombrar, borrar, agregar) 2026-07-08.
//
// MODELO CARPETA (pedido JFC 2026-07-02): cada percha es una CARPETA y su foto
// es la portada. Tocar la percha ABRE la carpeta y muestra las tarjetas de sus
// productos (los "archivos"); tocar un producto abre su ficha (conecta la info,
// se puede vender/editar ahí). El dueño puede RENOMBRAR, BORRAR y AGREGAR
// perchas desde el ícono ✎ (abre modal) y desde el botón "Agregar +" arriba.
//
//   - FOTO REAL por percha: dueño toca → cámara → resize 640px → localStorage.
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
  const money = (n) => {
    const v = Number(n || 0);
    try {
      const loc = (window.OCI18n && window.OCI18n.locale && window.OCI18n.locale()) || "en-US";
      return new Intl.NumberFormat(loc, { style: "currency", currency: "USD" }).format(v);
    } catch (_) { return "$" + v.toFixed(2); }
  };
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

  // Venta bruta del mes de una percha (2026-08-27, bloque 1d). Se usa para las
  // perchas PROPIAS, que no salen en /api/liquidaciones. Suma el monto de las
  // ventas del mes actual de esa ubicación. Se cachea por cargar() para no
  // repetir el fetch por cada percha.
  let _ventasTodasCache = null;
  async function ventasDelMes(ubicacionId) {
    try {
      if (_ventasTodasCache === null) {
        _ventasTodasCache = await fetch(`${API}/ventas/todas`).then((r) => r.json()).catch(() => []);
      }
      const ahora = new Date();
      const mes = ahora.getMonth(), anio = ahora.getFullYear();
      return (_ventasTodasCache || [])
        .filter((v) => v.ubicacionId === ubicacionId && (() => { const d = new Date(v.fecha); return d.getMonth() === mes && d.getFullYear() === anio; })())
        .reduce((a, v) => a + (Number(v.monto) || (Number(v.precioUnit) || 0) * (Number(v.cantidad) || 0)), 0);
    } catch (_) { return 0; }
  }

  // Ordenar por columna (2026-07-29) — complementa el semaforo por defecto.
  const COLUMNAS_PERCHA = [
    { key: 'nombre', label: 'Name' },
    { key: 'ventasMes', label: 'Monthly sales' },
    { key: 'cumplimiento', label: 'Target %' },
  ];
  let _ordenPercha = { col: null, asc: true };
  function pintarBotonesOrdenPercha() {
    const cont = document.getElementById('vp-orden');
    if (!cont) return;
    if (!cont.dataset.listo) {
      cont.dataset.listo = '1';
      COLUMNAS_PERCHA.forEach((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.ordPerchaCol = c.key;
        b.style.cssText = 'font-size:13px;padding:4px 10px;border-radius:6px;border:1.5px solid var(--azul-medio,#2c4a68);background:transparent;color:var(--azul-medio,#2c4a68) !important;-webkit-text-fill-color:var(--azul-medio,#2c4a68) !important;cursor:pointer;';
        cont.appendChild(b);
      });
      cont.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ord-percha-col]');
        if (!b) return;
        const key = b.dataset.ordPerchaCol;
        if (_ordenPercha.col === key) _ordenPercha.asc = !_ordenPercha.asc;
        else { _ordenPercha.col = key; _ordenPercha.asc = true; }
        cargar();
      });
    }
    cont.querySelectorAll('[data-ord-percha-col]').forEach((b) => {
      const c = COLUMNAS_PERCHA.find((x) => x.key === b.dataset.ordPerchaCol);
      const activo = _ordenPercha.col === b.dataset.ordPerchaCol;
      b.style.background = activo ? 'var(--azul-medio,#2c4a68)' : 'transparent';
      b.style.color = activo ? '#fbf5e8' : 'var(--azul-medio,#2c4a68)';
      b.style.setProperty('-webkit-text-fill-color', activo ? '#fbf5e8' : 'var(--azul-medio,#2c4a68)');
      b.textContent = c.label + (activo ? (_ordenPercha.asc ? ' ↑' : ' ↓') : '');
    });
  }

  // Percha activa en el modal de gestión (editar/borrar).
  let perchaGestionId = null;

  // ── semáforo por cumplimiento de meta ──────────────────────────────────────
  function semaforoMeta(cumplimiento) {
    if (cumplimiento === null || cumplimiento === undefined) return 'azul';
    if (cumplimiento >= 100) return 'verde';
    if (cumplimiento >= 70)  return 'amarillo';
    return 'rojo';
  }

  // ── fotos en IndexedDB (JFC 2026-07-18) ────────────────────────────────────
  // Antes vivian en localStorage (limite practico ~5-10MB; con 10-15 perchas
  // con foto ya reventaba — "espacio lleno"). Ahora persisten en IndexedDB
  // (ver idb-fotos.js), sin ese techo. getFoto() sigue siendo SINCRONO: lee de
  // un cache en memoria precargado por precargarFotos() antes de pintar el
  // grid, asi _tarjeta() no cambia de forma.
  let fotoCache = {};
  const getFoto = (id) => fotoCache[id] || null;
  async function precargarFotos() {
    if (!window.OCFotos) return; // idb-fotos.js no cargo: sin fotos, sin crash
    await window.OCFotos.migrarSiHaceFalta(); // no-op rapido tras la 1a vez
    fotoCache = await window.OCFotos.leerTodas();
  }

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
    // JFC 2026-08-25: el admin ve TODO lo financiero igual que el dueno. La
    // unica diferencia dueno/admin es gestionar admins (agregar/quitar/degradar),
    // que se controla aparte en Avanzado. Aqui, datos financieros de la percha
    // y gestion visible = dueno O admin (puedeGestionar()).
    const esDueno = !!(window.OCAuth && window.OCAuth.puedeGestionar && window.OCAuth.puedeGestionar());
    const foto = getFoto(p.id);

    const visual = foto
      ? `<img src="${foto}" alt="" style="width:100%;height:170px;object-fit:cover;display:block;">`
      : `<div style="width:100%;height:170px;display:flex;align-items:center;justify-content:center;
           background:${c.bg};color:${c.tx};font-family:var(--font-display);font-size:64px;font-weight:700;">
           ${esc((p.nombre || '?').trim().charAt(0).toUpperCase())}</div>`;

    const badgeMeta = p.cumplimiento === null ? window.t('shelves.noTarget') : p.cumplimiento.toFixed(0) + window.t('shelves.ofTargetMet');

    const datos = esDueno ? `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;padding:12px 14px;background:var(--blanco-calido,#fbf5e8);">
        <div><span style="font-size:13px;font-family:var(--font-mono);color:var(--ink-soft);text-transform:uppercase;letter-spacing:.05em;display:block;">${window.t('shelves.monthlySales')}</span>
          <strong style="font-size:16px;color:var(--ink);">${money(p.ventasMes)}</strong></div>
        <div><span style="font-size:13px;font-family:var(--font-mono);color:var(--ink-soft);text-transform:uppercase;letter-spacing:.05em;display:block;">${window.t('shelves.target')}</span>
          <strong style="font-size:16px;color:var(--ink);">${p.meta ? money(p.meta) : '—'}</strong></div>
        <div><span style="font-size:13px;font-family:var(--font-mono);color:var(--ink-soft);text-transform:uppercase;letter-spacing:.05em;display:block;">${window.t('shelves.commission')}</span>
          <strong style="font-size:16px;color:var(--ink);">${money(p.comision)}</strong></div>
        <div><span style="font-size:13px;font-family:var(--font-mono);color:var(--ink-soft);text-transform:uppercase;letter-spacing:.05em;display:block;">${window.t('shelves.promoter')}</span>
          <strong style="font-size:16px;color:var(--ink);">${p.promotor ? esc(p.promotor) : '—'}</strong></div>
      </div>` : '';

    // La tarjeta ENTERA abre la carpeta (data-vp-abrir). Los controles internos
    // (foto, ✎ gestión) llevan su propio data-* y frenan la propagación.
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
          ${(p.diasSinVenta != null && p.diasSinVenta >= 7) ? `<span style="position:absolute;top:10px;left:10px;font-family:var(--font-mono);font-size:13px;font-weight:700;background:#E53935;color:#fff;padding:3px 9px;border-radius:20px;">dormida ${p.diasSinVenta}d</span>` : ''}
          <!-- Abrir carpeta: pista visual -->
          <span style="position:absolute;bottom:10px;right:${esDueno ? '52px' : '10px'};font-family:var(--font-mono);font-size:13px;font-weight:700;background:#152840;color:#fff;padding:4px 9px;border-radius:20px;">${window.t('shelves.open')} ▸</span>
          ${esDueno ? `<button data-vp-foto="${esc(p.id)}" title="Cambiar foto" style="position:absolute;bottom:10px;right:10px;font-size:16px;line-height:1;
            background:rgba(0,0,0,.55);border:none;padding:6px 8px;border-radius:8px;color:#fff;cursor:pointer;">📷</button>` : ''}
        </div>
        <div style="padding:10px 14px ${esDueno ? '0' : '12px'};background:var(--blanco-calido,#fbf5e8);display:flex;align-items:center;gap:8px;">
          <strong style="font-family:var(--font-display);font-size:17px;color:var(--ink);flex:1;">${esc(p.nombre)}</strong>
          ${p.activa === false ? '<span style="font-size:13px;font-family:var(--font-mono);color:var(--rojo,#a3392a);">INACTIVA</span>' : ''}
          ${esDueno ? `<button data-vp-rename="${esc(p.id)}" title="Editar o borrar esta percha" style="font-size:15px;line-height:1;background:transparent;border:none;color:var(--azul-medio,#2c4a68);cursor:pointer;padding:2px 4px;">✎</button>` : ''}
        </div>
        ${datos}
      </div>`;
  }

  // ── carga y render del grid de portadas ────────────────────────────────────
  // Inyecta el botón general "Agregar +" al inicio de la sección Mis perchas.
  // Se llama desde cargar() (post-login), es idempotente.
  // JFC 2026-08-25: el admin TAMBIEN puede agregar perchas (igual que ya podia
  // en Inventario → seccionPerchas, que usa puedeGestionar). Antes este boton
  // era solo-dueno y el admin quedaba capado en la vista de fotos. Crear percha
  // es gestion de catalogo, no reparto de plata (eso sigue solo-dueno).
  function inyectarBotonAgregar() {
    const puede = !!(window.OCAuth && window.OCAuth.puedeGestionar && window.OCAuth.puedeGestionar());
    const seccion = document.getElementById('vista-perchas');
    const grid = document.getElementById('vp-grid');
    const existente = document.getElementById('vp-btn-agregar');
    if (!puede) { if (existente) existente.remove(); return; } // staff/demo: sin botón
    if (existente || !seccion || !grid) return;
    const btnAgregar = document.createElement('button');
    btnAgregar.id = 'vp-btn-agregar';
    btnAgregar.textContent = window.t('shelves.addRackBtn');
    btnAgregar.style.cssText = 'display:inline-block;margin:0 0 16px;padding:10px 18px;' +
      'border:2px solid var(--azul-medio,#2c4a68);border-radius:8px;background:var(--azul-medio,#2c4a68);' +
      'color:#fbf5e8 !important;-webkit-text-fill-color:#fbf5e8 !important;' +
      'font-size:15px;font-weight:700;cursor:pointer;';
    btnAgregar.addEventListener('click', abrirAgregar);
    seccion.insertBefore(btnAgregar, grid);
  }

  // Re-pinta los textos fijos que se construyen UNA sola vez al cargar el
  // script (botón "Agregar +", modal "carpeta" y modal "Nueva percha") —
  // esos innerHTML no se regeneran solos al cambiar de idioma.
  window.addEventListener('oc-lang-change', () => {
    const b = document.getElementById('vp-btn-agregar');
    if (b) b.textContent = window.t('shelves.addRackBtn');
    const carpetaCerrar = document.getElementById('vp-carpeta-cerrar');
    if (carpetaCerrar) carpetaCerrar.textContent = window.t('common.close');
    const aCerrar = document.getElementById('vp-a-cerrar');
    if (aCerrar) aCerrar.textContent = window.t('common.close');
    const aTitulo = modalAgregar.querySelector('strong');
    if (aTitulo) aTitulo.textContent = window.t('shelves.newRackTitle');
    const aLabel = modalAgregar.querySelector('label');
    if (aLabel) aLabel.firstChild.textContent = window.t('shelves.rackNameLabel') + '\n        ';
    const aInput = document.getElementById('vp-a-nombre');
    if (aInput) aInput.placeholder = window.t('shelves.rackNamePlaceholder');
    const aHint = modalAgregar.querySelector('p');
    if (aHint) aHint.textContent = window.t('shelves.assignHint');
    const aCrear = document.getElementById('vp-a-crear');
    if (aCrear) aCrear.textContent = window.t('shelves.createRackBtn');
  });

  async function cargar() {
    inyectarBotonAgregar(); // el botón general vive fuera del grid, no se borra al re-render
    const grid = $('vp-grid');
    if (!grid) return;
    grid.innerHTML = '<p style="font-size:14px;color:var(--ink-soft);font-family:var(--font-mono);padding:8px 0;">Cargando perchas…</p>';
    try {
      await precargarFotos();
      const [perchas, liq, promotoras] = await Promise.all([
        fetch(`${API}/ubicaciones?todas=1`).then((r) => r.json()),
        fetch(`${API}/liquidaciones`).then((r) => r.json()).catch(() => []),
        fetch(`${API}/promotoras`).then((r) => r.json()).catch(() => []),
      ]);
      if (!Array.isArray(perchas) || !perchas.length) {
        grid.innerHTML = `<p style="font-size:15px;color:var(--ink-soft);">${esc(window.t('shelves.noRacksYet'))}</p>`;
        return;
      }
      const liqPor = {}; (Array.isArray(liq) ? liq : []).forEach((f) => { liqPor[f.ubicacionId] = f; });
      const promPor = {}; (Array.isArray(promotoras) ? promotoras : []).forEach((pr) => { promPor[pr.id] = pr.nombre; });
      nombrePorId = {};

      const ms = await Promise.all(perchas.map(async (u) => {
        const f = liqPor[u.id];
        const cumplimiento = f ? f.cumplimientoMeta : null;
        nombrePorId[u.id] = u.nombre;
        /* 2026-08-27 (bloque 1d): las perchas PROPIAS (tipo "propio") no salen
           en /api/liquidaciones (que solo cubre las de comisión), así que su
           tarjeta mostraba ventasMes=0 y comisión=0 aunque vendieran. Se
           calcula aquí su venta del mes para que la tarjeta refleje el valor
           real. La comisión de una percha propia es 0 (no reparte con nadie). */
        let ventasMes = f ? f.ventasBrutas : 0;
        let comision = f ? f.comisionSocio : 0;
        if (!f && u.tipo === "propio") {
          ventasMes = await ventasDelMes(u.id);
        }
        return {
          id: u.id, nombre: u.nombre, activa: u.activa !== false,
          semaforo: semaforoMeta(cumplimiento),
          cumplimiento: cumplimiento,
          ventasMes: ventasMes,
          meta: f ? f.metaMensual : (u.metaMensual || 0),
          comision: comision,
          promotor: u.promotoraId ? (promPor[u.promotoraId] || null) : null,
          diasSinVenta: f ? f.diasSinVenta : null,
        };
      }));
      // Orden por defecto: semaforo de meta (rojo primero). Si el usuario
      // eligio otra columna ("Ordenar por"), esa manda en su lugar.
      if (_ordenPercha.col) {
        const col = _ordenPercha.col;
        ms.sort((a, b) => {
          const va = a[col], vb = b[col];
          let r;
          if (typeof va === 'number' && typeof vb === 'number') r = (va || 0) - (vb || 0);
          else r = String(va == null ? '' : va).localeCompare(String(vb == null ? '' : vb), 'en', { sensitivity: 'base', numeric: true });
          return _ordenPercha.asc ? r : -r;
        });
      } else {
        ms.sort((a, b) => (ORDEN[a.semaforo] ?? 5) - (ORDEN[b.semaforo] ?? 5));
      }
      pintarBotonesOrdenPercha();
      grid.innerHTML = ms.map(_tarjeta).join('');
      renderTransferencias(); // transfers entre perchas (movido de Advanced)
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
        <button id="vp-carpeta-cerrar" style="font-size:14px;padding:8px 14px;border-radius:8px;border:2px solid var(--azul-medio,#2c4a68);background:var(--azul-medio,#2c4a68);color:#fbf5e8;cursor:pointer;">${window.t('common.close')}</button>
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
      // Panorama de la percha (reparto + histórico) — friendly ya tiene el
      // endpoint; faltaba mostrarlo como en AMIGABLE (JFC/Belén 2026-09-04:
      // "que se parezca a Perchas de amigable, open view"). Se pide en paralelo;
      // si falla, la carpeta sigue mostrando los productos igual.
      const [prods, pano] = await Promise.all([
        fetch(`${API}/productos?ubicacionId=${encodeURIComponent(perchaId)}`).then((r) => r.json()),
        fetch(`${API}/ubicaciones/${encodeURIComponent(perchaId)}/panorama`).then((r) => r.json()).catch(() => null),
      ]);
      let repartoHtml = '';
      try {
        const T = (k, f) => (window.t ? window.t(k, f) : f);
        if (pano && pano.comision) {
          const cm = pano.comision, aso = pano.asociado, h = pano.historico || {};
          const pctA = cm.pct != null ? cm.pct : 0;
          const hist = (h.transacciones ? `${money(h.venta)} · ${window.tf ? window.tf('shelves.split.inN', { n: h.transacciones }) : h.transacciones + ' sale(s)'}` : T('shelves.split.noHistory', 'No sales yet')) +
            (h.diasSinVender != null ? ` · ${window.tf ? window.tf('shelves.split.lastSaleD', { d: h.diasSinVender }) : 'last sale ' + h.diasSinVender + 'd ago'}` : '');
          repartoHtml = `
            <div class="tag-card" style="text-align:left;padding:14px 16px;margin-bottom:14px;border:2px solid var(--sim-verde,#00C87A);">
              <strong style="font-size:15px;color:var(--ink);">${T('shelves.split.title', 'Split of this shelf')}${aso ? ' — ' + esc(aso.nombre) : ''}</strong>
              <div style="font-size:14px;color:var(--ink);margin-top:8px;">${T('shelves.split.associateTakes', 'Associate takes')}: <strong>${money(cm.seLlevaElAsociado)}</strong> <span style="color:var(--ink-soft);">(${pctA}%)</span></div>
              <div style="font-size:14px;color:var(--ink);margin-top:2px;">${T('shelves.split.houseKeeps', 'House keeps')}: <strong>${money(cm.quedaEnCasa)}</strong></div>
              <div style="font-size:13px;color:var(--ink-soft);margin-top:6px;">${T('shelves.split.history', 'History')}: ${hist}</div>
              <button data-vp-compradores="${esc(perchaId)}" style="margin-top:10px;font-size:14px;padding:8px 14px;border:2px solid var(--azul-medio,#2c4a68);border-radius:6px;background:transparent;color:var(--azul-medio,#2c4a68);cursor:pointer;">${T('shelves.split.viewBuyers', 'View buyers of this shelf')}</button>
            </div>`;
        }
      } catch (_) {}
      if (!Array.isArray(prods) || !prods.length) {
        body.innerHTML = repartoHtml + `<p style="font-size:15px;color:var(--ink-soft);">${esc(window.t('shelves.noProductsYet'))}</p>`;
        _cablearCompradores(body);
        return;
      }
      body.innerHTML = repartoHtml + `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;">${
        prods.map((p) => {
          const c = SIMON[p.estado] || SIMON.azul;
          const estrella = p.estrella ? '★ ' : '';
          const puedeEd = !!(window.OCAuth && window.OCAuth.puedeGestionar && window.OCAuth.puedeGestionar());
          return `<button data-vp-prod="${esc(p.id)}" style="text-align:left;border:2px solid ${c.border};border-radius:10px;padding:0;overflow:hidden;background:var(--blanco-calido,#fbf5e8);cursor:pointer;">
            <div style="height:8px;background:${c.bg};"></div>
            <div style="padding:10px 12px;">
              <strong style="font-family:var(--font-display);font-size:15px;color:var(--ink);display:block;line-height:1.2;">${estrella}${esc(p.nombre)}</strong>
              <div style="font-size:13px;color:var(--ink-soft);margin-top:4px;">Stock: ${p.stockActual} · ${money(p.precio)}</div>
              ${puedeEd ? `<span data-vp-edit="${esc(p.id)}" style="display:inline-block;margin-top:8px;padding:4px 12px;border:2px solid var(--azul-medio,#2E6278);border-radius:5px;font-size:13px;font-weight:700;color:var(--azul-medio,#2E6278);">Edit</span>` : ""}
            </div>
          </button>`;
        }).join('')
      }</div>`;
      _cablearCompradores(body);
    } catch (err) {
      body.innerHTML = `<p style="color:var(--rojo,#a3392a);font-size:14px;">No se pudo cargar: ${esc(err.message)}</p>`;
    }
  }

  // "Ver compradores de esta percha": lista los clientes que compraron aquí este
  // mes (reusa /api/compradores, que friendly ya tiene). Se muestra inline en la
  // carpeta; respeta REGLA 7 (soporte/lord no ve datos personales — el backend ya
  // los omite para ese rol). Aditivo, no toca nada más.
  function _cablearCompradores(body) {
    if (!body) return;
    body.querySelectorAll('[data-vp-compradores]').forEach((btn) => {
      if (btn._listo) return; btn._listo = true;
      btn.addEventListener('click', async () => {
        const T = (k, f) => (window.t ? window.t(k, f) : f);
        const pid = btn.getAttribute('data-vp-compradores');
        btn.disabled = true;
        let lista = [];
        try { lista = await fetch(`${API}/compradores?ubicacionId=${encodeURIComponent(pid)}`).then((r) => r.json()); } catch (_) { lista = []; }
        let cont = body.querySelector('#vp-compradores-lista');
        if (!cont) { cont = document.createElement('div'); cont.id = 'vp-compradores-lista'; cont.style.cssText = 'margin:0 0 14px;'; btn.parentElement.appendChild(cont); }
        cont.innerHTML = (Array.isArray(lista) && lista.length)
          ? `<div style="font-size:13px;color:var(--ink-soft);margin-top:8px;">${lista.map((c) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid #eef0ec;"><span>${esc(c.nombre || '')}</span><span>${money(c.monto)} · ${c.unidades || 0}u</span></div>`).join('')}</div>`
          : `<p style="font-size:13px;color:var(--ink-soft);margin-top:8px;">${T('shelves.split.noBuyers', 'No buyers recorded for this shelf yet.')}</p>`;
        btn.disabled = false;
      });
    });
  }

  // ── MODAL GESTIÓN: renombrar o borrar la percha (✎) ───────────────────────
  // Reemplaza el prompt() simple. Bottom-sheet de 2 acciones: Renombrar y Borrar.
  // Borrar pide confirmación de texto para evitar toques accidentales.
  const modalGestion = document.createElement('div');
  modalGestion.id = 'vp-gestion-modal';
  modalGestion.style.cssText = 'position:fixed;inset:0;z-index:9997;background:rgba(21,40,64,.85);display:none;align-items:flex-end;justify-content:center;padding:0;';
  modalGestion.innerHTML = `
    <div style="background:var(--blanco-calido,#fbf5e8);width:100%;max-width:560px;border-radius:16px 16px 0 0;padding:20px 18px 28px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
        <strong id="vp-g-titulo" style="font-family:var(--font-display);font-size:18px;color:var(--ink);flex:1;"></strong>
        <button id="vp-g-cerrar" style="font-size:14px;padding:6px 12px;border-radius:8px;border:2px solid var(--azul-medio,#2c4a68);background:var(--azul-medio,#2c4a68);color:#fbf5e8;cursor:pointer;">Cerrar</button>
      </div>
      <!-- Renombrar -->
      <label style="display:block;font-size:14px;font-weight:700;color:var(--ink);margin-bottom:6px;">Nuevo nombre
        <input id="vp-g-nombre" type="text" maxlength="60"
          style="display:block;width:100%;margin-top:4px;padding:9px 10px;border:2px solid var(--azul-medio,#2c4a68);
                 border-radius:7px;font-size:15px;box-sizing:border-box;background:#fff;">
      </label>
      <button id="vp-g-renombrar" style="padding:10px 18px;border:2px solid var(--azul-medio,#2c4a68);border-radius:8px;
        background:var(--azul-medio,#2c4a68);color:#fbf5e8;font-size:14px;font-weight:700;cursor:pointer;width:100%;margin-bottom:20px;">
        Guardar nombre
      </button>
      <!-- Borrar -->
      <details id="vp-g-borrar-wrap" style="border:2px solid var(--rojo,#a3392a);border-radius:8px;padding:10px 14px;">
        <summary style="cursor:pointer;font-size:14px;font-weight:700;color:var(--rojo,#a3392a);">Borrar esta percha</summary>
        <p style="font-size:13px;color:var(--ink-soft);margin:8px 0 4px;">
          Esto elimina la percha permanentemente. Los productos no se borran — quedan sin percha asignada.
        </p>
        <p style="font-size:13px;color:var(--ink-soft);margin:0 0 8px;">
          Escribe <strong id="vp-g-nombre-confirm" style="color:var(--ink);"></strong> para confirmar:
        </p>
        <input id="vp-g-confirm" type="text" placeholder="Escribe el nombre exacto"
          style="display:block;width:100%;padding:8px 10px;border:2px solid var(--rojo,#a3392a);border-radius:6px;
                 font-size:14px;box-sizing:border-box;margin-bottom:8px;background:#fff;">
        <button id="vp-g-borrar" style="padding:9px 16px;border:2px solid var(--rojo,#a3392a);border-radius:7px;
          background:var(--rojo,#a3392a);color:#fff;font-size:14px;font-weight:700;cursor:pointer;width:100%;">
          Confirmar borrado
        </button>
        <p id="vp-g-msg" style="font-size:13px;margin:6px 0 0;font-weight:700;"></p>
      </details>
    </div>`;

  function cerrarGestion() {
    modalGestion.style.display = 'none';
    perchaGestionId = null;
    const dets = document.getElementById('vp-g-borrar-wrap');
    if (dets) dets.removeAttribute('open');
    const conf = document.getElementById('vp-g-confirm');
    if (conf) conf.value = '';
    const msg = document.getElementById('vp-g-msg');
    if (msg) msg.textContent = '';
  }

  function abrirGestion(perchaId) {
    perchaGestionId = perchaId;
    const nombre = nombrePorId[perchaId] || '';
    const tit = document.getElementById('vp-g-titulo');
    const input = document.getElementById('vp-g-nombre');
    const nameConfirm = document.getElementById('vp-g-nombre-confirm');
    if (tit) tit.textContent = 'Editar: ' + nombre;
    if (input) { input.value = nombre; }
    if (nameConfirm) nameConfirm.textContent = nombre;
    modalGestion.style.display = 'flex';
    setTimeout(() => { if (input) input.focus(); }, 80);
  }

  // ── MODAL AGREGAR: nueva percha ────────────────────────────────────────────
  const modalAgregar = document.createElement('div');
  modalAgregar.id = 'vp-agregar-modal';
  modalAgregar.style.cssText = 'position:fixed;inset:0;z-index:9997;background:rgba(21,40,64,.85);display:none;align-items:flex-end;justify-content:center;padding:0;';
  modalAgregar.innerHTML = `
    <div style="background:var(--blanco-calido,#fbf5e8);width:100%;max-width:560px;border-radius:16px 16px 0 0;padding:20px 18px 28px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
        <strong style="font-family:var(--font-display);font-size:18px;color:var(--ink);flex:1;">${window.t('shelves.newRackTitle')}</strong>
        <button id="vp-a-cerrar" style="font-size:14px;padding:6px 12px;border-radius:8px;border:2px solid var(--azul-medio,#2c4a68);background:var(--azul-medio,#2c4a68);color:#fbf5e8;cursor:pointer;">${window.t('common.close')}</button>
      </div>
      <label style="display:block;font-size:14px;font-weight:700;color:var(--ink);margin-bottom:6px;">${window.t('shelves.rackNameLabel')}
        <input id="vp-a-nombre" type="text" maxlength="60" placeholder="${esc(window.t('shelves.rackNamePlaceholder'))}"
          style="display:block;width:100%;margin-top:4px;padding:9px 10px;border:2px solid var(--azul-medio,#2c4a68);
                 border-radius:7px;font-size:15px;box-sizing:border-box;background:#fff;">
      </label>
      <p style="font-size:13px;color:var(--ink-soft);margin:4px 0 14px;">
        ${window.t('shelves.assignHint')}
      </p>
      <button id="vp-a-crear" style="padding:10px 18px;border:2px solid var(--azul-medio,#2c4a68);border-radius:8px;
        background:var(--azul-medio,#2c4a68);color:#fbf5e8;font-size:14px;font-weight:700;cursor:pointer;width:100%;">
        ${window.t('shelves.createRackBtn')}
      </button>
      <p id="vp-a-msg" style="font-size:13px;margin:8px 0 0;font-weight:700;"></p>
    </div>`;

  function cerrarAgregar() {
    modalAgregar.style.display = 'none';
    const inp = document.getElementById('vp-a-nombre');
    if (inp) inp.value = '';
    const msg = document.getElementById('vp-a-msg');
    if (msg) msg.textContent = '';
  }

  function abrirAgregar() {
    modalAgregar.style.display = 'flex';
    setTimeout(() => {
      const inp = document.getElementById('vp-a-nombre');
      if (inp) inp.focus();
    }, 80);
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
    redimensionar(file, async (dataUrl) => {
      const ok = window.OCFotos ? await window.OCFotos.guardarFoto(id, dataUrl) : false;
      if (!ok) {
        alert('No se pudo guardar la foto (espacio lleno). Borra alguna foto vieja.');
        return;
      }
      fotoCache[id] = dataUrl; // optimista: se ve de inmediato, sin esperar otra lectura
      cargar();
    });
  });

  // ── un solo listener delegado para todo el panel ───────────────────────────
  document.addEventListener('click', async (e) => {
    // Cerrar carpeta (botón o fondo)
    if (e.target.id === 'vp-carpeta-cerrar' || e.target === modal) { cerrarCarpeta(); return; }
    // Cerrar gestión
    if (e.target.id === 'vp-g-cerrar' || e.target === modalGestion) { cerrarGestion(); return; }
    // Cerrar agregar
    if (e.target.id === 'vp-a-cerrar' || e.target === modalAgregar) { cerrarAgregar(); return; }

    // Edicion directa (homologado de AMIGABLE, 2026-07-22) — atendida ANTES
    // que abrir-ficha porque el chip vive dentro del mismo card clicable.
    const editBtn = e.target.closest('[data-vp-edit]');
    if (editBtn) {
      e.stopPropagation();
      cerrarCarpeta();
      if (window.abrirEdicionDesdeInventario) window.abrirEdicionDesdeInventario(editBtn.dataset.vpEdit);
      return;
    }
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
    // ✎ Gestión (renombrar / borrar) — abre modal de gestión
    const renBtn = e.target.closest('[data-vp-rename]');
    if (renBtn) {
      e.stopPropagation();
      abrirGestion(renBtn.dataset.vpRename);
      return;
    }
    // Guardar renombre
    if (e.target.id === 'vp-g-renombrar') {
      const nuevo = (document.getElementById('vp-g-nombre').value || '').trim();
      if (!nuevo) { alert('Escribe un nombre.'); return; }
      const res = await fetch(`${API}/ubicaciones/${perchaGestionId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: nuevo }),
      });
      if (res.ok) {
        cerrarGestion(); cargar();
        if (window.cargarUbicaciones) window.cargarUbicaciones();
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'No se pudo renombrar.');
      }
      return;
    }
    // Confirmar borrado
    if (e.target.id === 'vp-g-borrar') {
      const nombreEsperado = nombrePorId[perchaGestionId] || '';
      const confirmado = (document.getElementById('vp-g-confirm').value || '').trim();
      const msg = document.getElementById('vp-g-msg');
      if (confirmado !== nombreEsperado) {
        msg.style.color = 'var(--rojo,#a3392a)';
        msg.textContent = 'El nombre no coincide. Escribe exactamente: ' + nombreEsperado;
        return;
      }
      const res = await fetch(`${API}/ubicaciones/${perchaGestionId}`, { method: 'DELETE' });
      if (res.ok) {
        // Microcirugia 6 (2026-07-08): borrar la foto huerfana. Sin esto cada
        // percha borrada deja 200-800KB acumulandose (localStorage antes,
        // IndexedDB ahora — mismo cuidado, otro almacen).
        if (window.OCFotos) window.OCFotos.borrarFoto(perchaGestionId); // async, fire-and-forget
        delete fotoCache[perchaGestionId];
        cerrarGestion(); cargar();
        if (window.cargarUbicaciones) window.cargarUbicaciones();
      } else {
        const d = await res.json().catch(() => ({}));
        msg.style.color = 'var(--rojo,#a3392a)';
        msg.textContent = d.error || window.t('shelves.couldNotDelete');
      }
      return;
    }
    // Crear nueva percha
    if (e.target.id === 'vp-a-crear') {
      const nombre = (document.getElementById('vp-a-nombre').value || '').trim();
      const msg = document.getElementById('vp-a-msg');
      if (!nombre) { msg.style.color = 'var(--rojo,#a3392a)'; msg.textContent = window.t('shelves.nameRequired'); return; }
      const res = await fetch(`${API}/ubicaciones`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre }),
      });
      if (res.ok) {
        cerrarAgregar(); cargar();
        if (window.cargarUbicaciones) window.cargarUbicaciones();
      } else {
        const d = await res.json().catch(() => ({}));
        msg.style.color = 'var(--rojo,#a3392a)';
        msg.textContent = d.error || window.t('shelves.couldNotCreate');
      }
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

  // ── TRANSFERS ENTRE PERCHAS (JFC 2026-08-28) ──────────────────────────────
  // Movido de Advanced a Perchas: es una operación de inventario entre
  // ubicaciones, no configuración técnica. El dueño aprueba/rechaza/confirma
  // rápido desde donde piensa en perchas. Reusa el mismo endpoint /api/transferencias.
  async function renderTransferencias() {
    const cont = $('vp-transfers');
    if (!cont) return;
    let lista;
    try {
      lista = await (await fetch(`${API}/transferencias`)).json();
    } catch (err) {
      console.error('[VPerchas transferencias]', err);
      cont.innerHTML = `<h3 class="seccion" style="margin-top:0;">${esc(window.t('shelves.transfersHeading') || 'Transfers between locations')}</h3>
        <p style="font-size:14px;color:var(--rojo,#a3392a);">Could not load. Check your connection and try again.</p>`;
      return;
    }
    const titulo = `<h3 class="seccion" style="margin-top:0;">${esc(window.t('shelves.transfersHeading') || 'Transfers between locations')}</h3>`;
    if (!Array.isArray(lista) || !lista.length) {
      cont.innerHTML = titulo + `<p style="font-size:14px;color:var(--ink-soft);">No transfers yet.</p>`;
      return;
    }
    cont.innerHTML = titulo + lista.map((t) => {
      const colorEstado = t.estado === 'recibida' ? 'verde' : t.estado === 'rechazada' ? 'rojo' : t.estado === 'en_transito' ? 'azul' : 'amarillo';
      let acciones = '';
      if (t.estado === 'solicitada') {
        acciones = `<button data-transf-aprobar="${t.id}" style="font-size:13px;padding:6px 10px;min-height:44px;border:2px solid var(--verde);border-radius:5px;background:transparent;color:var(--verde);cursor:pointer;">Approve</button>
          <button data-transf-rechazar="${t.id}" style="font-size:13px;padding:6px 10px;min-height:44px;border:2px solid var(--rojo);border-radius:5px;background:transparent;color:var(--rojo);cursor:pointer;">Reject</button>`;
      } else if (t.estado === 'en_transito') {
        acciones = `<button data-transf-confirmar="${t.id}" style="font-size:13px;padding:6px 10px;min-height:44px;border:2px solid var(--azul-medio);border-radius:5px;background:transparent;color:var(--azul-medio);cursor:pointer;">Confirm receipt</button>`;
      }
      return `<div class="tag-card" style="display:flex;align-items:center;gap:10px;padding:10px 12px;margin-bottom:8px;flex-wrap:wrap;">
        <div style="flex:1;min-width:180px;">
          <strong>${esc(t.nombre)}</strong> · ${t.cantidad} un.
          <div style="font-size:13px;color:var(--ink-soft);">${esc(t.desdeNombre)} → ${esc(t.haciaNombre)}</div>
        </div>
        <span class="badge-estado ${colorEstado}">${t.estado.replace('_', ' ')}</span>
        ${acciones}
      </div>`;
    }).join('');

    cont.querySelectorAll('[data-transf-aprobar]').forEach((btn) => btn.addEventListener('click', async () => {
      let res, r;
      try { res = await fetch(`${API}/transferencias/${btn.dataset.transfAprobar}/aprobar`, { method: 'POST' }); r = await res.json(); }
      catch (err) { console.error('[transf-aprobar]', err); alert('Could not reach the server. Try again.'); return; }
      if (!res.ok) { alert(r.error); return; }
      renderTransferencias();
    }));
    cont.querySelectorAll('[data-transf-rechazar]').forEach((btn) => btn.addEventListener('click', async () => {
      try { await fetch(`${API}/transferencias/${btn.dataset.transfRechazar}/rechazar`, { method: 'POST' }); }
      catch (err) { console.error('[transf-rechazar]', err); alert('Could not reach the server. Try again.'); return; }
      renderTransferencias();
    }));
    cont.querySelectorAll('[data-transf-confirmar]').forEach((btn) => btn.addEventListener('click', async () => {
      let res, r;
      try { res = await fetch(`${API}/transferencias/${btn.dataset.transfConfirmar}/confirmar-recepcion`, { method: 'POST' }); r = await res.json(); }
      catch (err) { console.error('[transf-confirmar]', err); alert('Could not reach the server. Try again.'); return; }
      if (!res.ok) { alert(r.error); return; }
      renderTransferencias();
      cargar(); // re-render del grid de perchas (el stock cambió)
    }));
  }

  function init() {
    document.body.appendChild(inputFoto);
    document.body.appendChild(modal);
    document.body.appendChild(modalGestion);
    document.body.appendChild(modalAgregar);

    // El botón "Agregar +" NO se inyecta aquí: init() corre en DOMContentLoaded,
    // ANTES del login, cuando rolActual() todavía es null y el botón no saldría.
    // Se inyecta en cargar() (ver inyectarBotonAgregar), que corre cada vez que
    // se abre la vista, ya con la sesión iniciada. Idempotente (una sola vez).

    // Evento de gestión: guardar renombre al presionar Enter en el input
    const inputG = document.getElementById('vp-g-nombre');
    if (inputG) {
      inputG.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') document.getElementById('vp-g-renombrar').click();
      });
    }
    const inputA = document.getElementById('vp-a-nombre');
    if (inputA) {
      inputA.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') document.getElementById('vp-a-crear').click();
      });
    }
  }
  // Wall defensiva (2026-07-08): un fallo al montar Mis perchas queda aislado,
  // no rompe el resto de la app.
  function initSeguro() { try { init(); } catch (e) { console.error('VPerchas init falló (aislado):', e); } }
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', initSeguro)
    : initSeguro();

  window.VPerchas = { cargar, renderTransferencias };
})();
