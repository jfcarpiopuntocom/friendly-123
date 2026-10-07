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
// Esta carpeta NO modifica docs/ ni los Workers existentes.
import { execFileSync } from "node:child_process";
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
for (const rel of ["index.html", "es/index.html"]) {
  const t = readFileSync(join(DIST, rel), "utf8");
  dura(!t.includes("jfcarpiopuntocom.github.io/friendly-123"), rel + " aun enlaza a github.io");
  dura(!t.includes('"/friendly123/'), rel + " aun trae prefijo /friendly123/");
}
console.log(`dist listo: ${archivos.length} archivos de landing (${reescritos} con enlaces reescritos) + app + 404 + _headers`);
