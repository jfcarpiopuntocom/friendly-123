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
    return Math.round(Number(Math.round(x + "e2") + "e-2") * 100);
  }
  function money(c) { return +(Number(c || 0) / 100).toFixed(2); }
  function monthOf(iso) { return String(iso || "").slice(0, 7); }
  function key(kind, id, payeeId) { return [kind, String(id || ""), String(payeeId || "__unassigned__")].join("|"); }

  function payeeForSale(v, location) {
    return String((v && v.promotoraId) || (location && location.promotoraId) || "") || null;
  }

  function obligationsForSale(v, location) {
    if (!v || !v.id || !v.split || v.anulada || v.devuelta) return [];
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
        const k = key(it.kind, it.sourceId, it.payeeId);
        paid.set(k, (paid.get(k) || 0) + Math.max(0, Math.trunc(Number(it.amountCents) || 0)));
      });
    });
    /* A reversal is append-only: it restores exactly the amounts listed. */
    (Array.isArray(payouts) ? payouts : []).forEach((p) => {
      if (!p || p.status !== "paid" || !p.reversalOf) return;
      (Array.isArray(p.items) ? p.items : []).forEach((it) => {
        const k = key(it.kind, it.sourceId, it.payeeId);
        paid.set(k, Math.max(0, (paid.get(k) || 0) - Math.max(0, Math.trunc(Number(it.amountCents) || 0))));
      });
    });
    return paid;
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

    sales.forEach((v) => {
      if (!v || !v.split || v.anulada || v.devuelta) return;
      if (month && monthOf(v.fecha) !== month) return;
      if (locationId && String(v.ubicacionId) !== locationId) return;
      obligationsForSale(v, locMap.get(String(v.ubicacionId))).forEach((o) => {
        const total = Math.abs(o.amountCents);
        const legacy = o.legacyPaid && !hasLedgerFact(payouts, o) ? total : 0;
        const byPayout = applied.get(key(o.kind, o.sourceId, o.payeeId)) || 0;
        const paidCents = Math.min(total, legacy + byPayout);
        out.push({ ...o, paidCents, dueCents: Math.max(0, total - paidCents), signedAmountCents: o.amountCents });
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

  function balancesByPayee(input) {
    const obs = buildObligations(input);
    const map = new Map();
    obs.forEach((o) => {
      const pid = o.payeeId || null;
      const k = String(pid || "__unassigned__");
      const row = map.get(k) || { payeeId: pid, dueCents: 0, earnedCents: 0, paidCents: 0, obligations: [] };
      row.earnedCents += o.signedAmountCents;
      row.paidCents += o.paidCents * (o.signedAmountCents < 0 ? -1 : 1);
      row.dueCents += o.dueCents;
      row.obligations.push(o);
      map.set(k,row);
    });
    return [...map.values()].map((r) => ({...r, earned:money(r.earnedCents), paid:money(r.paidCents), due:money(r.dueCents)}));
  }

  function planPayout(input) {
    const opId = String(input && input.opId || "").trim();
    if (!opId) return { error:"opId is required.", status:400 };
    const existing = (Array.isArray(input.payouts) ? input.payouts : []).find((p) => String(p.opId || "") === opId);
    if (existing) return { existing:true, payout:existing };

    const payeeId = input.payeeId == null ? null : String(input.payeeId);
    const rows = balancesByPayee(input).filter((r) => (r.payeeId || null) === payeeId);
    if (!rows.length) return { error:"There is nothing due to this payee for this period.", status:409 };
    const row = rows[0];
    if (row.dueCents <= 0) return { error:"There is no positive amount due to record as paid.", status:409 };

    const amountCents = input.amountCents == null ? row.dueCents : Math.trunc(Number(input.amountCents));
    if (!Number.isInteger(amountCents) || amountCents <= 0) return { error:"Payment amount must be positive whole cents.", status:400 };
    if (amountCents !== row.dueCents) return { error:"Payout Ledger v1 records the full current amount due; partial payouts are reserved for the next compatibility step.", status:409 };

    const rawMethod = input.method == null || input.method === "" ? null : String(input.method);
    const method = rawMethod == null ? null : (METHODS.has(rawMethod) ? rawMethod : "otro");
    const positive = row.obligations.filter((o) => o.dueCents > 0);
    const negative = row.obligations.filter((o) => o.dueCents < 0);
    const items = [];
    negative.forEach((o) => items.push({kind:o.kind,sourceId:o.sourceId,payeeId:o.payeeId,amountCents:Math.abs(o.dueCents),offset:true}));
    let remaining = row.dueCents + negative.reduce((a,o)=>a+Math.abs(o.dueCents),0);
    positive.forEach((o) => {
      if (remaining <= 0) return;
      const take = Math.min(o.dueCents, remaining);
      if (take > 0) items.push({kind:o.kind,sourceId:o.sourceId,payeeId:o.payeeId,amountCents:take});
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

  return { cents, money, key, buildObligations, balancesByPayee, planPayout, payoutStatus };
});
