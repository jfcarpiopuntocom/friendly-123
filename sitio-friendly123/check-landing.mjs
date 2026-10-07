// check-landing.mjs: prueba de la landing con motion (friendly123.com, JFC 2026-10-07).
//   uso: node check-landing.mjs            (desde sitio-friendly123/, despues de node build.mjs)
// Sirve dist/ en un servidor propio, bloquea toda red externa, reemplaza WebSocket por un stub y usa Chrome (H.264).
// Comprueba: sin scroll horizontal (375 y 1280), 0 errores de consola, 0 bytes de video antes del toque/scroll,
// reduced-motion muestra todo, peso inicial < 400 KB (sin videos), escaneo CSS (opacity/rgba/<12px) = 0,
// color == -webkit-text-fill-color en todo texto. Capturas en %TEMP%/f123motion.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const OUT = process.env.F123_OUT || "C:/Users/JFC/AppData/Local/Temp/f123motion";
mkdirSync(OUT, { recursive: true });
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".mp4": "video/mp4", ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain" };
const srv = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  let f = join("dist", p.endsWith("/") ? p + "index.html" : p);
  if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end("404"); }
  const buf = readFileSync(f), type = MIME[extname(f)] || "application/octet-stream";
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
  if (m) { const a = +m[1], b = m[2] ? +m[2] : buf.length - 1; res.writeHead(206, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Range": `bytes ${a}-${b}/${buf.length}`, "Content-Length": b - a + 1 }); return res.end(buf.subarray(a, b + 1)); }
  res.writeHead(200, { "Content-Type": type, "Content-Length": buf.length, "Accept-Ranges": "bytes" }); res.end(buf);
}).listen(0);
const BASE = "http://127.0.0.1:" + srv.address().port;
let fallos = 0;
const ok = (c, m) => { console.log((c ? "ok    " : "FALLO ") + m); if (!c) fallos++; };

// ---- escaneo de la fuente (CSS) ----
const html = readFileSync("landing/index.html", "utf8");
const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
const cssSinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, "");
ok(!/opacity\s*:/i.test(cssSinComentarios), "CSS: 0 declaraciones opacity");
ok(!/rgba?\s*\(/i.test(cssSinComentarios) && !/hsla?\s*\(/i.test(cssSinComentarios), "CSS: 0 rgba()/hsla() (0 colores con alfa)");
ok(!/backdrop-filter/i.test(cssSinComentarios), "CSS: 0 backdrop-filter");
const chicas = [...cssSinComentarios.matchAll(/font-size\s*:\s*([\d.]+)(px|rem|em)/gi)].filter((m) => (m[2] === "px" ? +m[1] : +m[1] * 16) < 12);
ok(chicas.length === 0, "CSS: 0 font-size < 12px (" + chicas.length + ")");
const sinFill = [...cssSinComentarios.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /(^|[;{\s])color\s*:/.test(m[2]) && !/-webkit-text-fill-color/.test(m[2])).map((m) => m[1].trim().slice(0, 60));
ok(sinFill.length === 0, "CSS: todo 'color:' trae -webkit-text-fill-color " + (sinFill.length ? JSON.stringify(sinFill) : ""));
const dm = cssSinComentarios.slice(cssSinComentarios.indexOf("@media (prefers-color-scheme: dark)"));
ok(/prefers-color-scheme: dark/.test(css) && /h1,h2,h3\{color:var\(--h\)/.test(dm), "CSS: bloque prefers-color-scheme: dark repite las reglas de texto");

const browser = await chromium.launch({ channel: "chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
async function ctxPage(opts) {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(() => { window.WebSocket = function () { return { send() {}, close() {}, addEventListener() {}, removeEventListener() {}, readyState: 3 }; }; });
  const page = await ctx.newPage();
  const log = { errs: [], reqs: [], ext: [] };
  page.on("console", (m) => { if (m.type() === "error") log.errs.push(m.text()); });
  page.on("pageerror", (e) => log.errs.push("pageerror: " + e.message));
  await page.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith(BASE) || u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
    log.ext.push(u); return route.abort();
  });
  page.on("response", async (r) => { try { const h = r.headers(); log.reqs.push({ url: r.url().replace(BASE, ""), status: r.status(), len: +(h["content-length"] || 0) }); } catch (e) {} });
  return { ctx, page, log };
}
async function scrollAll(page) {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 380) { await page.evaluate((yy) => window.scrollTo(0, yy), y); await page.waitForTimeout(110); }
  await page.waitForTimeout(1500);
}

for (const [name, vp, mobile] of [["m375", { width: 375, height: 812 }, true], ["d1280", { width: 1280, height: 800 }, false]]) {
  console.log("== " + name);
  const { ctx, page, log } = await ctxPage({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  await page.goto(BASE + "/", { waitUntil: "load" });
  await page.waitForTimeout(2200);
  // peso inicial (sin videos): bytes de lo cargado hasta aqui
  const inicial = log.reqs.filter((r) => !/\.mp4$/.test(r.url));
  const kb = inicial.reduce((a, r) => a + r.len, 0) / 1024;
  console.log("      carga inicial: " + inicial.length + " archivos, " + kb.toFixed(1) + " KB (" + inicial.map((r) => r.url + ":" + (r.len / 1024).toFixed(0)).join(" ") + ")");
  ok(kb < 400, name + " peso inicial sin videos < 400 KB (" + kb.toFixed(0) + ")");
  ok(!log.reqs.some((r) => /\.mp4$/.test(r.url)), name + " 0 requests de video antes de scroll/toque");
  await page.screenshot({ path: join(OUT, name + "-top.png") });
  const sw = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth }));
  ok(sw.sw <= sw.cw && sw.bw <= sw.cw, name + " sin scroll horizontal (" + sw.sw + "/" + sw.cw + ")");
  // sin JS el contenido es visible: 'js' presente solo si se permite animar; aqui si
  ok(await page.evaluate(() => /(^| )js( |$)/.test(document.documentElement.className)), name + " html.js activo (animaciones permitidas)");
  // toque en el video general: debe pedir el mp4 solo ahora
  await page.evaluate(() => document.querySelector(".ov .vplay").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(1500);
  const antes = log.reqs.filter((r) => /producto\.mp4$/.test(r.url)).length;
  await page.click(".ov .vplay");
  await page.waitForTimeout(2500);
  const pl = await page.evaluate(() => { const v = document.querySelector(".ov video"); return { paused: v.paused, t: v.currentTime, rs: v.readyState, err: v.error && v.error.code }; });
  ok(antes === 0 && log.reqs.some((r) => /producto\.mp4$/.test(r.url) && (r.status === 200 || r.status === 206)), name + " producto.mp4 se pide solo al tocar (200/206)");
  ok(!pl.paused && pl.t > 0, name + " el video general reproduce al tocar (t=" + pl.t.toFixed(2) + ")");
  await page.evaluate(() => document.querySelector(".ov video").pause());
  await page.screenshot({ path: join(OUT, name + "-mid.png") });
  // el bucle de moda solo carga al entrar en pantalla
  ok(!log.reqs.some((r) => /moda\.mp4$/.test(r.url)), name + " moda.mp4 aun sin pedir (fuera de pantalla)");
  await page.evaluate(() => document.getElementById("loop").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(2500);
  const lp = await page.evaluate(() => { const v = document.getElementById("loop"); return { paused: v.paused, t: v.currentTime }; });
  ok(log.reqs.some((r) => /moda\.mp4$/.test(r.url)) && !lp.paused, name + " bucle de moda arranca al entrar en pantalla");
  // colores.mp4 no debe haberse pedido todavia
  ok(!log.reqs.some((r) => /colores\.mp4$/.test(r.url)), name + " colores.mp4 sin pedir hasta el toque");
  await page.evaluate(() => document.querySelector(".met .vplay").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(1500);
  await page.click(".met .vplay");
  await page.waitForTimeout(2200);
  ok(log.reqs.some((r) => /colores\.mp4$/.test(r.url) && (r.status === 200 || r.status === 206)), name + " colores.mp4 se pide al tocar");
  await page.evaluate(() => document.querySelectorAll("video").forEach((v) => v.pause()));
  await scrollAll(page);
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, name + "-full.png"), fullPage: true });
  // semaforo: alguna lampara cambia
  const lampOn = await page.evaluate(() => [].map.call(document.querySelectorAll("#lamps li"), (l) => /(^| )on( |$)/.test(l.className)).indexOf(true));
  ok(lampOn >= 0, name + " semaforo con una lampara encendida (" + lampOn + ")");
  // contadores terminan en su valor
  const cs = await page.evaluate(() => [].map.call(document.querySelectorAll("[data-count]"), (e) => e.getAttribute("data-count") + "=" + e.textContent));
  ok(cs.every((s) => { const [a, b] = s.split("="); return a === b; }), name + " contadores llegan a su valor " + cs.join(","));
  const calc = await page.evaluate(() => document.getElementById("horas-ano").textContent + " | " + document.getElementById("valor-ahorrado").textContent);
  ok(calc === "156 hours | $624", name + " calculadora final: " + calc);
  // texto: color == -webkit-text-fill-color y >= 12px, sin opacity en elementos con texto
  const bad = await page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const n = walker.currentNode; if (!n.nodeValue.trim()) continue;
      const el = n.parentElement; if (seen.has(el)) continue; seen.add(el);
      if (el.closest("script,style,noscript")) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const fs = parseFloat(cs.fontSize);
      if (fs < 12) out.push("fs<12:" + el.className + ":" + el.textContent.slice(0, 20));
      if (cs.color !== cs.webkitTextFillColor) out.push("fill!=color:" + el.tagName + "." + el.className + ":" + cs.color + "/" + cs.webkitTextFillColor);
      for (let a = el; a && a !== document.documentElement; a = a.parentElement) { if (parseFloat(getComputedStyle(a).opacity) < 1) { out.push("opacity:" + a.tagName + "." + a.className); break; } }
    }
    return out;
  });
  ok(bad.length === 0, name + " texto: color=fill, >=12px, sin opacity (" + bad.length + ") " + JSON.stringify(bad.slice(0, 6)));
  const sinTam = await page.evaluate(() => [].filter.call(document.querySelectorAll("a.btn,button,summary,.demo,.wa"), (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44; }).map((e) => e.className + ":" + Math.round(e.getBoundingClientRect().height)));
  ok(sinTam.length === 0, name + " objetivos tactiles >= 44px " + JSON.stringify(sinTam));
  ok(log.errs.length === 0, name + " 0 errores de consola " + JSON.stringify(log.errs.slice(0, 4)));
  console.log("      red externa bloqueada: " + log.ext.length + " intentos " + JSON.stringify([...new Set(log.ext)].slice(0, 4)));
  await ctx.close();
}

// ---- reduced motion: todo visible, sin clase js ----
{
  console.log("== reduced-motion 375");
  const { ctx, page, log } = await ctxPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  await page.goto(BASE + "/", { waitUntil: "load" }); await page.waitForTimeout(800);
  ok(!(await page.evaluate(() => /(^| )js( |$)/.test(document.documentElement.className))), "rm: html sin clase js");
  const oculto = await page.evaluate(() => [].filter.call(document.querySelectorAll("[data-rv],h1 .ln>span,.hl"), (e) => { const cs = getComputedStyle(e); return (cs.clipPath && cs.clipPath !== "none" && /inset\(/.test(cs.clipPath) && cs.clipPath !== "inset(0px)") || /matrix\(1, 0, 0, 1, 0, [1-9]/.test(cs.transform); }).length);
  ok(oculto === 0, "rm: ningun bloque recortado ni desplazado (" + oculto + ")");
  const anim = await page.evaluate(() => [].filter.call(document.querySelectorAll("*"), (e) => { const cs = getComputedStyle(e); return cs.animationName !== "none" && parseFloat(cs.animationDuration) > 0.001; }).length);
  ok(anim === 0, "rm: 0 animaciones CSS activas (" + anim + ")");
  const calc = await page.evaluate(() => document.getElementById("horas-ano").textContent + " | " + document.querySelector("[data-count='399']").textContent);
  ok(calc === "156 hours | 399", "rm: numeros finales visibles sin animar: " + calc);
  const lp = await page.evaluate(() => { const v = document.getElementById("loop"); return { c: v.hasAttribute("controls"), p: v.paused }; });
  ok(lp.c && lp.p, "rm: bucle de moda NO autoreproduce (controles visibles)");
  ok(!log.reqs.some((r) => /\.mp4$/.test(r.url)), "rm: 0 bytes de video");
  const sw = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  ok(sw, "rm: sin scroll horizontal");
  await page.screenshot({ path: join(OUT, "rm375-full.png"), fullPage: true });
  ok(log.errs.length === 0, "rm: 0 errores de consola " + JSON.stringify(log.errs.slice(0, 3)));
  await ctx.close();
}
// ---- sin JS: el contenido debe estar visible ----
{
  console.log("== sin JS 375");
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.route("**/*", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  await page.goto(BASE + "/", { waitUntil: "load" });
  const vis = await page.evaluate(() => { const h = document.querySelector("h1"); const r = h.getBoundingClientRect(); return { w: r.width, h: r.height, t: h.innerText.length }; });
  ok(vis.w > 100 && vis.h > 30 && vis.t > 10, "sin JS: titular visible");
  const rv = await page.evaluate(() => [].filter.call(document.querySelectorAll(".problema h2,#oferta h2,.faq summary"), (e) => { const cs = getComputedStyle(e); return cs.clipPath !== "none"; }).length);
  ok(rv === 0, "sin JS: titulos de secciones no recortados");
  await page.screenshot({ path: join(OUT, "nojs375-full.png"), fullPage: true });
  await ctx.close();
}
await browser.close(); srv.close();
console.log(fallos ? "\n" + fallos + " FALLO(S)" : "\nTODO OK");
process.exit(fallos ? 1 : 0);
