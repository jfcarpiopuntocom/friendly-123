export type Locale = "en" | "es" | "pt";
export type Color = "red" | "orange" | "black" | "yellow" | "green";

export interface InventoryItemInput {
  name: string;
  stock: number;
  redAt?: number;
  lowAt?: number;
  price?: number;
  cost?: number;
  daysSinceLastSale?: number;
  expiresInDays?: number;
}

export interface ClassifiedItem {
  name: string;
  stock: number;
  color: Color;
  level: 1 | 2 | 3;
  label: string;
  reasonCode: string;
  reasonParams: Record<string, number>;
  why: string;
}

const ORDER: Record<Color, number> = { red: 0, orange: 1, black: 2, yellow: 3, green: 4 };

const LABELS: Record<Locale, Record<Color, string>> = {
  en: { red: "Urgent", orange: "Low", black: "Dead weight", yellow: "Star", green: "Healthy" },
  es: { red: "Urgente", orange: "Bajo", black: "Peso muerto", yellow: "Estrella", green: "Sano" },
  pt: { red: "Urgente", orange: "Baixo", black: "Estoque parado", yellow: "Estrela", green: "Saudável" }
};

function localeOf(value?: string): Locale {
  const v = String(value ?? "en").toLowerCase();
  if (v.startsWith("es")) return "es";
  if (v.startsWith("pt")) return "pt";
  return "en";
}

function finite(value: unknown, fallback: number | null = null): number | null {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function message(locale: Locale, code: string, p: Record<string, number>): string {
  const n = p.n;
  const pct = p.pct;
  const m: Record<Locale, Record<string, string>> = {
    en: {
      out: "Out of stock",
      red: `Only ${n} left: reorder now`,
      low: `Getting low (${n} left)`,
      dormant: `No sale in ${n} days: review discount, bundle, return, or exit options`,
      margin: `Strong gross margin (${pct}%): keep it visible`,
      healthy: "Healthy",
      expired: `Expired ${n} day(s) ago: remove it from sale`,
      expiresSoon: `Expires in ${n} day(s): sell it now`,
      expiresFirst: `Expires in ${n} days: sell it first`
    },
    es: {
      out: "Sin stock",
      red: `Queda ${n}: repón ahora`,
      low: `Queda poco (${n})`,
      dormant: `Sin venta en ${n} días: revisa descuento, combo, devolución o salida`,
      margin: `Margen bruto fuerte (${pct}%): mantenlo visible`,
      healthy: "Sano",
      expired: `Venció hace ${n} día(s): retíralo de la venta`,
      expiresSoon: `Vence en ${n} día(s): véndelo ya`,
      expiresFirst: `Vence en ${n} días: véndelo primero`
    },
    pt: {
      out: "Sem estoque",
      red: `Resta ${n}: reponha agora`,
      low: `Estoque baixo (${n})`,
      dormant: `Sem venda há ${n} dias: revise desconto, combo, devolução ou saída`,
      margin: `Margem bruta forte (${pct}%): mantenha visível`,
      healthy: "Saudável",
      expired: `Venceu há ${n} dia(s): retire da venda`,
      expiresSoon: `Vence em ${n} dia(s): venda agora`,
      expiresFirst: `Vence em ${n} dias: venda primeiro`
    }
  };
  return m[locale][code] ?? code;
}

export function classifyInventoryItem(input: InventoryItemInput, localeInput: string = "en"): ClassifiedItem {
  const locale = localeOf(localeInput);
  const stock = finite(input.stock, 0) ?? 0;
  const redAt = Math.max(0, finite(input.redAt, 1) ?? 1);
  const lowAt = Math.max(finite(input.lowAt, 3) ?? 3, redAt);
  const price = finite(input.price, 0) ?? 0;
  const cost = finite(input.cost, 0) ?? 0;
  const idle = finite(input.daysSinceLastSale, null);
  const expiry = finite(input.expiresInDays, null);
  const margin = price > 0 ? (price - cost) / price : 0;

  let base: { color: Color; level: 1 | 2 | 3; code: string; params: Record<string, number> };
  if (stock <= 0) {
    base = { color: "red", level: 3, code: "out", params: {} };
  } else if (stock <= redAt) {
    base = { color: "red", level: stock <= Math.ceil(redAt / 2) ? 2 : 1, code: "red", params: { n: stock } };
  } else if (stock <= lowAt) {
    const diff = stock - redAt;
    base = { color: "orange", level: diff <= 1 ? 3 : diff <= 3 ? 2 : 1, code: "low", params: { n: stock } };
  } else if (idle !== null && idle >= 45) {
    base = { color: "black", level: idle >= 120 ? 3 : idle >= 60 ? 2 : 1, code: "dormant", params: { n: idle } };
  } else if (margin >= 0.5) {
    base = { color: "yellow", level: margin >= 0.70 ? 3 : margin >= 0.55 ? 2 : 1, code: "margin", params: { pct: Math.round(margin * 100) } };
  } else {
    base = { color: "green", level: stock >= 15 ? 3 : stock >= 7 ? 2 : 1, code: "healthy", params: {} };
  }

  let exp: typeof base | null = null;
  if (expiry !== null) {
    if (expiry < 0) exp = { color: "red", level: 3, code: "expired", params: { n: Math.abs(expiry) } };
    else if (expiry <= 3) exp = { color: "red", level: expiry <= 1 ? 3 : 2, code: "expiresSoon", params: { n: expiry } };
    else if (expiry <= 7) exp = { color: "orange", level: expiry <= 5 ? 2 : 1, code: "expiresFirst", params: { n: expiry } };
  }

  const chosen = exp && ORDER[exp.color] <= ORDER[base.color] ? exp : base;
  return {
    name: String(input.name || "Item").slice(0, 120),
    stock,
    color: chosen.color,
    level: chosen.level,
    label: LABELS[locale][chosen.color],
    reasonCode: chosen.code,
    reasonParams: chosen.params,
    why: message(locale, chosen.code, chosen.params)
  };
}

export function classifyInventory(items: InventoryItemInput[], localeInput: string = "en") {
  const locale = localeOf(localeInput);
  const list = items.slice(0, 500).map((item) => classifyInventoryItem(item, locale));
  list.sort((a, b) => ORDER[a.color] - ORDER[b.color] || b.level - a.level || a.name.localeCompare(b.name));
  const counts = { red: 0, orange: 0, black: 0, yellow: 0, green: 0 } as Record<Color, number>;
  for (const item of list) counts[item.color] += 1;
  return {
    locale,
    items: list,
    counts,
    assumptions: {
      defaultRedAt: 1,
      defaultLowAt: 3,
      deadWeightDays: 45,
      starGrossMarginPct: 50,
      expiryRedDays: 3,
      expiryOrangeDays: 7
    }
  };
}
