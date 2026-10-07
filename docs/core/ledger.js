/* friendly-123 Libro de doble entrada v1 (ADR-001, capa 2, paso 1).
   Modulo PURO: sin DOM, storage, red ni reloj. Todo se recalcula desde los hechos;
   nadie escribe asientos a mano. Importes en centavos enteros (reusa OCPayoutLedger.cents).
   Sin UI todavia: ninguna vista lee de aqui en este paso.

   Plan de cuentas FIJO (agregar una cuenta exige un ADR nuevo aprobado por JFC):
     1000 Caja/Banco (activo)            1100 Por cobrar a clientes, fiado (activo)
     2000 Por pagar a consignadores (pasivo)   2100 Reserva por devoluciones (pasivo, NO se usa en este paso)
     2200 Impuesto por pagar (pasivo)    4000 Ventas propias (ingreso)
     4100 Comision de la casa (ingreso)  4900 Devoluciones (ingreso contra)   5000 Gastos (gasto)

   Convencion interna: cada linea se arma con un importe "firmado" (+ = Debe, - = Haber) y
   addLine lo convierte a debitCents/creditCents positivos. Un asiento suma cero si la suma
   firmada es 0; buildLedger rechaza (a errors) cualquier asiento que no cuadre.

   Campos que la spec nombra y NO existen hoy en mock-backend.js (se tratan como ausentes):
   - venta.fiado: no hay bandera de venta fiada; se acepta `fiado === true` o `medioPago === "fiado"`.
   - cartera: los hechos reales son cartera_cargo / cartera_abono con { clienteId, monto, motivo }.
     Aqui se aceptan normalizados como { id, opId?, tipo:"abono"|"cargo", monto, fecha }. */
(function (root, factory) {
  const api = factory(typeof require === "function" ? (function () {
    try { return require("./payout-ledger.js"); } catch (_) { return null; }
  })() : null, root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OCLedger = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (requiredPL, root) {
  "use strict";

  const PL = requiredPL || (root && root.OCPayoutLedger);
  const cents = PL.cents;

  const ACCOUNTS = ["1000", "1100", "2000", "2100", "2200", "4000", "4100", "4900", "5000"];
  /* Cuentas de naturaleza deudora: su saldo natural es Debe - Haber. El resto: Haber - Debe. */
  const DEBIT_NATURE = new Set(["1000", "1100", "4900", "5000"]);
  const UNASSIGNED = "__unassigned__";
  const KIND_ORDER = { venta: 0, ajuste: 1, "pago-legacy": 2, pago: 3, gasto: 4, cobro: 5 };

  function str(x) { return x == null ? "" : String(x); }
  function mesDe(fecha) { return str(fecha).slice(0, 7); }

  /* Agrega una linea con importe firmado (+Debe / -Haber). Importe 0 no genera linea. */
  function addLine(lines, account, signedCents, extra) {
    if (!signedCents) return;
    const l = Object.assign({ account, debitCents: signedCents > 0 ? signedCents : 0, creditCents: signedCents < 0 ? -signedCents : 0 }, extra || {});
    lines.push(l);
  }
  function mkEntry(factKind, factId, suffix, fecha, lines) {
    return { id: factKind + ":" + factId + (suffix ? ":" + suffix : ""), factKind, factId, fecha: str(fecha), mes: mesDe(fecha), lines };
  }
  function balanced(e) {
    let s = 0;
    e.lines.forEach((l) => { s += l.debitCents - l.creditCents; });
    return s === 0 && e.lines.length > 0 && e.lines.every((l) => Number.isInteger(l.debitCents) && Number.isInteger(l.creditCents));
  }

  /* Regla de idempotencia (e): un hecho repetido (mismo id, o mismo opId en pagos/cobros) cuenta una vez.
     Para que (d) se cumpla aunque dos copias difieran, se queda la de menor JSON (eleccion independiente del orden). */
  function dedupe(list, keyFn) {
    const best = new Map();
    (Array.isArray(list) ? list : []).forEach((f) => {
      if (!f) return;
      const k = keyFn(f);
      if (!k) { best.set("\u0000sin-id-" + best.size, { f, js: JSON.stringify(f), noId: true }); return; }
      const js = JSON.stringify(f);
      const cur = best.get(k);
      if (!cur || js < cur.js) best.set(k, { f, js });
    });
    return [...best.values()];
  }

  /* Partes de cada persona en una venta. Se reusa buildObligations (misma logica de split.reparto que
     obligationsForSale) sobre un clon sin anulada/devuelta, para poder revertir con el mismo reparto. */
  function sharesOfSale(v, locations) {
    if (!v.split) return [];
    const clon = Object.assign({}, v, { anulada: false, devuelta: false, liquidada: false });
    return PL.buildObligations({ sales: [clon], adjustments: [], locations, payouts: [] })
      .filter((o) => o.kind === "sale")
      .map((o) => ({ personId: o.payeeId, cents: o.signedAmountCents }));
  }

  function personExtra(personId) { return personId ? { personId } : {}; }

  /* REGLAS 1, 2 y 3: venta propia / consignacion-comision, con impuesto, fiado y reverso. */
  function entriesForSale(v, locations, errors, out) {
    const id = str(v.id);
    const cant = v.cantidad == null ? 1 : Number(v.cantidad);
    const total = cents((Number(v.precioUnit) || 0) * (Number.isFinite(cant) ? cant : 1));
    const imp = v.impuesto && typeof v.impuesto === "object" ? v.impuesto : null;
    const taxC = imp ? Math.max(0, cents(imp.monto)) : 0;
    /* Impuesto "agregado": el cliente paga precio + impuesto. "incluido" (por defecto): el precio ya lo trae. */
    const cobrado = total + (imp && imp.modo === "agregado" ? taxC : 0);
    if (cobrado <= 0) { errors.push({ factKind: "venta", factId: id, motivo: "venta sin importe cobrado" }); return; }

    const cashAcct = (v.fiado === true || v.medioPago === "fiado" || (v.info && v.info.formaPago === "fiado")) ? "1100" : "1000"; // Codex 2026-10-07: actual sale field + legacy aliases
    const shares = sharesOfSale(v, locations);
    const sumShares = shares.reduce((a, s) => a + s.cents, 0);
    /* Parte de la casa = lo cobrado - impuesto - lo que se debe a personas. */
    const casa = cobrado - taxC - sumShares;
    const casaAcct = v.split ? "4100" : "4000"; // regla 1 = comision (4100); regla 2 = venta propia (4000)
    const ctx = { productId: str(v.productoId) || undefined, locationId: str(v.ubicacionId) || undefined };
    const clean = (x) => { Object.keys(x).forEach((k) => x[k] === undefined && delete x[k]); return x; };

    const lines = [];
    addLine(lines, cashAcct, cobrado, clean(Object.assign({}, ctx)));
    shares.forEach((s) => addLine(lines, "2000", -s.cents, clean(Object.assign({}, ctx, personExtra(s.personId)))));
    addLine(lines, "2200", -taxC, clean(Object.assign({}, ctx)));
    addLine(lines, casaAcct, -casa, clean(Object.assign({}, ctx)));
    out.push(mkEntry("venta", id, "", v.fecha, lines));

    /* REGLA 3: anulada o devuelta. El original NUNCA se borra; se agrega el reverso exacto
       (todas las lineas con signo contrario) y la parte de la casa se reversa contra 4900. */
    if (v.anulada || v.devuelta) {
      const fRev = v.anuladaEn || v.canceladaExPostEn || v.fechaDevolucion || v.fecha;
      const rl = [];
      lines.forEach((l) => {
        const signed = -(l.debitCents - l.creditCents);
        const acct = (l.account === casaAcct) ? "4900" : l.account;
        const extra = Object.assign({}, l); delete extra.account; delete extra.debitCents; delete extra.creditCents;
        addLine(rl, acct, signed, extra);
      });
      out.push(mkEntry("venta", id, "rev", fRev, rl));
    }
  }

  /* REGLA 4: ajuste de comision. Positivo = se le debe mas a la persona; negativo = menos.
     Haber/Debe 2000 por persona contra 4100 (la casa absorbe la diferencia). */
  function entriesForAdjustment(a, rows, errors, out) {
    const id = str(a.id);
    if (!rows.length) { errors.push({ factKind: "ajuste", factId: id, motivo: "ajuste sin importe o sin persona a la que aplicar" }); return; }
    const lines = [];
    let sum = 0;
    rows.forEach((o) => {
      sum += o.signedAmountCents;
      addLine(lines, "2000", -o.signedAmountCents, Object.assign({ locationId: str(a.ubicacionId) || undefined }, personExtra(o.payeeId)));
    });
    addLine(lines, "4100", sum, { locationId: str(a.ubicacionId) || undefined });
    lines.forEach((l) => l.locationId === undefined && delete l.locationId);
    out.push(mkEntry("ajuste", id, "", a.fecha, lines));
  }

  /* REGLA 5: pago. Debe 2000 de la persona, Haber 1000 por el efectivo (amountCents).
     - status "paid" sin reversalOf: pago normal.
     - registro con reversalOf (status paid): asiento inverso (es el reverso append-only del backend).
     - status "voided"/"reversed" sin reversalOf: se asienta el pago y su inverso (neto 0), igual que
       payout-ledger, que no cuenta esos pagos como aplicados. */
  function payoutLines(p, sign) {
    const amt = Math.trunc(Number(p.amountCents) || 0);
    const lines = [];
    addLine(lines, "2000", sign * amt, personExtra(str(p.payeeId) || null));
    addLine(lines, "1000", -sign * amt, p.locationId ? { locationId: str(p.locationId) } : {});
    return lines;
  }
  function entriesForPayout(p, errors, out) {
    const id = str(p.id);
    const amt = Math.trunc(Number(p.amountCents) || 0);
    if (amt <= 0) { errors.push({ factKind: "pago", factId: id, motivo: "pago sin importe positivo en centavos" }); return; }
    const fecha = p.paidAt || p.fecha;
    if (p.status === "paid" && p.reversalOf) { out.push(mkEntry("pago", id, "", fecha, payoutLines(p, -1))); return; }
    if (p.status === "paid") { out.push(mkEntry("pago", id, "", fecha, payoutLines(p, 1))); return; }
    if (p.status === "voided" || p.status === "reversed") {
      out.push(mkEntry("pago", id, "", p.paidAt || p.fecha, payoutLines(p, 1)));
      out.push(mkEntry("pago", id, "rev", p.voidedAt || p.reversedAt || fecha, payoutLines(p, -1)));
      return;
    }
    errors.push({ factKind: "pago", factId: id, motivo: "estado de pago desconocido: " + str(p.status) });
  }

  /* REGLA 6: gasto. Debe 5000, Haber 1000. */
  function entriesForExpense(g, errors, out) {
    const id = str(g.id);
    const c = cents(g.monto);
    if (c <= 0) { errors.push({ factKind: "gasto", factId: id, motivo: "gasto sin importe positivo" }); return; }
    const ex = g.ubicacionId && g.ubicacionId !== "todas" ? { locationId: str(g.ubicacionId) } : {};
    const lines = [];
    addLine(lines, "5000", c, ex);
    addLine(lines, "1000", -c, ex);
    out.push(mkEntry("gasto", id, "", g.fecha, lines));
  }

  /* REGLA 7: cobro de fiado (cartera_abono). Debe 1000, Haber 1100.
     Un cartera_cargo NO genera asiento propio: la deuda ya nace en la venta fiada (regla 1, cuenta 1100). */
  function entriesForCollection(c, errors, out, sales) {
    const id = str(c.id || c.opId);
    if (c.tipo === "cargo") return;
    if (c.tipo !== "abono") { errors.push({ factKind: "cobro", factId: id, motivo: "tipo de cartera desconocido: " + str(c.tipo) }); return; }
    // Codex 2026-10-07: a price correction adjusts the customer facts, not cash. The canonical
    // edited sale already posts its current receivable: posting the correction
    // again here would invent cash and reduce receivables a second time.
    if (c.naturaleza === "correccion_venta") {
      const linked = (sales || []).find((v) => str(v.id) === str(c.ventaId) && str(v.clienteId) === str(c.clienteId) && str(c.clienteId));
      if (!linked) errors.push({ factKind: "cobro", factId: id, motivo: "correccion de cartera sin venta/cliente verificable" });
      return;
    }
    const m = cents(c.monto);
    if (m <= 0) { errors.push({ factKind: "cobro", factId: id, motivo: "cobro sin importe positivo" }); return; }
    const lines = [];
    addLine(lines, "1000", m);
    addLine(lines, "1100", -m);
    out.push(mkEntry("cobro", id, "", c.fecha, lines));
  }

  /* Pagos legados: ventas/ajustes viejos con `liquidada: true` y SIN pago en el libro. payout-ledger
     los cuenta como pagados; para que el saldo de 2000 coincida al centavo se asienta ese pago
     implicito (Debe 2000 / Haber 1000) con el signo del compromiso. */
  function entriesForLegacy(obligations, payouts, out) {
    const hecho = new Set();
    payouts.forEach((p) => { if (p.status === "paid") (Array.isArray(p.items) ? p.items : []).forEach((it) => hecho.add(PL.key(it.kind, it.sourceId, it.payeeId))); });
    obligations.forEach((o) => {
      if (!o.legacyPaid || hecho.has(PL.key(o.kind, o.sourceId, o.payeeId))) return;
      const amt = Math.abs(o.amountCents);
      const sign = o.signedAmountCents < 0 ? -1 : 1;
      const lines = [];
      addLine(lines, "2000", sign * amt, personExtra(o.payeeId));
      addLine(lines, "1000", -sign * amt, o.locationId ? { locationId: o.locationId } : {});
      out.push(mkEntry("pago-legacy", o.kind + ":" + o.sourceId + ":" + (o.payeeId || UNASSIGNED), "", String(o.order).split("|")[0], lines));
    });
  }

  function computeBalances(entries) {
    const accounts = {};
    ACCOUNTS.forEach((a) => { accounts[a] = { debitCents: 0, creditCents: 0, balanceCents: 0 }; });
    const byPerson = {};
    entries.forEach((e) => e.lines.forEach((l) => {
      const a = accounts[l.account];
      a.debitCents += l.debitCents; a.creditCents += l.creditCents;
      if (l.account === "2000") {
        const k = l.personId || UNASSIGNED;
        byPerson[k] = (byPerson[k] || 0) + l.creditCents - l.debitCents; // pasivo: Haber - Debe = Pendiente
      }
    }));
    ACCOUNTS.forEach((c) => {
      const a = accounts[c];
      a.balanceCents = DEBIT_NATURE.has(c) ? a.debitCents - a.creditCents : a.creditCents - a.debitCents;
    });
    return { accounts, byPerson };
  }

  function buildLedger(input) {
    const inp = input || {};
    const locations = Array.isArray(inp.ubicaciones) ? inp.ubicaciones : [];
    const errors = [];
    const raw = [];

    const ventas = dedupe(inp.ventas, (v) => str(v.id)).map((x) => x.f);
    const ajustes = dedupe(inp.ajustes, (a) => str(a.id)).map((x) => x.f);
    const payouts = dedupe(inp.payouts, (p) => str(p.opId || p.id)).map((x) => x.f);
    const gastos = dedupe(inp.gastos, (g) => str(g.id)).map((x) => x.f);
    const cartera = dedupe(inp.cartera, (c) => str(c.opId || c.id)).map((x) => x.f);

    [["venta", inp.ventas], ["ajuste", inp.ajustes], ["pago", inp.payouts], ["gasto", inp.gastos], ["cobro", inp.cartera]].forEach(([k, list]) => {
      (Array.isArray(list) ? list : []).forEach((f) => { if (f && !str(f.id || f.opId)) errors.push({ factKind: k, factId: "", motivo: "hecho sin id" }); });
    });

    const saleById = new Map(ventas.map((v) => [str(v.id),v]));
    const returnById = new Map(ajustes.filter((a) => a.tipo === "devolucion").map((a) => [str(a.id),a]));
    ventas.forEach((v) => {
      const ret = v.devuelta && returnById.get(str(v.devolucionId));
      // Date the economic reversal in the open return period, not the sale's
      // original month. Use a projection; never rewrite an input fact.
      const projected = ret && str(ret.ventaId) === str(v.id) ? Object.assign({},v,{fechaDevolucion:ret.fecha}) : v;
      if (str(v.id)) entriesForSale(projected, locations, errors, raw);
    });

    /* Compromisos por persona (sobre ventas vigentes + ajustes): sirven para ajustes y pagos legados. */
    const obs = PL.buildObligations({ sales: ventas.filter((v) => str(v.id)), adjustments: ajustes.filter((a) => str(a.id)), locations, payouts });
    ajustes.forEach((a) => {
      // A linked return already has the exact reversal of its sale above.
      // Its payout adjustment tracks collection from the partner, not a
      // second economic reversal of the same commission.
      const sale = saleById.get(str(a.ventaId));
      if (a.tipo === "devolucion" && sale && sale.devuelta && str(sale.devolucionId) === str(a.id)) return;
      if (!str(a.id)) return;
      entriesForAdjustment(a, obs.filter((o) => o.kind === "adjustment" && o.sourceId === str(a.id)), errors, raw);
    });
    entriesForLegacy(obs, payouts, raw);
    payouts.forEach((p) => { if (str(p.id)) entriesForPayout(p, errors, raw); });
    gastos.forEach((g) => { if (str(g.id)) entriesForExpense(g, errors, raw); });
    cartera.forEach((c) => { if (str(c.id || c.opId)) entriesForCollection(c, errors, raw, ventas); });

    /* Invariante (a): un asiento que no cuadra NO entra al libro; se reporta. */
    const entries = [];
    raw.forEach((e) => {
      if (balanced(e)) entries.push(e);
      else errors.push({ factKind: e.factKind, factId: e.factId, motivo: "el asiento no suma cero" });
    });

    /* Invariante (d): orden total independiente del orden de entrada. */
    const lt = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    entries.sort((a, b) => lt(a.fecha, b.fecha) || ((KIND_ORDER[a.factKind] || 0) - (KIND_ORDER[b.factKind] || 0)) || lt(a.factId, b.factId) || lt(a.id, b.id));
    errors.sort((a, b) => lt(a.factKind, b.factKind) || lt(a.factId, b.factId) || lt(a.motivo, b.motivo));

    return { entries, balances: computeBalances(entries), errors };
  }

  /* FICHA DE PRODUCTO (proyeccion pura, sin estado): quien vendio un producto y cuanto gano cada persona.
     - earned = Haber - Debe de la cuenta 2000 por persona en los asientos de VENTA (original + reverso) de ese
       producto: una venta devuelta/anulada se reversa sola y queda en 0 neto.
     - paid   = items de pagos (kind "sale") cuyo sourceId es una venta de ese producto, a esa persona. Solo
       status "paid"; un pago con reversalOf resta; "voided"/"reversed" no cuentan (misma regla que payout-ledger).
       Una venta vieja con `liquidada:true` sin hecho de pago cuenta como pagada por su parte (pago legado).
     - due    = earned - paid (puede ser negativo si se pago una venta que luego se devolvio: es un cobro a favor de la casa).
     No incluye ajustes de comision (no llevan productId): la ficha habla solo de ventas del producto.
     units/grossCents son de ventas vigentes; returnsCents es el importe de las devueltas/anuladas (linea propia). */
  function productSheet(input) {
    const inp = input || {};
    const productId = str(inp.productId);
    const ledger = inp.ledger || { entries: [] };
    const sales = (Array.isArray(inp.sales) ? inp.sales : []).filter((v) => v && str(v.id) && str(v.productoId) === productId);
    const saleIds = new Set(sales.map((v) => str(v.id)));
    const totalOf = (v) => { const c = v.cantidad == null ? 1 : Number(v.cantidad); return cents((Number(v.precioUnit) || 0) * (Number.isFinite(c) ? c : 1)); };
    const qtyOf = (v) => { const c = v.cantidad == null ? 1 : Number(v.cantidad); return Number.isFinite(c) ? c : 1; };

    const out = { productId, units: 0, grossCents: 0, returnsCents: 0, locations: [], people: [], totals: { earnedCents: 0, paidCents: 0, dueCents: 0 } };
    const locs = new Set();
    const rows = new Map();
    const row = (id) => { if (!rows.has(id)) rows.set(id, { personId: id, units: 0, grossCents: 0, earnedCents: 0, paidCents: 0, dueCents: 0, bySale: [] }); return rows.get(id); };

    /* Ganado por (venta, persona): suma de lineas 2000 de los asientos de venta del producto. */
    const share = new Map(); // saleId|person -> centavos netos
    const base = new Map();  // saleId|person -> centavos del asiento original (para el pago legado)
    (ledger.entries || []).forEach((e) => {
      if (e.factKind !== "venta" || !saleIds.has(str(e.factId))) return;
      const isRev = e.id.slice(-4) === ":rev";
      e.lines.forEach((l) => {
        if (l.account !== "2000" || !l.personId || l.productId !== productId) return;
        const k = e.factId + "|" + l.personId, c = l.creditCents - l.debitCents;
        share.set(k, (share.get(k) || 0) + c);
        if (!isRev) base.set(k, (base.get(k) || 0) + c);
      });
    });

    /* Pagado por (venta, persona) desde los items de pagos. */
    const applied = new Map();
    const facts = new Set();
    (Array.isArray(inp.payouts) ? inp.payouts : []).forEach((p) => {
      if (!p || p.status !== "paid") return;
      const sign = p.reversalOf ? -1 : 1;
      (Array.isArray(p.items) ? p.items : []).forEach((it) => {
        if (it.kind !== "sale" || !saleIds.has(str(it.sourceId))) return;
        const k = str(it.sourceId) + "|" + str(it.payeeId);
        applied.set(k, (applied.get(k) || 0) + sign * Math.max(0, Math.trunc(Number(it.amountCents) || 0)));
        facts.add(k);
      });
    });

    sales.forEach((v) => {
      locs.add(str(v.ubicacionId));
      const lost = !!(v.anulada || v.devuelta);
      if (lost) out.returnsCents += totalOf(v);
      else { out.units += qtyOf(v); out.grossCents += totalOf(v); }
      const personas = new Set();
      share.forEach((_, k) => { if (k.split("|")[0] === str(v.id)) personas.add(k.split("|")[1]); });
      personas.forEach((pid) => {
        const k = str(v.id) + "|" + pid, r = row(pid);
        if (!lost) { r.units += qtyOf(v); r.grossCents += totalOf(v); }
        r.earnedCents += share.get(k) || 0;
        let paid = applied.get(k) || 0;
        if (v.liquidada && !facts.has(k)) paid += base.get(k) || 0;
        r.paidCents += paid;
        /* Desglose por venta (para pagar SOLO este producto: la UI manda estos saleId a planPayout.sourceIds). */
        r.bySale.push({ saleId: str(v.id), locationId: str(v.ubicacionId), earnedCents: share.get(k) || 0, paidCents: paid, dueCents: (share.get(k) || 0) - paid });
      });
    });
    /* Pagos a personas sin ganancia visible en el producto (p. ej. venta devuelta) ya quedaron arriba via share=0. */
    rows.forEach((r) => { r.dueCents = r.earnedCents - r.paidCents; });
    out.locations = [...locs].filter(Boolean).sort();
    out.people = [...rows.values()].sort((a, b) => (b.earnedCents - a.earnedCents) || (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0));
    out.people.forEach((r) => { out.totals.earnedCents += r.earnedCents; out.totals.paidCents += r.paidCents; out.totals.dueCents += r.dueCents; });
    return out;
  }

  return { ACCOUNTS, buildLedger, productSheet };
});
