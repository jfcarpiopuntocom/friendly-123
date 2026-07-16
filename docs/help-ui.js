// help-ui.js — Enlace de ayuda "Ayuda(?)" bajo el botón Salir del header (NO
// es un botón flotante estilo chat/WhatsApp — JFC lo pidió explícitamente
// discreto, parte del header, no una burbuja llamativa). Contenido DISTINTO
// según el rol activo (dueño vs empleado): el dueño necesita entender todo
// el sistema (capa contable, claves, gastos); el empleado solo necesita lo
// operativo del día a día (escanear, vender, leer el semáforo). Depende de
// auth-ui.js (escucha el evento "oc-login" para saber qué rol mostrar y para
// encontrar el botón #oc-logout, debajo del cual se inserta este enlace).
//
// REACTIVADO 2026-07-01 (JFC): indispensable, sobre todo con el timeout de
// inactividad activo. NUNCA quitar/ocultar sin que JFC lo pida en el mismo turno.
(function () {
  const AYUDA_HABILITADA = true;
  if (!AYUDA_HABILITADA) return;

  const css = document.createElement("style");
  css.textContent = `
  #oc-help-btn{display:none;margin-top:6px;background:none;border:none;
    font-family:var(--font-display,sans-serif);font-size:13px;color:var(--blanco-calido,#F8F9FB);
    text-decoration:underline;cursor:pointer;padding:4px;}
  #oc-help-modal{position:fixed;inset:0;z-index:9998;background:rgba(28,48,73,.85);
    display:none;align-items:flex-end;justify-content:center;padding:0;}
  #oc-help-modal.abierto{display:flex;}
  #oc-help-sheet{background:var(--blanco-calido,#F8F9FB);width:100%;max-width:520px;max-height:82vh;
    overflow-y:auto;border-radius:16px 16px 0 0;padding:22px 20px 28px;}
  #oc-help-sheet h2{font-family:var(--font-display,sans-serif);color:var(--ink,#0F1923);margin:0 0 4px;font-size:22px;}
  #oc-help-sheet .rolTag{display:inline-block;font-size:13px;font-weight:700;padding:3px 10px;border-radius:12px;
    margin-bottom:14px;background:var(--azul-medio,#2E6278);color:var(--blanco-calido,#F8F9FB);}
  #oc-help-sheet h3{font-family:var(--font-display,sans-serif);color:var(--ink,#0F1923);font-size:16px;margin:18px 0 6px;}
  #oc-help-sheet p, #oc-help-sheet li{font-size:15px;color:var(--ink-soft,#2C3E50);line-height:1.5;}
  #oc-help-sheet ul{margin:0 0 4px;padding-left:20px;}
  #oc-help-cerrar{margin-top:18px;width:100%;padding:12px;border-radius:8px;border:2px solid var(--azul-medio,#2E6278);
    background:var(--azul-medio,#2E6278);color:var(--blanco-calido,#F8F9FB);font-family:var(--font-display,sans-serif);
    font-size:15px;cursor:pointer;min-height:44px;}
  `;
  document.head.appendChild(css);

  // AYUDA_DUENO — updated 2026-07-15 per JFC: reflects true product identity.
  // This is NOT a POS. It is inventory management for vendors, promoters, and
  // commission tracking — built around "perchas" (slots/racks) as the core unit,
  // color-coded for instant interpretation, data always local (you own it).
  // 2 years of patches and updates included — vs the industry standard of 1.
  const AYUDA_DUENO = `
    <span class="rolTag">Owner's guide</span>
    <h3>What friendly-123 actually is</h3>
    <p style="font-size:14px;line-height:1.6;margin:0 0 10px;">
      Not a cash register. An inventory management system for vendors, promoters,
      and commission tracking — organized around <b>perchas</b> (your slots, racks,
      or locations) as the essential unit. Colors replace spreadsheets. Your data
      stays on your device: no subscription lock-in, no cloud required.
    </p>
    <h3>The color language (Simon system)</h3>
    <ul>
      <li><b style="color:#00C87A;">Green</b>: healthy — keep going.</li>
      <li><b style="color:#E8A020;">Gold</b>: money sitting there — act on it.</li>
      <li><b style="color:#F97316;">Orange</b>: running low — restock before it becomes a problem.</li>
      <li><b style="color:#E8365D;">Red</b>: emergency — act now.</li>
      <li><b style="color:#5294AC;">Blue</b>: wisdom — tips, insights, and the accounting layer.</li>
      <li><b style="color:#0A0A0F;">Black</b>: dead stock — your money isn't moving. Fix that.</li>
    </ul>
    <h3>Today: your daily signal</h3>
    <ul>
      <li>One glance at Today tells you what needs attention before you open.</li>
      <li>The header color reflects the overall state of the day.</li>
      <li>Didn't log sales live? Use Day Close to record everything at once.</li>
    </ul>
    <h3>Sold (not "sell")</h3>
    <ul>
      <li>Tap a product in the grid — one unit logged as sold. Undo within 5 seconds.</li>
      <li>Every movement is recorded with reason and who did it.</li>
      <li>Commissions calculate automatically per percha and per vendor.</li>
    </ul>
    <h3>Advanced (your lock, your rules)</h3>
    <ul>
      <li><b>Fixed costs</b>: rent, utilities, payroll — divided across 30 days so you know the real cost of opening tomorrow.</li>
      <li><b>Accounting layer</b>: T-accounts, P&amp;L, balance sheet. Separate PIN — your accountant or partner can access it directly without seeing the full system.</li>
      <li><b>Keys and recovery</b>: save your email before changing any PIN. No email on file = no recovery possible.</li>
    </ul>
    <h3>Ownership and updates</h3>
    <p style="font-size:14px;line-height:1.6;margin:0;">
      Your data lives on this device — no server has it, no subscription can take it away.
      Activation unlocks unlimited products and exports. Includes <b>2 years of patches
      and updates</b> (the industry standard is 1).
    </p>
  `;

  // AYUDA_EMPLEADO: operational only — no mention of PINs, costs, or accounting.
  const AYUDA_EMPLEADO = `
    <span class="rolTag">Vendor / promoter guide</span>
    <h3>Colors tell you what's happening</h3>
    <ul>
      <li><b style="color:#00C87A;">Green</b>: good. <b style="color:#E8A020;">Gold</b>: money waiting. <b style="color:#F97316;">Orange</b>: alert the owner soon. <b style="color:#E8365D;">Red</b>: alert now.</li>
      <li><b style="color:#0A0A0F;">Black</b>: not moving — flag it to the owner.</li>
      <li>You don't need to interpret anything — the color does the work.</li>
    </ul>
    <h3>Your shift in 3 steps</h3>
    <ul>
      <li><b>Today</b>: check the daily summary when you arrive. Red means alert the owner.</li>
      <li><b>Sold</b>: tap the product in the grid — one unit logged. Or scan / type the code if you can't find it fast.</li>
      <li><b>Adjust</b>: something broke, expired, or the count was off? Use Adjust and write the reason. It stays on record.</li>
    </ul>
    <h3>Labels</h3>
    <p>Need to reprint a lost or damaged label? Find it by name or code in the Labels tab.</p>
  `;

  const modal = document.createElement("div");
  modal.id = "oc-help-modal";
  modal.innerHTML = `<div id="oc-help-sheet">
    <h2>¿Cómo funciona friendly-123?</h2>
    <!-- Slogan informal de Amigable (JFC 2026-07-02): "tu negocio, a color".
         Va aquí y en la bienvenida (welcome-ui.js). El formal "Amigable: punto
         de venta y control de inventario" vive en el footer y la bienvenida. -->
    <p style="font-family:var(--font-display,sans-serif);color:#E8A020;font-size:15px;font-weight:700;margin:0 0 14px;">Tu negocio, a color</p>
    <div id="oc-help-body"></div>
    <button id="oc-help-cerrar">Entendido</button>
  </div>`;
  document.body.appendChild(modal);

  const btn = document.createElement("button");
  btn.id = "oc-help-btn";
  btn.textContent = "Ayuda (?)";

  // brandWrap: logo friendly-123 encima del botón Ayuda, igual que AMIGABLE.
  // ESTADO APROBADO POR JFC (2026-07-15). NO CAMBIAR ESTRUCTURA.
  // - Logo: logo.png (wordmark coloreado), height:22px, clickeable → va a Hoy
  // - Btn: "Ayuda (?)" debajo del logo
  // - Se inserta afterend de #oc-logout en el header (flex child del header)
  // ❌ NO ocultar el img ❌ NO cambiar flex-direction a row
  const brandWrap = document.createElement("div");
  brandWrap.id = "oc-brand-help";
  brandWrap.style.cssText = "display:none;flex-direction:column;align-items:flex-end;gap:2px;margin-left:10px;";

  const brandLogo = document.createElement("img");
  brandLogo.src = "./logo.png";
  brandLogo.alt = "friendly-123";
  brandLogo.title = "Ir a Hoy";
  brandLogo.style.cssText = "height:22px;width:auto;object-fit:contain;display:block;cursor:pointer;";
  brandLogo.onerror = function () { this.style.display = "none"; };
  brandLogo.addEventListener("click", () => {
    const hoy = document.querySelector('nav button[data-vista="hoy"]');
    if (hoy) hoy.click();
  });

  btn.style.marginTop = "0";
  brandWrap.appendChild(brandLogo);
  brandWrap.appendChild(btn);

  function abrir() {
    const rol = window.OCAuth ? window.OCAuth.rolActual() : null;
    document.getElementById("oc-help-body").innerHTML = rol === "empleado" ? AYUDA_EMPLEADO : AYUDA_DUENO;
    modal.classList.add("abierto");
  }
  btn.addEventListener("click", abrir);
  // API minima para otros modulos (welcome-ui.js usa "Ver la guia" en la
  // bienvenida). No exponer mas que abrir().
  window.OCHelp = { abrir };
  document.getElementById("oc-help-cerrar").addEventListener("click", () => modal.classList.remove("abierto"));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("abierto"); });

  window.addEventListener("oc-login", () => {
    const logout = document.getElementById("oc-logout");
    if (logout && logout.parentNode && !document.body.contains(brandWrap)) {
      logout.insertAdjacentElement("afterend", brandWrap);
    }
    brandWrap.style.display = "flex";
    btn.style.display = "block";
  });
  window.addEventListener("oc-logout", () => {
    brandWrap.remove();
    modal.classList.remove("abierto");
  });
})();
