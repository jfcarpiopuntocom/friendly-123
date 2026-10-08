/* friendly-123 Payout Ledger v1 — pure financial core.
   No DOM, storage, network, tenant discovery or clock reads live here.
   Amounts are integer cents. Historical sale flags remain compatibility input;
   new payouts are append-only financial facts. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OCPayoutLedger = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const METHODS = new Set(["efectivo", "transferencia", "cheque", "credito-tienda", "otro"]);
  const STATUS = new Set(["paid", "voided", "reversed"]);

  function cents(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    /* toFixed(10) keeps tiny values out of exponent notation: cents(1e-7) gave NaN
       before (auditoria 2026-10-07). Values >= 1e21 also print in exponent form, so
       they use a plain multiply. */
    if (Math.abs(x) >= 1e21) return Math.round(x * 100);
    return Math.round(Number(x.toFixed(10) + "e2"));
  }
  function money(c) { return +(Number(c || 0) / 100).toFixed(2); }
  function monthOf(iso) { return String(iso || "").slice(0, 7); }
  function key(kind, id, payeeId) { return [kind, String(id || ""), String(payeeId || "__unassigned__")].join("|"); }
  // 2026-10-07: old importers know sale/adjustment only. Keep the logical
  // void identity in additive metadata, without editing any original fact.
  function itemKey(it) {
    const alias = it.kind === "adjustment" && it.voidSourceId != null &&
      String(it.sourceId) === "void-recovery:" + String(it.voidSourceId);
    return alias ? key("void", it.voidSourceId, it.payeeId) : key(it.kind, it.sourceId, it.payeeId);
  }
  function compatiblePayouts(payouts) {
    return (Array.isArray(payouts) ? payouts : []).map((p) => !p || !Array.isArray(p.items) ? p : ({ ...p,
      items: p.items.map((it) => !it ? it : it.kind !== "void" ? { ...it } :
        { ...it, kind: "adjustment", sourceId: "void-recovery:" + String(it.sourceId), voidSourceId: String(it.sourceId) })
    }));
  }
  function appliedCents(it) {
    const amount = Math.max(0, Math.trunc(Number(it.amountCents) || 0));
    // A recovered credit can become payable if its original payment is
    // reversed later. Paying that refund consumes, rather than adds, credit.
    return it.offset === false && itemKey(it) === key("void", it.voidSourceId == null ? it.sourceId : it.voidSourceId, it.payeeId) ? -amount : amount;
  }

  function payeeForSale(v, location) {
    return String((v && v.promotoraId) || (location && location.promotoraId) || "") || null;
  }

  function obligationsForSale(v, location) {
    // A paid return keeps its original earning/payment; its dated negative
    // adjustment reverses the earning. Dropping both loses paid history.
    if (!v || !v.id || !v.split || v.anulada) return [];
    const reparto = Array.isArray(v.split.reparto) ? v.split.reparto.filter(Boolean) : [];
    if (reparto.length) {
      return reparto.map((r, i) => ({
        kind: "sale", sourceId: String(v.id), payeeId: String(r.promotoraId || "") || null,
        amountCents: cents(r.monto), order: String(v.fecha || "") + "|" + String(i).padStart(4, "0"),
        locationId: String(v.ubicacionId || ""), legacyPaid: !!v.liquidada
      })).filter((x) => x.amountCents !== 0);
    }
    return [{
      kind: "sale", sourceId: String(v.id), payeeId: payeeForSale(v, location),
      amountCents: cents(v.split.montoComisionSocio), order: String(v.fecha || "") + "|0000",
      locationId: String(v.ubicacionId || ""), legacyPaid: !!v.liquidada
    }].filter((x) => x.amountCents !== 0);
  }

  function obligationsForAdjustment(a, sale, location) {
    if (!a || !a.id) return [];
    const reparto = Array.isArray(a.reparto) ? a.reparto.filter(Boolean) : [];
    if (reparto.length) {
      return reparto.map((r, i) => ({
        kind: "adjustment", sourceId: String(a.id), payeeId: String(r.promotoraId || "") || null,
        amountCents: cents(r.monto), order: String(a.fecha || "") + "|" + String(i).padStart(4, "0"),
        locationId: String(a.ubicacionId || ""), legacyPaid: !!a.liquidada
      })).filter((x) => x.amountCents !== 0);
    }
    return [{
      kind: "adjustment", sourceId: String(a.id), payeeId: payeeForSale(sale, location),
      amountCents: cents(a.montoComisionSocio), order: String(a.fecha || "") + "|0000",
      locationId: String(a.ubicacionId || ""), legacyPaid: !!a.liquidada
    }].filter((x) => x.amountCents !== 0);
  }

  function payoutAppliedMap(payouts) {
    const paid = new Map();
    (Array.isArray(payouts) ? payouts : []).forEach((p) => {
      if (!p || !p.id || p.status !== "paid" || p.reversalOf) return;
      (Array.isArray(p.items) ? p.items : []).forEach((it) => {
        const k = itemKey(it);
        paid.set(k, (paid.get(k) || 0) + appliedCents(it));
      });
    });
    /* A reversal is append-only: it restores exactly the amounts listed. */
    (Array.isArray(payouts) ? payouts : []).forEach((p) => {
      if (!p || p.status !== "paid" || !p.reversalOf) return;
      (Array.isArray(p.items) ? p.items : []).forEach((it) => {
        const k = itemKey(it);
        paid.set(k, (paid.get(k) || 0) - appliedCents(it));
      });
    });
    // Sum every signed reversal before projecting the legacy nonnegative
    // balance. Clamping each intermediate step makes sync arrival order
    // change the result when a recovery and its refund are both reversed.
    paid.forEach((amount, k) => paid.set(k, Math.max(0, amount)));
    return paid;
  }

  /* INVARIANTE DEL LIBRO (auditoria 2026-10-07, punto 3). Por cada (tipo, fuente, persona):
     lo revertido nunca supera lo pagado. payoutAppliedMap sigue topando en 0 para que la
     pantalla no se caiga con un libro viejo, pero ese tope ya no es silencioso: esta funcion
     lista cada violacion y el backend RECHAZA cualquier escritura que agregue una nueva.
     Devuelve [{ key, paidCents, reversedCents }]. Lista vacia = libro sano. */
  function ledgerAnomalies(payouts) {
    const paid = new Map(), reversed = new Map();
    (Array.isArray(payouts) ? payouts : []).forEach((p) => {
      if (!p || p.status !== "paid") return;
      const dest = p.reversalOf ? reversed : paid;
      (Array.isArray(p.items) ? p.items : []).forEach((it) => {
        const k = itemKey(it);
        dest.set(k, (dest.get(k) || 0) + Math.max(0, Math.trunc(Number(it.amountCents) || 0)));
      });
    });
    const out = [];
    reversed.forEach((r, k) => { const pc = paid.get(k) || 0; if (r > pc) out.push({ key:k, paidCents:pc, reversedCents:r }); });
    return out;
  }

  function hasLedgerFact(payouts, obligation) {
    const k = key(obligation.kind, obligation.sourceId, obligation.payeeId);
    return (Array.isArray(payouts) ? payouts : []).some((p) => p && p.status === "paid" && (Array.isArray(p.items) ? p.items : []).some((it) => key(it.kind, it.sourceId, it.payeeId) === k));
  }

  function buildObligations(input) {
    const sales = Array.isArray(input && input.sales) ? input.sales : [];
    const adjustments = Array.isArray(input && input.adjustments) ? input.adjustments : [];
    const locations = Array.isArray(input && input.locations) ? input.locations : [];
    const payouts = Array.isArray(input && input.payouts) ? input.payouts : [];
    const month = String(input && input.month || "");
    const locationId = input && input.locationId != null ? String(input.locationId) : null;
    const locMap = new Map(locations.map((u) => [String(u.id), u]));
    const saleMap = new Map(sales.map((v) => [String(v.id), v]));
    const applied = payoutAppliedMap(payouts);
    const out = [];
    /* RETENCION ANTES DE PAGAR (JFC 2026-10-07: "dale choices al usuario"). El dueno elige
       0 (apagado, como siempre), 7, 14 o 30 dias. Una venta mas nueva que esos dias todavia
       no se puede pagar: su saldo va a heldCents (con heldUntil), nunca a dueCents, asi ni la
       tarjeta ni el boton de pago la ofrecen. El core sigue sin reloj: asOf lo pone el shell. */
    const holdDays = Math.max(0, Math.floor(Number(input && input.holdDays) || 0));
    const asOfMs = Date.parse(String(input && input.asOf || ""));
    const holdUntil = (fecha) => {
      if (!holdDays || !Number.isFinite(asOfMs)) return null;
      const t = Date.parse(String(fecha || ""));
      if (!Number.isFinite(t)) return null;
      const until = t + holdDays * 86400000;
      return until > asOfMs ? new Date(until).toISOString() : null;
    };

    sales.forEach((v) => {
      if (!v || !v.split || v.anulada) return;
      if (month && monthOf(v.fecha) !== month) return;
      if (locationId && String(v.ubicacionId) !== locationId) return;
      obligationsForSale(v, locMap.get(String(v.ubicacionId))).forEach((o) => {
        const total = Math.abs(o.amountCents);
        const legacy = o.legacyPaid && !hasLedgerFact(payouts, o) ? total : 0;
        const byPayout = applied.get(key(o.kind, o.sourceId, o.payeeId)) || 0;
        const paidCents = Math.min(total, legacy + byPayout);
        const dueCents = Math.max(0, total - paidCents);
        const hold = o.amountCents > 0 && dueCents > 0 ? holdUntil(v.fecha) : null;
        if (hold) { out.push({ ...o, paidCents, dueCents: 0, heldCents: dueCents, heldUntil: hold, signedAmountCents: o.amountCents }); return; }
        out.push({ ...o, paidCents, dueCents, signedAmountCents: o.amountCents });
      });
    });

    /* VENTA ANULADA DESPUES DE PAGARSE (JFC 2026-10-07: "descontar del proximo pago").
       La app ya bloquea anular/cancelar una venta pagada (pide "Return"), pero dos aparatos
       pueden cruzarse: uno paga y otro anula antes de ver el pago por el sync. Antes esa
       plata se perdia del libro (ledger.js si la registraba como deuda de la persona). Ahora
       lo pagado por el libro vuelve como un descuento "void" (negativo) en el mes de la
       anulacion y queda disponible en los periodos siguientes hasta consumirse. Los pagos
       legacy cuentan solo cuando no existe un hecho del libro que los sustituya. */
    sales.forEach((v) => {
      if (!v || !v.split || !v.anulada) return;
      const fVoid = v.anuladaEn || v.canceladaExPostEn || v.fecha;
      if (month && monthOf(fVoid) > month) return;
      if (locationId && String(v.ubicacionId) !== locationId) return;
      obligationsForSale(Object.assign({}, v, { anulada: false }), locMap.get(String(v.ubicacionId))).forEach((s) => {
        if (s.amountCents <= 0) return;
        const legacy = s.legacyPaid && !hasLedgerFact(payouts, s) ? s.amountCents : 0;
        const paidSale = legacy + (applied.get(key("sale", s.sourceId, s.payeeId)) || 0);
        const recovered = applied.get(key("void", s.sourceId, s.payeeId)) || 0;
        if (paidSale <= 0 && recovered <= 0) return;
        out.push({ kind: "void", sourceId: s.sourceId, payeeId: s.payeeId, amountCents: -paidSale,
          order: String(fVoid) + "|" + String(s.order).split("|")[1], locationId: s.locationId, legacyPaid: false,
          paidCents: recovered, dueCents: (recovered - paidSale) || 0, signedAmountCents: -paidSale });
      });
    });

    adjustments.forEach((a) => {
      if (!a) return;
      if (month && monthOf(a.fecha) !== month) return;
      if (locationId && String(a.ubicacionId) !== locationId) return;
      const sale = saleMap.get(String(a.ventaId || ""));
      obligationsForAdjustment(a, sale, locMap.get(String(a.ubicacionId))).forEach((o) => {
        /* Negative adjustments reduce the next amount due; they are not themselves
           a cash payout. They remain pending until a payout consumes the net balance. */
        const abs = Math.abs(o.amountCents);
        const legacy = o.legacyPaid && !hasLedgerFact(payouts, o) ? abs : 0;
        const byPayout = applied.get(key(o.kind, o.sourceId, o.payeeId)) || 0;
        const paidCents = Math.min(abs, legacy + byPayout);
        const remainder = Math.max(0, abs - paidCents);
        out.push({ ...o, paidCents, dueCents: o.amountCents < 0 ? -remainder : remainder, signedAmountCents: o.amountCents });
      });
    });
    return out.sort((a,b) => a.order.localeCompare(b.order) || a.sourceId.localeCompare(b.sourceId));
  }

  /* v454 (ficha de producto): `input.sourceIds` (lista de ids de venta) restringe el calculo a ESAS ventas
     (kind "sale"). Sin la lista todo funciona como siempre. Con ella, el saldo, planPayout y el reparto de items
     solo ven esas ventas y los creditos por anulacion que deben reducir el proximo pago.
     Las ventas positivas del producto B y los ajustes normales quedan intactos. */
  function balancesByPayee(input) {
    let obs = buildObligations(input);
    const only = Array.isArray(input && input.sourceIds) ? new Set(input.sourceIds.map(String)) : null;
    if (only) obs = obs.filter((o) => (o.kind === "sale" && only.has(String(o.sourceId))) || o.kind === "void");
    const map = new Map();
    obs.forEach((o) => {
      const pid = o.payeeId || null;
      const k = String(pid || "__unassigned__");
      const row = map.get(k) || { payeeId: pid, dueCents: 0, earnedCents: 0, paidCents: 0, heldCents: 0, heldUntil: null, obligations: [] };
      row.heldCents += Number(o.heldCents) || 0;
      if (o.heldUntil && (!row.heldUntil || o.heldUntil < row.heldUntil)) row.heldUntil = o.heldUntil; // la proxima que se libera
      row.earnedCents += o.signedAmountCents;
      row.paidCents += o.paidCents * (o.kind === "void" || o.signedAmountCents < 0 ? -1 : 1);
      row.dueCents += o.dueCents;
      row.obligations.push(o);
      map.set(k,row);
    });
    return [...map.values()].map((r) => ({...r, earned:money(r.earnedCents), paid:money(r.paidCents), due:money(r.dueCents), held:money(r.heldCents)}));
  }

  function planPayout(input) {
    const opId = String(input && input.opId || "").trim();
    if (!opId) return { error:"opId is required.", status:400 };
    const existing = (Array.isArray(input.payouts) ? input.payouts : []).find((p) => String(p.opId || "") === opId);
    if (existing) {
      /* Misma clave con otra persona u otro monto = error, no el pago viejo (auditoria 2026-10-07, punto 2). */
      const pid = input.payeeId == null ? null : String(input.payeeId);
      if ((existing.payeeId || null) !== pid || (input.amountCents != null && Number(input.amountCents) !== Number(existing.amountCents))) {
        return { error:"This payment key was already used for a different payment.", status:409 };
      }
      return { existing:true, payout:existing };
    }

    const payeeId = input.payeeId == null ? null : String(input.payeeId);
    const rows = balancesByPayee(input).filter((r) => (r.payeeId || null) === payeeId);
    if (!rows.length) return { error:"There is nothing due to this payee for this period.", status:409 };
    const row = rows[0];
    if (row.dueCents <= 0) return { error:"There is no positive amount due to record as paid.", status:409 };

    const rawAmount = input.amountCents == null ? row.dueCents : Number(input.amountCents);
    if (!Number.isSafeInteger(rawAmount) || rawAmount <= 0) return { error:"Payment amount must be positive safe whole cents.", status:400 };
    const amountCents = rawAmount;
    if (amountCents > row.dueCents) return { error:"Payment amount cannot exceed the current amount due.", status:409 };

    const rawMethod = input.method == null || input.method === "" ? null : String(input.method);
    const method = rawMethod == null ? null : (METHODS.has(rawMethod) ? rawMethod : "otro");
    const positive = row.obligations.filter((o) => o.dueCents > 0);
    const negative = row.obligations.filter((o) => o.dueCents < 0);
    const items = [];
    negative.forEach((o) => items.push({kind:o.kind,sourceId:o.sourceId,payeeId:o.payeeId,amountCents:Math.abs(o.dueCents),offset:true}));
    /* Negative adjustments are credits, so consume them before cash. A partial
       cash payment covers exactly cash + those credits, leaving the rest due. */
    let remaining = amountCents + negative.reduce((a,o)=>a+Math.abs(o.dueCents),0);
    positive.forEach((o) => {
      if (remaining <= 0) return;
      const take = Math.min(o.dueCents, remaining);
      if (take > 0) items.push({kind:o.kind,sourceId:o.sourceId,payeeId:o.payeeId,amountCents:take,...(o.kind === "void" ? {offset:false} : {})});
      remaining -= take;
    });
    if (remaining !== 0) return { error:"Could not reconcile payout items to the amount due.", status:409 };

    const payout = {
      id:String(input.id || ""), opId, status:"paid", payeeId,
      payeeName:String(input.payeeName || ""), payeeType:String(input.payeeType || "associate"),
      locationId:String(input.locationId || ""), period:String(input.period || input.month || ""),
      amountCents, amount:money(amountCents), method,
      reference:String(input.reference || "").trim().slice(0,120),
      note:String(input.note || "").trim().slice(0,240),
      paidAt:String(input.paidAt || ""), paidBy:String(input.paidBy || ""),
      items
    };
    return { payout };
  }

  function payoutStatus(p) {
    if (!p || !STATUS.has(String(p.status))) return "invalid";
    return p.status;
  }

  return { cents, money, key, buildObligations, balancesByPayee, planPayout, payoutStatus, ledgerAnomalies, compatiblePayouts };
});
