// P0 scoped Owner-approved inventory reconciliation (30 Oct 2026).
// Automatic in-app recovery, exact shop/license fingerprint, no manual console.
// Each adjustment is a regular durable movement; never rewrite a cash ledger.
(function (root) {
  "use strict";
  const TARGET = [
    ["aventuras de james bond", 3],
    ["hielo del chimborazo", 4],
    ["prueba b", 7],
    ["spray de la verdad", 7],
    ["spray de la verdad bourgeois", 6],
    ["crema", 16]
  ];
  const CHECK = "f123-jfc-owner-reconciled-20261030-v1";
  function normalize(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function fingerprint(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    str = String(str || "").trim().toUpperCase();
    for (let i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  function plan(catalog) {
    if (!catalog || !Array.isArray(catalog.productos)) return null;
    const result = [];
    const seen = new Set();
    for (const [name, original] of TARGET) {
      const hits = catalog.productos.filter(p => p && p.id != null && !p.borrado &&
        normalize(p.nombre) === name);
      if (hits.length !== 1 || seen.has(String(hits[0].id))) return null;
      const p = hits[0], value = Number(p.stockActual);
      // Stop rather than override a legitimate new sale or a later recount.
      if (!Number.isSafeInteger(value) || value < 0 || (value !== original && value !== 7)) return null;
      seen.add(String(p.id));
      result.push({ id: String(p.id), name, before: value, target: 7, delta: 7 - value });
    }
    return result;
  }
  async function run(deps) {
    if (!deps.authorized() || deps.done()) return { changed: 0, skipped: "unauthorized-or-complete" };
    const initial = plan(deps.catalog());
    if (!initial) return { changed: 0, skipped: "unrecognized-or-newer-inventory" };
    await deps.audit({ v: 1, reason: "Owner approved six-stock reconciliation", rows: initial, time: Date.now() });
    let changed = 0;
    for (const entry of initial) {
      const current = plan(deps.catalog());
      if (!current) throw Error("Inventory changed during reconciliation; retaining audit");
      const row = current.find(p => p.id === entry.id);
      if (!row) throw Error("Product identity changed during reconciliation");
      if (!row.delta) continue;
      const response = await deps.adjust(row.id, row.delta);
      if (!response || Number(response.stockActual) !== 7) throw Error("Durable stock adjustment not confirmed");
      changed++;
    }
    const end = plan(deps.catalog());
    if (!end || end.some(p => p.delta !== 0)) throw Error("Final inventory not confirmed");
    await deps.finish();
    return { changed, complete: true };
  }
  if (typeof module === "object" && module.exports) module.exports = { plan, run, fingerprint };
  if (!root || typeof root.addEventListener !== "function") return;
  let running = false, timer = null;
  const deps = {
    authorized() {
      try {
        return !!(root.OCTienda && root.OCTienda.licenciaActual &&
          fingerprint(root.OCTienda.licenciaActual()) === 6583453063440131 &&
          root.OCAuth && root.OCAuth.rolActual && root.OCAuth.rolActual() === "dueno" &&
          (!root.OCTabSession || root.OCTabSession.canSync()));
      } catch (_) { return false; }
    },
    done() { try { return localStorage.getItem(CHECK) === "done"; } catch (_) { return true; } },
    catalog() { try { return root.OCSync && root.OCSync.catalogoPropio && root.OCSync.catalogoPropio(); } catch (_) { return null; } },
    async audit(payload) {
      // Readback barrier: never start corrections without a durable audit of prior quantities.
      const value = JSON.stringify(payload), key = CHECK + "::audit";
      localStorage.setItem(key, value);
      if (localStorage.getItem(key) !== value) throw Error("Could not preserve pre-repair audit");
    },
    async adjust(id, delta) {
      const response = await root.fetch("/api/productos/" + encodeURIComponent(id) + "/ajustar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delta, motivo: "Reconciliación Owner: seis existencias autorizadas a 7 (2026-10-30)" })
      });
      if (!response.ok) throw Error("Stock adjustment refused: " + response.status);
      return response.json();
    },
    async finish() {
      localStorage.setItem(CHECK, "done");
      if (localStorage.getItem(CHECK) !== "done") throw Error("Could not confirm repair marker");
    }
  };
  function schedule() {
    if (running || timer) return;
    timer = setTimeout(async function () {
      timer = null; if (running) return;
      running = true;
      try {
        const task = () => run(deps);
        if (root.navigator && root.navigator.locks)
          await root.navigator.locks.request(CHECK, { mode: "exclusive" }, task);
        else await task();
      } catch (e) { try { console.warn("[F123 Owner stock reconciliation]", e.message); } catch (_) {} }
      finally { running = false; }
    }, 0);
  }
  root.addEventListener("oc-login", schedule);
  root.addEventListener("oc-licencia-disponible", schedule);
  root.addEventListener("oc-catalogo-cambiado", schedule);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule);
  else schedule();
})(typeof window === "undefined" ? null : window);
