// check-intl.mjs: prueba del sitio publico. Sirve dist/ en un servidor propio (red externa bloqueada) y comprueba
// estados 200, hreflang reciprocos, canonicos, sitemap, JSON-LD, 375px sin scroll horizontal y nada <12px.
//   uso: node check-intl.mjs                          (dist/ local + navegador)
//        node check-intl.mjs https://friendly123.com  (en vivo: solo 200 + metadatos, sin navegador)
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { createRequire } from "node:module";
const LIVE = process.argv[2];
const SITIO = "https://friendly123.com";
const PAGES = ["/", "/es/", "/consignment-commissions/", "/es/comisiones-de-consignacion/", "/shared-digital-notebook/", "/es/cuaderno-digital-compartido/",
  "/privacy/", "/privacidad/", "/terms/", "/terminos/", "/app/", "/app/manual.html"];
const PARES = [["/", "/es/"], ["/consignment-commissions/", "/es/comisiones-de-consignacion/"], ["/shared-digital-notebook/", "/es/cuaderno-digital-compartido/"], ["/privacy/", "/privacidad/"], ["/terms/", "/terminos/"]];
let fallos = 0;
const ok = (c, m) => { if (!c) { fallos++; console.log("FALLO:", m); } };
const tags = (h, re) => [...h.matchAll(re)].map((m) => m[0]);
const attr = (t, a) => (t.match(new RegExp(a + '="([^"]*)"')) || [])[1];

async function html(path) {
  if (LIVE) { const r = await fetch(LIVE + path); return { status: r.status, h: await r.text() }; }
  const f = join("dist", path.endsWith("/") ? path + "index.html" : path);
  return { status: existsSync(f) ? 200 : 404, h: existsSync(f) ? readFileSync(f, "utf8") : "" };
}
const pg = {};
for (const p of PAGES) {
  const { status, h } = await html(p);
  ok(status === 200, p + " status " + status);
  const lang = (h.match(/<html[^>]*lang="([^"]+)"/) || [])[1];
  const canon = attr((h.match(/<link[^>]+rel="canonical"[^>]*>/) || [""])[0], "href");
  ok(canon === SITIO + p, p + " canonical " + canon);
  const title = (h.match(/<title[^>]*>([^<]*)<\/title>/) || [])[1];
  const desc = attr((h.match(/<meta[^>]+name="description"[^>]*>/) || [""])[0], "content");
  ok(title && desc, p + " sin title/description");
  ok(!!attr((h.match(/<meta[^>]+property="og:locale"[^>]*>/) || [""])[0], "content"), p + " sin og:locale");
  ok(/property="og:locale:alternate"/.test(h), p + " sin og:locale:alternate");
  for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); } catch (e) { ok(false, p + " JSON-LD invalido"); }
  }
  pg[p] = { h, lang, title, desc };
}
for (const [en, es] of PARES) { ok(pg[en].lang === "en", en + " lang " + pg[en].lang); ok(pg[es].lang === "es", es + " lang " + pg[es].lang); }
const hl = (h) => Object.fromEntries(tags(h, /<link[^>]+rel="alternate"[^>]+hreflang="[^"]*"[^>]*>/g).map((t) => [attr(t, "hreflang"), attr(t, "href")]));
for (const [en, es] of PARES) {
  const a = hl(pg[en].h), b = hl(pg[es].h);
  ok(JSON.stringify(a) === JSON.stringify(b), en + " / " + es + " hreflang distintos");
  ok(a.en === SITIO + en && a.es === SITIO + es && a["x-default"] === SITIO + en, en + " hreflang incorrecto " + JSON.stringify(a));
  ok(Object.keys(a).length === 3, en + " hreflang extra");
}
for (const p of ["/app/", "/app/manual.html"]) ok(Object.keys(hl(pg[p].h)).length === 0, p + " no debe llevar hreflang (una sola URL bilingue)");
const tt = PAGES.map((p) => pg[p].title), dd = PAGES.map((p) => pg[p].desc);
ok(new Set(tt).size === tt.length, "titulos repetidos");
ok(new Set(dd).size === dd.length, "descripciones repetidas");
for (const p of ["/", "/consignment-commissions/", "/shared-digital-notebook/", "/privacy/", "/terms/"]) ok(/href="\/privacy\/">Privacy</.test(pg[p].h) && /href="\/terms\/">Terms</.test(pg[p].h), p + " pie EN");
for (const p of ["/es/", "/es/comisiones-de-consignacion/", "/es/cuaderno-digital-compartido/", "/privacidad/", "/terminos/"]) ok(/href="\/privacidad\/">Privacidad</.test(pg[p].h) && /href="\/terminos\/">T\u00e9rminos</.test(pg[p].h), p + " pie ES");
const sm = await html("/sitemap.xml");
ok(sm.status === 200, "sitemap status");
const xml = sm.h;
ok(/^<\?xml/.test(xml) && (xml.match(/<url>/g) || []).length === (xml.match(/<\/url>/g) || []).length && /<\/urlset>\s*$/.test(xml), "sitemap mal formado");
const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
ok(locs.length === PAGES.length && PAGES.every((p) => locs.includes(SITIO + p)), "sitemap no lista todas las paginas");
for (const [en, es] of PARES) for (const u of [en, es]) {
  const blk = xml.split("<url>").find((b) => b.includes("<loc>" + SITIO + u + "</loc>")) || "";
  for (const [l, x] of [["en", en], ["es", es], ["x-default", en]]) ok(blk.includes('hreflang="' + l + '" href="' + SITIO + x + '"'), "sitemap alt " + u + " " + l);
}
const rb = await html("/robots.txt"); ok(rb.status === 200 && rb.h.includes("Sitemap: " + SITIO + "/sitemap.xml"), "robots.txt");
console.log(fallos ? "METADATOS: " + fallos + " fallos" : "METADATOS OK (" + PAGES.length + " paginas 200, " + PARES.length + " pares hreflang reciprocos, canonicos propios, JSON-LD valido, sitemap valido)");
if (LIVE) process.exit(fallos ? 1 : 0);

// Navegador: 375px sin scroll horizontal, nada <12px, red externa bloqueada.
const { chromium } = createRequire(import.meta.url)(process.env.PW_PATH || "C:/00 Projects/friendly-123/node_modules/playwright");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".xml": "application/xml", ".txt": "text/plain", ".webmanifest": "application/manifest+json" };
const srv = createServer((q, s) => {
  const p = decodeURIComponent(q.url.split("?")[0]); let f = join("dist", p);
  if (p.endsWith("/")) f = join(f, "index.html");
  if (!existsSync(f) || statSync(f).isDirectory()) { s.writeHead(404); return s.end("404"); }
  s.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" }); s.end(readFileSync(f));
}).listen(0);
const base = "http://127.0.0.1:" + srv.address().port;
const br = await chromium.launch();
const ctx = await br.newContext({ viewport: { width: 375, height: 800 }, serviceWorkers: "block" });
await ctx.route((u) => !u.href.startsWith(base), (r) => r.abort());
let navFallos = 0;
for (const p of PAGES) {
  const pgn = await ctx.newPage();
  const r = await pgn.goto(base + p, { waitUntil: "load" }); await pgn.waitForTimeout(600);
  const res = await pgn.evaluate(() => {
    const de = document.documentElement, over = de.scrollWidth - de.clientWidth;
    const chicos = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(el.tagName)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      if (el.closest("dialog:not([open]),[hidden]")) continue;
      if (parseFloat(cs.fontSize) < 12) chicos.push(el.tagName + ":" + cs.fontSize + ":" + n.textContent.trim().slice(0, 30));
    }
    return { over, chicos: chicos.slice(0, 5) };
  });
  if (r.status() !== 200 || res.over > 1 || res.chicos.length) { navFallos++; console.log("NAV FALLO", p, r.status(), "overflow", res.over, res.chicos); }
  await pgn.close();
}
await br.close(); srv.close();
console.log(navFallos ? "NAVEGADOR: " + navFallos + " paginas con fallos" : "NAVEGADOR OK (375px sin scroll horizontal, nada <12px, " + PAGES.length + " paginas 200, red externa bloqueada)");
process.exit(fallos || navFallos ? 1 : 0);
