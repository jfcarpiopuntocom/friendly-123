'use strict';
// P1 CSV money safety: exercise the production export function verbatim inside
// an isolated VM. No real customer data, payment, network, or file downloads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../src/app/app-inline-01.js'), 'utf8');
const start = source.indexOf('async function exportarComisionesCSV(){');
const end = source.indexOf('async function enviarResumenWhatsApp(){', start);
assert.ok(start !== -1 && end > start, 'extract the actual production CSV export function');
const productionFunction = source.slice(start, end);

const dictionary = {
  en: {'comm.exportError':'Could not load commissions to export. Try again.',
       'comm.exportEmpty':'No commissions to export yet.'},
  es: {'comm.exportError':'No se pudieron cargar las comisiones para exportar. Inténtalo de nuevo.',
       'comm.exportEmpty':'Todavía no hay comisiones para exportar.'}
};
const liquidaciones = [{
  mes: '2026-11', ubicacion: 'Test shelf', promotorNombre: 'Synthetic artist',
  ventasBrutas: 20, pctBase: 30, comisionSocio: 6,
  pctQuedaEnCasa: 70, netoDueno: 14, estado: 'pendiente'
}];
const ventas = [{id:'synthetic-001', productoId:'demo', cantidad:1, total:20, mes:'2026-11'}];
const reply = (status, data) => ({ok: status >= 200 && status < 300, status,
  json: async () => data});

function fixture({language='en', salesResponse=reply(200, ventas),
  liquidationsResponse=reply(200, liquidaciones)} = {}) {
  const alerts=[], downloaded=[], responses=[], counters={sales:null};
  const links=[];
  const fakeURL = {
    createObjectURL(blob) {downloaded.push(blob); return 'blob:synthetic';},
    revokeObjectURL() {}
  };
  const context = {
    API:'/api', _ocMesComisiones:'2026-11', Promise, Date,
    URL:fakeURL, setTimeout() {}, console,
    alert(value) {alerts.push(String(value));},
    t(key) {return dictionary[language][key] || key;},
    Blob:class {
      constructor(parts, options) {this.text=parts.join('');this.type=options?.type;}
    },
    document: {
      createElement() {
        const a={href:'',download:'',clicked:false,removed:false,
          click() {this.clicked=true;},
          remove() {this.removed=true;}
        };
        links.push(a);
        return a;
      },
      body:{appendChild() {}}
    },
    agruparVentasPorProducto(all) {
      counters.sales=all;
      return [];
    },
    fetch(url) {
      responses.push(url);
      if(String(url).includes('/ventas/todas')) {
        if(salesResponse instanceof Error) return Promise.reject(salesResponse);
        return Promise.resolve(salesResponse);
      }
      if(String(url).includes('/liquidaciones?')) {
        if(liquidationsResponse instanceof Error) return Promise.reject(liquidationsResponse);
        return Promise.resolve(liquidationsResponse);
      }
      throw Error('Unexpected test endpoint: '+url);
    }
  };
  vm.createContext(context);
  vm.runInContext(productionFunction, context);
  return {run:()=>vm.runInContext('exportarComisionesCSV()',context),
    alerts,downloaded,links,responses,counters};
}

for (const language of ['en','es']) {
  test('P1 CSV '+language+': HTTP 503 on sales cannot export false zero', async()=>{
    const f=fixture({language,salesResponse:reply(503,[])});
    await f.run();
    assert.equal(f.downloaded.length,0, 'failed sales read must NEVER create misleading CSV');
    assert.equal(f.links.filter(x=>x.clicked).length,0,'failed export may not click download');
    assert.deepEqual(f.alerts,[dictionary[language]['comm.exportError']]);
  });
}

test('P1 CSV: fetch network rejection cannot export false zero',async()=>{
  const f=fixture({salesResponse:Error('synthetic offline')});
  await f.run();
  assert.equal(f.downloaded.length,0);
  assert.deepEqual(f.alerts,[dictionary.en['comm.exportError']]);
});

test('P1 CSV: HTTP 503 on liquidaciones is an ERROR, not an empty month',async()=>{
  const f=fixture({liquidationsResponse:reply(503,[])});
  await f.run();
  assert.equal(f.downloaded.length,0);
  assert.deepEqual(f.alerts,[dictionary.en['comm.exportError']]);
});

test('P1 CSV: genuine empty month retains its distinct empty notice',async()=>{
  const f=fixture({language:'es',salesResponse:reply(200,[]),liquidationsResponse:reply(200,[])});
  await f.run();
  assert.equal(f.downloaded.length,0);
  assert.deepEqual(f.alerts,[dictionary.es['comm.exportEmpty']]);
});

test('P1 CSV: all successful reads still produce original populated rack CSV',async()=>{
  const f=fixture();
  await f.run();
  assert.equal(f.downloaded.length,1, 'valid data should download exactly one CSV');
  assert.equal(f.links.length,1);
  assert.equal(f.links[0].download,'comisiones-2026-11.csv');
  assert.equal(f.links[0].clicked,true);
  assert.equal(f.links[0].removed,true);
  assert.match(f.downloaded[0].text,/Test shelf,Synthetic artist,20\.00/);
  assert.equal(f.counters.sales.length,1,'product aggregation must still get actual sales');
  assert.deepEqual(f.alerts,[]);
});
