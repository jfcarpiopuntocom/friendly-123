# DESIGN.md — la única fuente de verdad visual de friendly-123 (JFC 2026-09-24)

> Regla de oro: **nada visual se toca sin pasar por aquí.** Si un cambio necesita un
> color, tamaño o esquina que no está en este archivo, primero se agrega aquí (con
> fecha y motivo) y después se usa. Vale para index.html, dashboard.html, save.html,
> visualize.html, manual.html y la landing del website.

## 0. DECISIÓN PENDIENTE DE JFC — qué "look" manda
Hoy conviven TRES looks (capturas enviadas el 2026-09-24). JFC elige uno y a ESO se
uniforma todo lo demás. Hasta que elija, no se hace trabajo visual (Bloque 6 espera).

| Opción | Dónde se ve hoy | Carácter | Qué cambiaría en el resto |
|---|---|---|---|
| **A. App por dentro** (index.html) | Today, Commissions, Sold | Herramienta: gris frío de fondo (#E2E8ED), tarjetas blancas con borde de 2px, esquinas 4–6px, botones sólidos, mono en cifras | save/visualize pierden píldoras (999px) y esquinas 12px; dashboard adopta el borde 2px y las esquinas chicas |
| **B. Landing / save.html** | save.html, visualize.html | Marketing: lienzo #F8F9FB, tarjetas 12px, píldoras, chips de color pleno con texto blanco | La app suaviza esquinas a 12px, botones píldora, header más aireado; hay que arreglar el contraste blanco-sobre-verde (2.2:1) antes de copiarlo |
| **C. Manual / dashboard** (manual.html, dashboard.html) | Manual maestro, portada del dashboard | Editorial: blanco puro, Space Grotesk grande, esquinas 8px, franjas de color a la izquierda, mucho aire | La app gana aire y títulos más grandes; la landing baja el color pleno a franjas |

Lo que **NO cambia** con ninguna opción (ya es idéntico en los cinco archivos y se
queda): tinta, lienzo, semáforo, fuentes display y mono. Ver §1.

## 1. Tokens ya compartidos (fijos, no se discuten)
```css
:root{
  /* Tinta y lienzo */
  --ink:#0F1923;        /* texto principal. NUNCA gris claro. */
  --ink-soft:#2C3E50;   /* texto secundario. Contraste 10.7:1 sobre #F8F9FB. Es el MÁS claro permitido. */
  --canvas:#F8F9FB;     /* fondo de página */
  --card:#FFFFFF;       /* fondo de tarjeta */
  --hairline:#E8ECF2;   /* líneas divisorias (solo líneas, nunca texto) */
  --paper-deep:#E2E8ED; /* fondo de paneles hundidos / lateral de la app */

  /* Marca */
  --rust:#E86040;       /* naranja de marca: CTA primario, acentos. Texto encima: BLANCO solo si ≥18.66px bold; si no, --ink. */
  --rust-deep:#C05000;  /* hover / borde del CTA */
  --brass:#5294AC;      /* azul permitido: bordes de foco, enlaces, candado del PIN */
  --brass-dk:#2E6278;

  /* Semáforo (colores EXACTOS, JFC: bordes de tarjeta = semáforo) */
  --sim-verde:#00C87A;   --sim-verde-dk:#009A5A;   --sim-verde-bg:#C0F5E0;
  --sim-amarillo:#FFC700;--sim-amarillo-dk:#B8860B;--sim-amarillo-bg:#FFF3C2;
  --sim-naranja:#F97316; --sim-naranja-dk:#C05000; --sim-naranja-bg:#FDD9BE;
  --sim-rojo:#E8365D;    --sim-rojo-dk:#B0183E;    --sim-rojo-bg:#FAD5DE;
  --sim-azul:#5294AC;    --sim-azul-dk:#2E6278;    --sim-azul-bg:#D4ECF5;
  --sim-plata:#C4CDD8;   --sim-plata-dk:#8A9AAA;   --sim-plata-bg:#E8ECF2;
  --sim-negro:#0A0A0F;

  /* Dinero */
  --dinero-verde:#00C87A; --dinero-verde-dk:#008a54;
  --dinero-rojo:#E8365D;  --dinero-rojo-bg:#FDECEA;

  /* Tipografía */
  --font-display:"Space Grotesk",Inter,-apple-system,"Helvetica Neue",sans-serif; /* títulos, botones, nav */
  --font-body:Inter,"Source Sans 3","Segoe UI",sans-serif;                          /* texto corrido */
  --font-mono:"JetBrains Mono","Cascadia Code",Consolas,monospace;                  /* cifras, fechas, códigos, PIN */
}
```
Nota: index.html todavía usa alias viejos (`--dorado`, `--amarillo`, `--azul-op` = #5294AC;
`--ambar` = #E86040; `--verde`, `--rojo`). Se conservan como alias hasta migrar; nunca se
les cambia el valor por separado.

## 2. Reglas duras (JFC, no negociables)
1. **Legibilidad premiada.** Contraste mínimo 4.5:1 para todo texto. Nada de gris
   claro, opacidad en texto, sombras que apaguen la tinta. `--ink-soft` es el tope.
2. **Tamaño mínimo 13px** (14px en móvil para cualquier cosa que se lea de corrido).
   index.html tiene 30 usos de 10–12px: se suben al migrar, no se copian.
3. **Cuatro esquinas completas.** Nada de clip-path diagonal, esquina rota, doblez ni
   ojal. Radio único por look (A: 6px, B: 12px, C: 8px). Píldoras (999px) solo si gana B.
4. **Sin emojis en la UI.** Iconos = glifos de texto monocromos o SVG inline.
5. **Texto sobre color pleno:** sobre verde #00C87A, naranja #F97316 y azul #5294AC el
   texto va en `--ink` (8.1 / 6.3 / 5.2 : 1). Blanco solo sobre rojo #E8365D en ≥14px
   bold, o sobre `--sim-*-dk`. (Lighthouse 2026-09-24: blanco sobre verde = 2.2:1, falla.)
6. **Azul permitido** (#5294AC) para foco, enlaces y el candado. No es estado del semáforo.
7. **Móvil primero en el header:** compacto, con nombre, dispositivo, selector, idioma,
   usuario/rol, salir, ayuda y estado. El diseño de PC no se rediseña por eso.
8. **Botones táctiles ≥44px** de alto en móvil. Borde 2px sólido en el look A.

## 3. Escala tipográfica (la que ya usa Commissions desde shell 366)
| Uso | Tamaño | Fuente | Peso |
|---|---|---|---|
| Título de sección | 22–24px | display | 700 |
| Título de tarjeta | 16px | display | 700 |
| Texto | 14px | body | 400 |
| Nota / meta | 13px | body | 400, color `--ink-soft` |
| Cifra grande (dinero) | 24–32px | mono | 700 |
| Cifra en tabla | 14px | mono | 500 |
| Botón | 14–16px | display | 700, mayúsculas solo en nav |

## 4. Espaciado y componentes
- Escala de espacio: 4 / 8 / 12 / 16 / 24 / 32 px. Nada fuera de escala.
- Tarjeta: fondo `--card`, borde 2px `--hairline` (look A) o 1px (B/C), padding 14–16px,
  margen inferior 12px. Borde de color = estado del semáforo, nunca fondo pleno en
  tarjetas grandes.
- Chip de estado: fondo `--sim-*-bg`, texto `--sim-*-dk`, 13px bold. (Nunca fondo pleno
  con texto blanco: ver regla 5.)
- Botón primario: fondo `--rust`, borde 2px `--rust-deep`, texto blanco ≥16px bold.
- Botón secundario: fondo `--card`, borde 2px `--ink`, texto `--ink`.
- Enlace: `--brass-dk`, subrayado siempre.
- Tabla de dinero: cifras alineadas a la derecha, mono, totales en 700.
- Estados vacíos: una frase en `--ink` de 14px que dice qué hacer, nunca gris.

## 5. Notas para la próxima conversación (para no romper lo crucial)
- Las cifras de dinero SIEMPRE salen del backend (`fmtMoney`), la UI no suma.
- Commissions: escala 13/14/16, sin 12px, sin gris #8A8A8A, ranking al fondo (shell 366–369).
- El candado del PIN lleva borde azul `--brass` (v331), no naranja.
- `dashboard.html` es `noindex`; es tablero privado del dueño, no landing.
- Referencias consultadas para este archivo: VoltAgent/awesome-claude-design (estructura
  de tokens) y nutlope/hallmark (jerarquía de landing). Se toma la forma, no sus colores.
