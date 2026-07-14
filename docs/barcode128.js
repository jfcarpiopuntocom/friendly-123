// barcode128.js — Espejo en el navegador de barcode.js (servidor). Mismo
// algoritmo Code128B, sin dependencias, para que la demo estática (GitHub
// Pages, sin backend Node) también pueda dibujar barcode real y no solo QR.
(function () {
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
  function valorDe(ch) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) throw new Error(`Carácter fuera de rango para Code128B: "${ch}"`);
    return code - 32;
  }
  function code128SVG(texto, opts) {
    const width = (opts && opts.width) || 260, height = (opts && opts.height) || 70, margin = (opts && opts.margin) || 6;
    const valores = [START_B, ...texto.split("").map(valorDe)];
    const checksum = valores.reduce((acc, v, i) => (i === 0 ? v : acc + v * i), 0) % 103;
    valores.push(checksum, STOP);
    const modulos = valores.map((v) => PATTERNS[v]).join("");
    const total = modulos.split("").reduce((a, c) => a + Number(c), 0);
    const anchoUnidad = (width - margin * 2) / total;
    let x = margin, barras = "", negro = true;
    for (const ch of modulos) {
      const w = Number(ch) * anchoUnidad;
      if (negro) barras += `<rect x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="${height}" fill="#000"/>`;
      x += w; negro = !negro;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#fff"/>${barras}</svg>`;
  }
  window.OCBarcode = { code128SVG };
})();
