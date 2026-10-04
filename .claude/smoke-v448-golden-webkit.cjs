const { webkit } = require("playwright");
const path = require("node:path");

function check(name, ok, detail) {
  if (!ok) throw new Error(name + (detail ? " -> " + JSON.stringify(detail) : ""));
  console.log("ok - " + name);
}
const strings = {
  "shelves.noRacksYet":"No shelves yet","shelves.noTarget":"No target","shelves.ofTargetMet":"% target",
  "shelves.monthlySales":"Monthly sales","shelves.target":"Target","shelves.commission":"Commission",
  "shelves.promoter":"Promoter","shelves.open":"Open","shelves.transfersHeading":"Transfers",
  "shelves.addRackBtn":"Add shelf","common.close":"Close","shelves.newRackTitle":"New shelf",
  "shelves.rackNameLabel":"Name","shelves.rackNamePlaceholder":"Shelf name","shelves.assignHint":"Assign",
  "shelves.createRackBtn":"Create"
};

(async () => {
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent('<!doctype html><html><body><section id="vista-perchas" class="activa"><div id="vp-orden"></div><div id="vp-grid"></div><div id="vp-transfers"></div></section></body></html>');
    await page.evaluate((strings) => {
      const photo = "data:image/png;base64,V0VCS0lULVBIT1RP";
      window.__photo = photo;
      window.__ids = {};
      window.__puts = [];
      window.__shelf = { id:"wk-shelf", nombre:"WebKit shelf", tipo:"socio", activa:true, borrado:false, fotoHash:"wk-hash", fotoRev:{c:3,d:'webkit'} };
      window.t = (k) => strings[k] || k;
      window.OCI18n = { locale: () => "en-US" };
      window.OCMoneda = { codigo: () => "USD" };
      window.OCAuth = { puedeGestionar: () => false };
      window.OCFotos = {
        migrarSiHaceFalta: async () => {},
        leerTodas: async () => ({...window.__ids}),
        guardarFoto: async (id,d) => { window.__ids[id]=d; return true; },
        borrarFoto: async (id) => { delete window.__ids[id]; },
        guardarFotoContenido: async (d) => d === photo ? "wk-hash" : "other",
        leerPorHash: async (h) => h === "wk-hash" ? photo : null,
        guardarPorHash: async () => true,
        hashDeDataUrl: async (d) => d === photo ? "wk-hash" : "other"
      };
      window.fetch = async (input, options={}) => {
        const url=String(input);
        if ((options.method||"GET")==="PUT") {
          window.__puts.push({url,body:JSON.parse(options.body||"{}")});
          return new Response("{}",{status:200,headers:{"Content-Type":"application/json"}});
        }
        let body=[];
        if(url==="/api/ubicaciones") body=[{...window.__shelf}];
        else if(url==="/api/liquidaciones"||url==="/api/promotoras"||url==="/api/transferencias") body=[];
        return new Response(JSON.stringify(body),{status:200,headers:{"Content-Type":"application/json"}});
      };
    }, strings);
    await page.addScriptTag({ path:path.resolve(__dirname,"../docs/vista-perchas.js") });

    await page.evaluate(() => window.VPerchas.cargar());
    let out = await page.evaluate(() => ({
      img: document.querySelector("#vp-grid img")?.getAttribute("src") || null,
      mirror: window.__ids["wk-shelf"] || null
    }));
    check("WebKit renders current hash photo", out.img === "data:image/png;base64,V0VCS0lULVBIT1RP", out);
    check("WebKit mirrors displayed hash photo under shelf id", out.mirror === out.img, out);

    await page.evaluate(() => { window.__shelf.fotoHash = null; });
    await page.evaluate(() => window.VPerchas.cargar());
    out = await page.evaluate(() => ({
      img: document.querySelector("#vp-grid img")?.getAttribute("src") || null,
      puts: window.__puts.slice()
    }));
    check("WebKit keeps exact photo visible after legacy pointer loss", out.img === "data:image/png;base64,V0VCS0lULVBIT1RP", out);
    check("WebKit self-heals pointer from exact id bytes", out.puts.some(x => x.body && x.body.fotoHash === "wk-hash"), out);

    console.log("TODO VERDE - WebKit/iPhone-size v448-golden shelf photo smoke");
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
