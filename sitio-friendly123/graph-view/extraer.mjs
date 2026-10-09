// GRAPH VIEW: extractor (Claude, JFC 2026-10-07). Lee el codigo de la app (docs/) con un parser real de
// JavaScript (acorn), incluido todo el JS dentro de index.html y dashboard.html, y arma dos grafos:
//   app   = modulos (archivos) y pantallas (vista-*, dashboard), con las llamadas entre modulos.
//   money = funciones de dinero (ventas, comisiones, pagos, anulaciones, retencion, caja) + 1 salto,
//           con sus pantallas y los tests que las nombran.
// Decision de JFC 2026-10-07: la version PUBLICA (friendly123.com/graph-view/) va SIN lista de riesgos
// ni duplicados. Por eso este archivo no calcula "risk" ni "dup": eso queda para el panel lord.
// Lo usa build.mjs en cada publicacion, asi el grafo siempre refleja el docs/ del mismo commit.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const acorn = require("acorn"), walk = require("acorn-walk");

// Vocabulario de dinero (codigo en espanol + UI en ingles). "iva" solo como palabra suelta:
// dentro de "activar" o "derivarClave" daba falsos positivos.
const MONEY = /(venta|vender|vendid|sale|sold|comisi|commission|payout|pago|pagar|paid|pay\b|abono|fiado|deuda|debt|credit|caja|cash|precio|price|cortes|anula|void|reembol|refund|retenc|hold|ledger|dinero|money|cents|monto|amount|split|reparto|margen|margin|ganancia|profit|gasto|expense|cobr|liquid|saldo|balance|total|descuento|discount|\biva\b|impuesto)/i;
const STRONG = /(comisi|commission|payout|ledger|abono|fiado|anula|void|retenc|reparto|split|liquid|saldo|cobr|cortes)/i;
const SIN_COMENTARIOS = (s) => s.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, " "));

export function extraer(repo) {
  const DOCS = join(repo, "docs");
  const idx = readFileSync(join(DOCS, "index.html"), "utf8");
  const idxLimpio = SIN_COMENTARIOS(idx);
  const files = [];
  const addJs = (rel) => { const f = join(DOCS, rel); if (existsSync(f)) files.push({ rel: "docs/" + rel, code: readFileSync(f, "utf8"), lineOff: 0 }); };
  const cargados = [...idxLimpio.matchAll(/<script[^>]*src="\.?\/?([^"?#]+\.js)/g)].map((m) => m[1]);
  // Los 4 scripts que pide cargador.js (lista OC-CARGADOR-LISTA) no aparecen como <script src>.
  const lista = (idx.match(/var lista = \[([^\]]*)\]; \/\* OC-CARGADOR-LISTA/) || [, ""])[1].match(/[\w./-]+\.js/g) || [];
  lista.forEach((x) => cargados.push(x.replace(/^\.\//, "")));
  const dominio = ["core", "application"].flatMap((d) => existsSync(join(DOCS, d)) ? readdirSync(join(DOCS, d)).map((f) => d + "/" + f) : []);
  new Set([...cargados, ...dominio]).forEach(addJs);
  for (const html of ["index.html", "dashboard.html"]) {
    const src = SIN_COMENTARIOS(readFileSync(join(DOCS, html), "utf8"));
    for (const m of src.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g)) {
      files.push({ rel: "docs/" + html, code: m[1], lineOff: src.slice(0, m.index).split("\n").length - 1 });
    }
  }
  // Pantallas: rango de cada <section id="vista-*"> de index.html; los ids de adentro son de esa pantalla.
  const vistas = [...idx.matchAll(/id="(vista-[a-z]+)"/g)].map((m) => ({ id: m[1], at: m.index }));
  const idToScreen = Object.create(null);
  for (const m of idx.matchAll(/\bid="([A-Za-z][\w-]*)"/g)) {
    let scr = null; for (const v of vistas) if (v.at <= m.index) scr = v.id;
    if (scr && !idToScreen[m[1]]) idToScreen[m[1]] = scr;
  }
  vistas.forEach((v) => { idToScreen[v.id] = v.id; });

  const fns = [], fallas = [];
  const OPTS = { ecmaVersion: "latest", locations: true, allowReturnOutsideFunction: true, allowHashBang: true, allowAwaitOutsideFunction: true };
  for (const f of files) {
    let ast;
    try { ast = acorn.parse(f.code, { ...OPTS, sourceType: "script" }); }
    catch { try { ast = acorn.parse(f.code, { ...OPTS, sourceType: "module" }); } catch (e) { fallas.push(f.rel + ": " + e.message); continue; } }
    const push = (name, node) => { if (name && name.length >= 3) fns.push({ name, file: f.rel, line: f.lineOff + node.loc.start.line, node, body: f.code.slice(node.start, node.end), calls: new Set(), ids: new Set() }); };
    walk.full(ast, (n) => {
      if (n.type === "FunctionDeclaration" && n.id) push(n.id.name, n);
      else if (n.type === "VariableDeclarator" && n.id.type === "Identifier" && n.init && /Function/.test(n.init.type)) push(n.id.name, n.init);
      else if (n.type === "AssignmentExpression" && /Function/.test(n.right.type) && n.left.type === "MemberExpression" && !n.left.computed) push(n.left.property.name, n.right);
      else if ((n.type === "Property" || n.type === "MethodDefinition") && n.value && /Function/.test(n.value.type) && n.key && (n.key.name || n.key.value)) push(String(n.key.name || n.key.value), n.value);
    });
  }
  for (const fn of fns) {
    walk.full(fn.node, (n) => {
      if (n.type === "CallExpression") {
        const c = n.callee; const nm = c.type === "Identifier" ? c.name : (c.type === "MemberExpression" && !c.computed ? c.property.name : null);
        if (nm && nm !== fn.name) fn.calls.add(nm);
      }
      if (n.type === "Literal" && typeof n.value === "string") {
        const v = n.value.replace(/^#/, "");
        if (idToScreen[v]) fn.ids.add(v);
        for (const m of n.value.matchAll(/#([A-Za-z][\w-]*)/g)) if (idToScreen[m[1]]) fn.ids.add(m[1]);
      }
    });
    delete fn.node;
  }
  const byName = Object.create(null);
  fns.forEach((f) => { f.id = f.file + "::" + f.name + "@" + f.line; (byName[f.name] = byName[f.name] || []).push(f); });
  const resolve = (caller, name) => { const c = byName[name]; if (!c) return []; const same = c.filter((x) => x.file === caller.file); return same.length ? same : (c.length <= 2 ? c : []); };
  const layer = (file) => file.includes("/core/") ? "core" : file.includes("/application/") ? "app" : /mock-backend|pocketbase-client/.test(file) ? "backend" : file.endsWith("dashboard.html") ? "dashboard" : /sync|crypto|idb|storage|estado|backup|red-segura/.test(file) ? "sync" : file.endsWith("index.html") ? "ui" : "js";

  // ---------- grafo de la app: modulos + pantallas ----------
  const mods = new Map();
  for (const f of fns) {
    const m = mods.get(f.file) || { id: f.file, name: f.file.replace("docs/", ""), kind: "module", layer: layer(f.file), fns: 0, money: 0, screens: new Set() };
    m.fns++; if (MONEY.test(f.name)) m.money++; f.ids.forEach((i) => m.screens.add(idToScreen[i])); mods.set(f.file, m);
  }
  const peso = new Map();
  for (const f of fns) for (const nm of f.calls) for (const g of resolve(f, nm)) if (g.file !== f.file) { const k = f.file + "|" + g.file; peso.set(k, (peso.get(k) || 0) + 1); }
  const appNodes = [...mods.values()].map((m) => ({ ...m, screens: [...m.screens] }));
  vistas.forEach((v) => appNodes.push({ id: v.id, name: v.id, kind: "screen", layer: "screen" }));
  appNodes.push({ id: "dashboard", name: "dashboard", kind: "screen", layer: "screen" });
  const appLinks = [...peso].map(([k, w]) => { const [s, t] = k.split("|"); return { source: s, target: t, kind: "calls", w }; });
  for (const m of mods.values()) { for (const s of m.screens) appLinks.push({ source: s, target: m.id, kind: "screen", w: 1 }); if (m.id.endsWith("dashboard.html")) appLinks.push({ source: "dashboard", target: m.id, kind: "screen", w: 1 }); }

  // ---------- grafo del dinero ----------
  for (const f of fns) { const strong = STRONG.test(f.name), hit = MONEY.test(f.name); const body = (f.body.match(new RegExp(MONEY.source, "gi")) || []).length; f.money = strong ? 3 : hit ? 2 : body >= 6 ? 1 : 0; }
  const keep = new Set(fns.filter((f) => f.money > 0).map((f) => f.id));
  for (const f of fns) for (const nm of f.calls) for (const g of resolve(f, nm)) { if (keep.has(f.id) && g.money >= 1) keep.add(g.id); if (g.money >= 2 && f.ids.size) keep.add(f.id); }
  const tests = {};
  const tdir = join(repo, "test");
  if (existsSync(tdir)) for (const t of readdirSync(tdir)) if (/\.(c?js|mjs)$/.test(t)) tests["test/" + t] = readFileSync(join(tdir, t), "utf8");
  const mNodes = [], mLinks = [], vistos = new Set();
  const kept = fns.filter((f) => keep.has(f.id));
  for (const f of kept) {
    const cubre = Object.entries(tests).filter(([, src]) => new RegExp("\\b" + f.name.replace(/\$/g, "\\$") + "\\b").test(src)).map(([t]) => t);
    const scr = [...new Set([...f.ids].map((i) => idToScreen[i]))];
    mNodes.push({ id: f.id, name: f.name, file: f.file, line: f.line, kind: "fn", layer: layer(f.file), money: f.money, testFiles: cubre.slice(0, 6), screens: scr });
    for (const t of cubre) { if (!vistos.has(t)) { vistos.add(t); mNodes.push({ id: t, name: t.replace("test/", ""), kind: "test", layer: "test" }); } mLinks.push({ source: t, target: f.id, kind: "covers" }); }
    for (const s of scr) { if (!vistos.has(s)) { vistos.add(s); mNodes.push({ id: s, name: s, kind: "screen", layer: "screen" }); } mLinks.push({ source: s, target: f.id, kind: "screen" }); }
  }
  const dash = kept.filter((f) => f.file.endsWith("dashboard.html"));
  if (dash.length) { mNodes.push({ id: "dashboard", name: "dashboard", kind: "screen", layer: "screen" }); dash.forEach((f) => mLinks.push({ source: "dashboard", target: f.id, kind: "screen" })); }
  for (const f of kept) for (const nm of f.calls) for (const g of resolve(f, nm)) if (keep.has(g.id)) mLinks.push({ source: f.id, target: g.id, kind: "calls" });
  // Ultima pasada: cada enlace apunta a un nodo existente (3d-force-graph falla con enlaces huerfanos).
  const okApp = new Set(appNodes.map((n) => n.id)), okMoney = new Set(mNodes.map((n) => n.id));
  return {
    stats: { files: files.length, functions: fns.length, modules: mods.size, screens: vistas.length + 1, moneyFunctions: kept.length, tests: Object.keys(tests).length, parseFailures: fallas },
    app: { nodes: appNodes, links: appLinks.filter((l) => okApp.has(l.source) && okApp.has(l.target)) },
    money: { nodes: mNodes, links: mLinks.filter((l) => okMoney.has(l.source) && okMoney.has(l.target)) },
  };
}
