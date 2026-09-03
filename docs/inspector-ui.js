/* inspector-ui.js — panel de Inspector(TM) en el panel PRIVADO del lord (JFC).

   Solo se muestra si f123_lord === "1" (el panel de mantenimiento/soporte de JFC,
   el "lado B"). Usa el motor inspector.js (inventario SOLO, jamás cifras). Da el
   sello de integridad del inventario y compara contra un sello base para detectar
   faltantes/sobrantes/cambios (anti-robo, anti-tampering). Todo LOCAL: nada sale
   del aparato. Aditivo, liquid/responsive, falla abierto. */
(function () {
  "use strict";

  var NARANJA = "#F97316", VERDE = "#00C87A", ROJO = "#E8365D";

  function esLord() { try { return localStorage.getItem("f123_lord") === "1"; } catch (_) { return false; } }
  function t(k, fb) { try { return window.t ? window.t(k, fb) : (fb || k); } catch (_) { return fb || k; } }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function tarjeta() {
    var vista = document.getElementById("vista-avanzado");
    if (!vista) return null;
    var ya = document.getElementById("oc-inspector-panel");
    if (ya) return ya;
    var card = document.createElement("div");
    card.className = "tag-card";
    card.id = "oc-inspector-panel";
    card.style.cssText = "text-align:left;margin-top:26px;border:2px solid " + NARANJA + ";";
    card.innerHTML =
      '<h3 class="seccion" style="margin-top:0;color:' + NARANJA + ';">Inspector™</h3>' +
      '<p style="font-size:14px;color:var(--ink-soft);margin-top:0;">' + esc(t("inspector.intro", "Integrity and anti-tampering check for your inventory. Inventory only — never prices, sales or customer data. Everything stays on this device.")) + '</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0;">' +
      '  <button id="oc-insp-verificar" class="ir" style="background:' + NARANJA + ';border-color:#c85a12;color:#fff;">' + esc(t("inspector.verify", "Verify inventory")) + '</button>' +
      '  <button id="oc-insp-guardar" style="font-size:14px;padding:8px 14px;border:2px solid ' + NARANJA + ';border-radius:6px;background:transparent;color:' + NARANJA + ';cursor:pointer;">' + esc(t("inspector.saveBaseline", "Save as baseline seal")) + '</button>' +
      '  <button id="oc-insp-comparar" style="font-size:14px;padding:8px 14px;border:2px solid var(--ink-soft);border-radius:6px;background:transparent;color:var(--ink-soft);cursor:pointer;">' + esc(t("inspector.compare", "Compare with baseline")) + '</button>' +
      '</div>' +
      '<div id="oc-insp-out" style="font-size:14px;line-height:1.5;"></div>';
    vista.appendChild(card);
    return card;
  }

  function pintarSello(out, snap) {
    out.innerHTML =
      '<div style="padding:10px 12px;border-radius:6px;background:#F3F4F1;border:1px solid #cdd2c8;">' +
      '<div style="font-weight:700;">' + esc(t("inspector.sealTitle", "Integrity seal")) + '</div>' +
      '<div style="font-family:var(--font-mono,monospace);font-size:12px;word-break:break-all;color:var(--ink-soft);margin:4px 0;">' + esc((snap.root || "").slice(0, 32)) + '…</div>' +
      '<div style="font-size:13px;color:var(--ink-soft);">' + snap.count + ' ' + esc(t("inspector.items", "items")) + ' · ' + esc(new Date(snap.generatedAt).toLocaleString()) + '</div>' +
      '</div>';
  }

  function fila(color, etq, x) {
    return '<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid #e5e7e1;">' +
      '<span><strong style="color:' + color + ';">' + esc(etq) + '</strong> ' + esc(x.nombre || x.sku) +
      ' <span style="color:var(--ink-soft);font-size:12px;">(' + esc(x.sku) + ')</span></span>' +
      '<span style="color:var(--ink-soft);">' + (x.deltaCantidad != null ? (x.deltaCantidad > 0 ? '+' : '') + x.deltaCantidad : x.cantidad) + '</span></div>';
  }

  function pintarDiff(out, d) {
    if (d.intacto) {
      out.innerHTML = '<div style="padding:10px 12px;border-radius:6px;background:#E8F7EF;border:1px solid ' + VERDE + ';color:#1a6e3c;font-weight:700;">' +
        esc(t("inspector.intact", "Intact — inventory matches the baseline seal.")) + '</div>';
      return;
    }
    var html = '<div style="padding:10px 12px;border-radius:6px;background:#FDECEF;border:1px solid ' + ROJO + ';">' +
      '<div style="font-weight:700;color:' + ROJO + ';margin-bottom:6px;">' + esc(t("inspector.mismatch", "Discrepancies vs baseline")) + '</div>';
    d.faltantes.forEach(function (x) { html += fila(ROJO, t("inspector.missing", "Missing"), x); });
    d.cambios.forEach(function (x) { html += fila(NARANJA, t("inspector.changed", "Changed"), x); });
    d.nuevos.forEach(function (x) { html += fila(VERDE, t("inspector.added", "New"), x); });
    html += '</div>';
    out.innerHTML = html;
  }

  function cablear() {
    if (!esLord() || !window.Inspector) return;
    var card = tarjeta();
    if (!card || card._listo) return;
    card._listo = true;
    var out = card.querySelector("#oc-insp-out");
    card.querySelector("#oc-insp-verificar").addEventListener("click", async function () {
      out.textContent = t("inspector.working", "Verifying…");
      try { pintarSello(out, await window.Inspector.snapshot()); } catch (_) { out.textContent = t("inspector.err", "Could not read inventory."); }
    });
    card.querySelector("#oc-insp-guardar").addEventListener("click", async function () {
      try { var s = await window.Inspector.snapshot(); window.Inspector.guardarBaseline(s);
        out.innerHTML = '<div style="color:#1a6e3c;font-weight:700;">' + esc(t("inspector.saved", "Baseline seal saved.")) + '</div>'; } catch (_) {}
    });
    card.querySelector("#oc-insp-comparar").addEventListener("click", async function () {
      var base = window.Inspector.leerBaseline();
      if (!base) { out.innerHTML = '<div style="color:var(--ink-soft);">' + esc(t("inspector.noBaseline", "No baseline yet — save one first.")) + '</div>'; return; }
      out.textContent = t("inspector.working", "Verifying…");
      try { pintarDiff(out, window.Inspector.diff(base, await window.Inspector.snapshot())); } catch (_) { out.textContent = t("inspector.err", "Could not read inventory."); }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", cablear);
  else cablear();
  try { window.addEventListener("oc-login", cablear); } catch (_) {}
})();
