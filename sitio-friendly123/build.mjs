// build.mjs — arma dist/ para el Worker "friendly123-com" (friendly123.com). Node, sin dependencias.
//   uso:  node build.mjs            (desde sitio-friendly123/)
//
//   dist/            = landing de ventas ACTUAL, copia textual de friendly123/ en la rama main
//                      de github.com/jfcarpiopuntocom/website (NO la copia de trabajo local,
//                      que puede estar vieja). Se lee con `git show origin/main:...`.
//   dist/app/        = copia de docs/ de ESTE repo (lo que hoy es produccion en github.io).
//   dist/404.html    = la pagina 404 de la app (texto ya existente), con su unico enlace
//                      de vuelta apuntando a /app/ (el original es relativo y fallaria en rutas profundas).
//   dist/_headers    = ./_headers (seguridad + CSP en modo report-only).
//
// UNICAS reescrituras sobre la landing (no se toca ningun texto):
//   1. Enlaces a la app: https://jfcarpiopuntocom.github.io/friendly-123/...  ->  /app/...
//   2. Enlaces internos con prefijo del sitio viejo: "/friendly123/...  ->  "/...
//      (la landing vivia en jfcarpio.com/friendly123/; aqui vive en la raiz).
//   Los canonical / og:url / hreflang (https://jfcarpio.com/friendly123/...) NO se tocan:
//   decidir el canonico definitivo es de JFC (mientras el sitio viejo siga vivo, apuntan a el).
//
// LANZAMIENTO 2026-10-07 (orden de JFC: "Sube save.html como index.html temporal a friendly123.com"):
//   /          = docs/save.html (temporal). Sus URLs relativas (./x) se reescriben a /app/x
//                (no se usa <base>: rompia los enlaces #ancla, que irian a /app/#ancla).
//   /landing/  = ELIMINADA (JFC 2026-10-07: "borra la de /landing/"). La landing vieja ya no se publica en dist/.
//   /          = landing nueva (sitio-friendly123/landing/index.html), bloque (d3). save.html sigue en /app/save.html.
//   /privacidad/, /terminos/ = paginas legales estaticas (fuente: sitio-friendly123/legal/), bloque (d4).
//   /preview/  = ELIMINADA (JFC 2026-10-07: "Deja de crear /landing/ y /preview/, solo edita directo el index.html").
//   robots.txt, sitemap.xml, favicon, apple-touch-icon, og:image, canonical/og:url a friendly123.com
//   y versiones .webp: SOLO en las copias de dist/, nunca en docs/. No se escribe ningun texto visible nuevo.
//
// Esta carpeta NO modifica docs/ ni los Workers existentes.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(AQUI, "..");
const DIST = join(AQUI, "dist");
const DOCS = join(REPO, "docs");

// Repo del sitio (jfcarpiopuntocom/website). Se puede cambiar con la variable SITE_REPO.
const SITE_REPO = process.env.SITE_REPO || "C:/00 Projects/000 JFCarpio.com Website";
const REF = "origin/main";
const CARPETA = "friendly123";

const git = (...args) => execFileSync("git", ["-C", SITE_REPO, ...args], { maxBuffer: 256 * 1024 * 1024 });

// Comprobar que es el repo correcto antes de copiar nada.
const remoto = git("remote", "get-url", "origin").toString().trim();
if (!/jfcarpiopuntocom\/website(\.git)?$/.test(remoto)) {
  throw new Error("SITE_REPO no es jfcarpiopuntocom/website: " + remoto);
}
git("fetch", "--quiet", "origin");

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// --- 1. Landing: archivos de friendly123/ en origin/main, tal cual, a la raiz de dist/
const archivos = git("ls-tree", "-r", "--name-only", REF, CARPETA).toString().split("\n").filter(Boolean);
const TEXTO = /\.(html|css|js|json|xml|txt|webmanifest|svg)$/i;
let reescritos = 0;
for (const ruta of archivos) {
  if (ruta.endsWith(".mjs")) continue; // herramientas del sitio (generar-urls-seo.mjs), no se publican
  const rel = ruta.slice(CARPETA.length + 1);
  const destino = join(DIST, rel);
  mkdirSync(dirname(destino), { recursive: true });
  let datos = git("show", `${REF}:${ruta}`);
  if (TEXTO.test(rel)) {
    const antes = datos.toString("utf8");
    const despues = antes
      .replaceAll("https://jfcarpiopuntocom.github.io/friendly-123/", "/app/")
      .replaceAll('"/friendly123/', '"/');
    if (despues !== antes) reescritos++;
    datos = Buffer.from(despues, "utf8");
  }
  writeFileSync(destino, datos);
}

// --- 2. App: docs/ completo en dist/app/ (sin _headers: los Workers solo leen el de la raiz)
cpSync(DOCS, join(DIST, "app"), {
  recursive: true,
  filter: (src) => !/[\/]_headers$/.test(src),
});

// --- 3. 404 raiz: la de la app, con el enlace de vuelta absoluto a /app/
const f404 = readFileSync(join(DOCS, "404.html"), "utf8");
if (!f404.includes('href="./index.html"')) throw new Error('404.html de la app ya no trae href="./index.html"');
writeFileSync(join(DIST, "404.html"), f404.replace('href="./index.html"', 'href="/app/"'));

// --- 3b. Lanzamiento: raiz = save.html, landing vieja -> /landing/, SEO, iconos, webp
const SITIO = "https://friendly123.com";
const OG = SITIO + "/og-friendly123.jpg";

// sharp (solo si ya esta instalado en el repo grande); si no, se omite webp y se avisa.
let sharp = null;
try { sharp = createRequire(import.meta.url)(process.env.SHARP_PATH || "C:/00 Projects/friendly-123/node_modules/sharp"); }
catch { console.warn("AVISO: sharp no disponible, se omite webp"); }
const ahorro = { antes: 0, despues: 0, n: 0 };
const cacheWebp = new Map();
const aWebp = async (buf) => {
  const k = createHash("sha1").update(buf).digest("hex");
  if (!cacheWebp.has(k)) cacheWebp.set(k, await sharp(buf).webp({ quality: 80, effort: 6 }).toBuffer());
  return cacheWebp.get(k);
};
// Cada imagen embebida (data:image/jpeg|png) de un <img> se cambia por su version webp si pesa menos.
const imgsAWebp = async (html) => {
  if (!sharp) return html;
  const re = /(<img\b[^>]*?\bsrc=")data:image\/(?:jpeg|png);base64,([A-Za-z0-9+\/=]+)"/g;
  const partes = []; let ult = 0, m;
  while ((m = re.exec(html))) {
    const orig = Buffer.from(m[2], "base64"), web = await aWebp(orig);
    partes.push(html.slice(ult, m.index));
    if (web.length < orig.length) {
      ahorro.antes += orig.length; ahorro.despues += web.length; ahorro.n++;
      partes.push(m[1] + "data:image/webp;base64," + web.toString("base64") + '"');
    } else partes.push(m[0]);
    ult = m.index + m[0].length;
  }
  return partes.join("") + html.slice(ult);
};
// Archivo suelto -> .webp al lado (se conserva el original).
const archivoAWebp = async (ruta) => {
  if (!sharp) return false;
  const orig = readFileSync(ruta), web = await sharp(orig).webp({ quality: 80, effort: 6 }).toBuffer();
  writeFileSync(ruta.replace(/\.(png|jpe?g)$/i, ".webp"), web);
  ahorro.antes += orig.length; ahorro.despues += web.length; ahorro.n++;
  return true;
};

// Iconos: favicon.ico, apple-touch-icon y PNG 16/32 de docs/ a la raiz de dist/.
mkdirSync(join(DIST, "icons"), { recursive: true });
cpSync(join(DOCS, "favicon.ico"), join(DIST, "favicon.ico"));
cpSync(join(DOCS, "icons", "apple-touch-icon.png"), join(DIST, "apple-touch-icon.png"));
for (const f of ["favicon-16x16.png", "favicon-32x32.png"]) cpSync(join(DOCS, "icons", f), join(DIST, "icons", f));

const LINKS_ICONO = [
  '<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32x32.png">',
  '<link rel="icon" type="image/png" sizes="16x16" href="/icons/favicon-16x16.png">',
  '<link rel="shortcut icon" href="/favicon.ico">',
];
const APPLE = '<link rel="apple-touch-icon" href="/apple-touch-icon.png">';
// Agrega antes de </head> lo que falte: iconos, og:image/og:url, canonical. Nunca escribe texto visible.
const poner = (html, { url, og = true }) => {
  const extra = [];
  if (!/<link[^>]+rel="(?:shortcut )?icon"[^>]+href="(?!data:)[^"]+"/i.test(html)) extra.push(...LINKS_ICONO);
  if (!/rel="apple-touch-icon"/i.test(html)) extra.push(APPLE);
  if (og) {
    if (/<meta[^>]+property="og:image"/i.test(html)) html = html.replace(/(<meta[^>]+(?:property="og:image"|name="twitter:image")[^>]+content=")[^"]*(")/gi, "$1" + OG + "$2");
    else extra.push(`<meta property="og:image" content="${OG}">`);
    if (!/<meta[^>]+name="twitter:image"/i.test(html)) extra.push(`<meta name="twitter:image" content="${OG}">`);
    if (/<meta[^>]+property="og:url"/i.test(html)) html = html.replace(/(<meta[^>]+property="og:url"[^>]+content=")[^"]*(")/i, "$1" + url + "$2");
    else extra.push(`<meta property="og:url" content="${url}">`);
  }
  if (og || /<link[^>]+rel="canonical"/i.test(html)) {
    if (/<link[^>]+rel="canonical"/i.test(html)) html = html.replace(/(<link[^>]+rel="canonical"[^>]+href=")[^"]*(")/i, "$1" + url + "$2");
    else extra.push(`<link rel="canonical" href="${url}">`);
  }
  return html.replace("</head>", extra.join("\n") + "\n</head>");
};

// (a) (ELIMINADO 2026-10-07, orden de JFC) Antes aqui la raiz vieja se copiaba a /landing/. Ya no se publica.
//     El index.html viejo que llega de friendly123/ se sobrescribe mas abajo con save.html (paso c).

// (b) Canonicos de la landing: jfcarpio.com/friendly123/... -> friendly123.com/... (la vieja raiz -> /landing/).
const aSitio = (h) => h.replace(/https:\/\/jfcarpio\.com\/friendly123\/([^"'<> )]*)/g, (_, r) =>
  SITIO + "/" + r);
const urlDe = (rel) => SITIO + "/" + rel.replace(/index\.html$/, "");
const publicasLanding = [...archivos.map((r) => r.slice(CARPETA.length + 1)).filter((r) => /\/index\.html$/.test(r))];
for (const rel of publicasLanding) {
  const f = join(DIST, rel);
  let h = aSitio(readFileSync(f, "utf8"));
  h = await imgsAWebp(h);
  h = h.replace(/\bposter="(?:\.\.)?\/?media\/friendly-reel-poster\.jpg"/, 'poster="/media/friendly-reel-poster.webp"');
  writeFileSync(f, poner(h, { url: urlDe(rel) }));
}
await archivoAWebp(join(DIST, "media", "friendly-reel-poster.jpg"));

// (c) Logo webp (lo usa la raiz, d3) y copia de save.html en /app/save.html. (La raiz ya no es save.html.)
await archivoAWebp(join(DIST, "app", "img", "logo-720.png"));
// Copia de la app en /app/save.html: mismo canonico (la raiz); sus rutas ./ ya resuelven a /app/.
writeFileSync(join(DIST, "app", "save.html"), poner(
  readFileSync(join(DOCS, "save.html"), "utf8").replaceAll("https://jfcarpiopuntocom.github.io/friendly-123/save.html", SITIO + "/"),
  { url: SITIO + "/" }));

// (d) Paginas publicas de la app: index y manual (github.io -> friendly123.com/app/).
for (const rel of ["index.html", "manual.html"]) {
  const f = join(DIST, "app", rel);
  const h = readFileSync(f, "utf8")
    .replaceAll("https://jfcarpiopuntocom.github.io/friendly-123/", SITIO + "/app/")
    .replaceAll("https://jfcarpio.com/friendly123/og-friendly123.jpg", OG);
  writeFileSync(f, poner(h, { url: SITIO + "/app/" + (rel === "index.html" ? "" : rel) }));
}
// 404 raiz: solo iconos (og=false y sin canonical).
writeFileSync(join(DIST, "404.html"), poner(readFileSync(join(DIST, "404.html"), "utf8"), { url: SITIO + "/", og: false }));

// (d3) RAIZ = landing nueva, editada directo en sitio-friendly123/landing/index.html (JFC 2026-10-07).
//      Indexable (se quita el noindex de la fuente) y con canonical a la raiz. El logo pasa a webp.
//      save.html sigue disponible en /app/save.html (QRs de flyers apuntan a github.io/save.html, intacto).
cpSync(join(AQUI, "landing"), DIST, { recursive: true });
let raiz = readFileSync(join(AQUI, "landing", "index.html"), "utf8");
if (sharp) raiz = raiz.replace('src="/app/img/logo-720.png"', 'src="/app/img/logo-720.webp"');
raiz = raiz.replace(/<meta name="robots" content="noindex,nofollow">\s*/i, "");
writeFileSync(join(DIST, "index.html"), poner(raiz, { url: SITIO + "/" }));

// (d4) Paginas legales: legal/<nombre>.html -> dist/<nombre>/index.html (privacidad, terminos = ES; privacy, terms = EN, traduccion fiel).
//      Texto aprobado por JFC (Notion), verbatim. poner() solo agrega iconos (og:false); el canonical ya viene en la fuente.
const LEGALES = { privacidad: SITIO + "/privacidad/", terminos: SITIO + "/terminos/", privacy: SITIO + "/privacy/", terms: SITIO + "/terms/" };
for (const [nom, url] of Object.entries(LEGALES)) {
  mkdirSync(join(DIST, nom), { recursive: true });
  writeFileSync(join(DIST, nom, "index.html"), poner(readFileSync(join(AQUI, "legal", nom + ".html"), "utf8"), { url, og: false }));
}

// (d5) SEO internacional (JFC 2026-10-07: "completeness internacional y world class para SEO"). Solo metadatos y
//      enlaces de pie; ningun texto aprobado se modifica. Se aplica a las copias de dist/ (las paginas /es/ y los
//      articulos vienen del repo del sitio y NO se editan alli).
//      PARES (EN <-> ES). x-default = la version EN. La raiz / (landing EN nueva) se empareja con /es/ (landing
//      bilingue anterior, que sigue siendo una pagina distinta: se informa a JFC).
//      /app/ y /app/manual.html son UNA sola URL bilingue (sin par): sin hreflang, solo og:locale.
const PARES = [
  { en: "", es: "es/" },
  { en: "consignment-commissions/", es: "es/comisiones-de-consignacion/" },
  { en: "shared-digital-notebook/", es: "es/cuaderno-digital-compartido/" },
  { en: "privacy/", es: "privacidad/" },
  { en: "terms/", es: "terminos/" },
];
const SOLOS = [{ rel: "app/", lang: "en", locale: "en_US", alt: "es_ES" }, { rel: "app/manual.html", lang: "es", locale: "es_EC", alt: "en_US" }];
const archivoDe = (rel) => join(DIST, rel === "" || rel.endsWith("/") ? rel + "index.html" : rel);
const OGL = { en: ["en_US", "es_ES"], es: ["es_ES", "en_US"] };
// Pie legal por idioma en las paginas de la landing anterior (es/ y articulos). Esas paginas cambian de idioma
// con botones [data-lang] (setLanguage), asi que un script minimo sincroniza los dos enlaces del pie.
const PIE = { en: ['/privacy/', "Privacy", '/terms/', "Terms"], es: ['/privacidad/', "Privacidad", '/terminos/', "T\u00e9rminos"] };
const conPie = (html, lang) => {
  const [h1, t1, h2, t2] = PIE[lang];
  const fin = "</nav></div></footer>";
  dura0(html.includes(fin), "pie de la landing anterior no encontrado");
  html = html.replace(fin, `<a id="lg-priv" href="${h1}">${t1}</a><a id="lg-terms" href="${h2}">${t2}</a>${fin}`);
  const js = `<script>
/* Enlaces legales del pie segun idioma (EN: Privacy/Terms, ES: Privacidad/Terminos). Se actualiza al pulsar los botones de idioma. */
(function(){var P=${JSON.stringify(PIE)};function s(){var l=document.documentElement.lang==="es"?"es":"en",a=document.getElementById("lg-priv"),b=document.getElementById("lg-terms");if(!a||!b)return;a.href=P[l][0];a.textContent=P[l][1];b.href=P[l][2];b.textContent=P[l][3];}
document.querySelectorAll("[data-lang]").forEach(function(x){x.addEventListener("click",function(){setTimeout(s,0);});});s();})();
</script>
`;
  return html.replace(/<\/body>(?![\s\S]*<\/body>)/, js + "</body>");
};
function dura0(c, m) { if (!c) throw new Error("build: " + m); }
const intl = (html, { lang, locale, alt, alternates }) => {
  html = html.replace(/<html[^>]*>/i, `<html lang="${lang}">`);
  // se quita lo que hubiera (hreflang, og:locale) y se escribe el juego completo
  html = html.replace(/[ \t]*<link[^>]+rel="alternate"[^>]+hreflang="[^"]*"[^>]*>\n?/gi, "")
             .replace(/[ \t]*<meta[^>]+property="og:locale(?::alternate)?"[^>]*>\n?/gi, "");
  const extra = [];
  if (alternates) {
    extra.push(`<link rel="alternate" hreflang="en" href="${alternates.en}">`,
               `<link rel="alternate" hreflang="es" href="${alternates.es}">`,
               `<link rel="alternate" hreflang="x-default" href="${alternates.en}">`);
  }
  extra.push(`<meta property="og:locale" content="${locale}">`, `<meta property="og:locale:alternate" content="${alt}">`);
  return html.replace("</head>", extra.join("\n") + "\n</head>");
};
for (const par of PARES) {
  const alternates = { en: SITIO + "/" + par.en, es: SITIO + "/" + par.es };
  for (const lang of ["en", "es"]) {
    const f = archivoDe(par[lang]);
    let h = intl(readFileSync(f, "utf8"), { lang, locale: OGL[lang][0], alt: OGL[lang][1], alternates });
    // pie legal: raiz y paginas legales ya lo traen en su fuente; las demas (landing anterior) se inyecta aqui
    if (/<footer><div class="wrap footer-inner">/.test(h)) {
      h = conPie(h, lang);
      // Piso de 12px (regla de JFC): la landing anterior trae dos rotulos de ilustracion a .72rem/.74rem.
      h = h.replace("</head>", "<style>.art-legend span,.shelf-caption{font-size:.75rem}</style></head>");
    }
    writeFileSync(f, h);
  }
}
for (const s of SOLOS) {
  const f = archivoDe(s.rel);
  writeFileSync(f, intl(readFileSync(f, "utf8"), { lang: s.lang, locale: s.locale, alt: s.alt }));
}

// (e) robots.txt y sitemap.xml
writeFileSync(join(DIST, "robots.txt"), [
  "User-agent: *", "Allow: /",
  ...["panel", "estado", "dashboard", "tablero", "informe-ejecutivo", "manual-maestro", "reporte-usuario"].map((p) => `Disallow: /app/${p}.html`),
  "Disallow: /app/NOTA-", "Disallow: /app/RUNBOOK-", "Disallow: /app/OUTREACH-", "Disallow: /app/superpowers/",
  "Disallow: /clips/", "Disallow: /mosaico.html",
  "", "Sitemap: " + SITIO + "/sitemap.xml", ""].join("\n"));
// sitemap con xhtml:link (hreflang) reciprocos para cada par; /app/ sin par.
const entrada = (loc, alts) => `  <url><loc>${loc}</loc>` + (alts ? `
    <xhtml:link rel="alternate" hreflang="en" href="${alts.en}"/>
    <xhtml:link rel="alternate" hreflang="es" href="${alts.es}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${alts.en}"/>
  ` : "") + `</url>`;
const lineas = [];
for (const par of PARES) {
  const alts = { en: SITIO + "/" + par.en, es: SITIO + "/" + par.es };
  lineas.push(entrada(alts.en, alts), entrada(alts.es, alts));
}
for (const s of SOLOS) lineas.push(entrada(SITIO + "/" + s.rel));
// toda carpeta publica de la landing debe estar en un par (si no, el sitemap quedaria incompleto)
for (const rel of publicasLanding) dura0(PARES.some((p) => p.en + "index.html" === rel || p.es + "index.html" === rel) || rel === "index.html", "pagina publica sin par en PARES: " + rel);
writeFileSync(join(DIST, "sitemap.xml"), ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">', ...lineas, "</urlset>", ""].join("\n"));

// --- 4. Cabeceras
cpSync(join(AQUI, "_headers"), join(DIST, "_headers"));

// --- 4b. _redirects. Con html_handling "none" una URL con barra final (/, /app/, /es/) NO sirve
// su index.html (probado con wrangler dev: da 404). Se resuelve con reescrituras 200 (no son
// redirecciones: el navegador/SW no ve ningun salto), una por cada carpeta de la landing con
// index.html, mas / y /app/. "/app" sin barra si redirige (301) a /app/: queda fuera del
// scope del SW (/app/), no lo afecta.
const reglas = ["/app /app/ 301", "/ /index.html 200", "/app/ /app/index.html 200"];
const carpetas = (dir, pref) => {
  if (existsSync(join(dir, "index.html"))) reglas.push(pref + "/ " + pref + "/index.html 200");
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) carpetas(join(dir, e.name), pref + "/" + e.name);
  }
};
for (const e of readdirSync(DIST, { withFileTypes: true })) {
  if (e.isDirectory() && e.name !== "app") carpetas(join(DIST, e.name), "/" + e.name);
}
writeFileSync(join(DIST, "_redirects"), reglas.join("\n") + "\n");

// --- 5. Verificaciones minimas
const dura = (c, m) => { if (!c) throw new Error("build: " + m); };
dura(existsSync(join(DIST, "index.html")), "falta dist/index.html (landing)");
dura(existsSync(join(DIST, "app", "index.html")), "falta dist/app/index.html");
dura(existsSync(join(DIST, "app", "sw.js")), "falta dist/app/sw.js");
for (const rel of ["es/index.html"]) {
  const t = readFileSync(join(DIST, rel), "utf8");
  dura(!t.includes("jfcarpiopuntocom.github.io/friendly-123"), rel + " aun enlaza a github.io");
  dura(!t.includes('"/friendly123/'), rel + " aun trae prefijo /friendly123/");
}
const raizHtml = readFileSync(join(DIST, "index.html"), "utf8");
dura(!/(?:href|src)="\.\//.test(raizHtml), "la raiz (save.html) aun trae URLs relativas ./");
dura(raizHtml.includes('<link rel="canonical" href="' + SITIO + '/">'), "raiz sin canonical friendly123.com");
dura(!existsSync(join(DIST, "landing")), "dist/landing/ debe NO existir (orden de JFC 2026-10-07)");
dura(!existsSync(join(DIST, "preview")), "dist/preview/ debe NO existir (orden de JFC 2026-10-07)");
dura(!/<meta name="robots" content="noindex/.test(raizHtml), "la raiz no debe ser noindex");
for (const nom of Object.keys(LEGALES)) dura(existsSync(join(DIST, nom, "index.html")), "falta dist/" + nom + "/index.html");
if (sharp) console.log(`webp: ${ahorro.n} imagenes, ${ahorro.antes} -> ${ahorro.despues} bytes (-${ahorro.antes - ahorro.despues})`);
console.log(`dist listo: ${archivos.length} archivos de landing (${reescritos} con enlaces reescritos) + app + 404 + _headers`);
