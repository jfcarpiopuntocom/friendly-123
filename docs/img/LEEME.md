# docs/img/ — CDN propio de imagenes (JFC 2026-10-01)

GitHub Pages sirve esta carpeta en las tres rutas (/, /next/, /previo/) y el service
worker guarda en el aparato lo que figura en `SHELL` de `docs/sw.js`. Asi la imagen se
descarga UNA vez (primera visita) y despues sale del aparato, incluso sin red.

Reglas para que nadie lo arruine:
- NUNCA incrustar imagenes en base64 dentro de index.html u otras paginas: el logo de
  583 KB estaba repetido en 5 paginas (casi la mitad de index.html).
- Excepcion unica: `dashboard.html` se manda por WhatsApp y abre sin servidor; ahi va
  inline, pero la version liviana (logo-720.png, 24 KB en base64).
- Imagen nueva del shell: agregarla a `SHELL` en sw.js y seguir el CHECKLIST DE RELEASE.
- Tamano: el doble del ancho maximo que se ve en CSS basta (logo: 340 px CSS -> 720 px).
- Formato: PNG (cualquier navegador, iPhones viejos incluidos). WebP pesa igual aqui.

| Archivo | Uso | Origen |
|---|---|---|
| logo-720.png | splash de index, cabecera de save/checklist/manifiesto | docs/logo.png (2088 px) reducido a 720 px, 128 colores |
