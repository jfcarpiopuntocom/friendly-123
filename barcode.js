// barcode.js — Generador de código de barras Code128 (subset B) en SVG puro.
// Cero dependencias, cero llamadas a APIs externas: el algoritmo Code128 es
// un estándar público (ISO/IEC 15417), no hay licencia de por medio. Se eligió
// esto en vez de una librería npm o una API gratuita de terceros porque JFC
// pidió explícitamente "gratis, self-hosted, open source AF" — esto corre
// 100% local, para siempre, sin depender de que un servicio externo siga
// vivo o gratis el día de mañana.
//
// Code128B soporta ASCII imprimible (32-126), suficiente para SKUs y códigos
// de barras numéricos/alfanuméricos típicos de retail.
const PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232","2331112",
];
const START_B = 104, STOP = 106;

function code128BValue(ch) {
  const code = ch.charCodeAt(0);
  if (code < 32 || code > 126) throw new Error(`Carácter fuera de rango para Code128B: "${ch}"`);
  return code - 32;
}

// Devuelve un SVG <svg>...</svg> con las barras. width/height en px.
function code128SVG(texto, { width = 260, height = 70, margin = 6 } = {}) {
  const valores = [START_B, ...texto.split("").map(code128BValue)];
  const checksum = valores.reduce((acc, v, i) => (i === 0 ? v : acc + v * i), 0) % 103;
  valores.push(checksum, STOP);

  const modulos = valores.map((v) => PATTERNS[v]).join("");
  const totalUnidades = modulos.split("").reduce((a, c) => a + Number(c), 0);
  const anchoUtil = width - margin * 2;
  const anchoUnidad = anchoUtil / totalUnidades;

  let x = margin;
  let barras = "";
  let negro = true; // Code128 siempre arranca en barra negra
  for (const ch of modulos) {
    const w = Number(ch) * anchoUnidad;
    if (negro) barras += `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${height}" fill="#000"/>`;
    x += w;
    negro = !negro;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    <rect x="0" y="0" width="${width}" height="${height}" fill="#fff"/>
    ${barras}
  </svg>`;
}

module.exports = { code128SVG };
