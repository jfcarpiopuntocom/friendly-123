'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const code = fs.readFileSync(require('node:path').join(__dirname,'../docs/auth-ui.js'),'utf8');
const begin = code.indexOf('function pintarNegocioGate() {');
const end = code.indexOf('/* Pinta la versión REAL',begin);
assert.ok(begin>0 && end>begin);
const block = code.slice(begin,end);
assert.match(block,/const nombre = activo;/);
assert.doesNotMatch(block,/const nombre = activo \|\|/);
console.log('PASS: PIN name comes exclusively from the current active notebook');

const block = code.slice(begin,end);

const vm = require('node:vm');
function gateDisplay(activeName) {
  const el = { innerHTML: '', style: { display: 'none' } };
  const ctx = {
    document: { getElementById: () => el },
    localStorage: { getItem: () => JSON.stringify({ nombreNegocio: 'OLD SIDE CAR', licenseCode: 'F123-TEST' }) },
    window: { OCTienda: { esUnida: () => false, nombreActivo: () => activeName }, t: x => x },
    dispositivoApropiado: () => true
  };
  vm.runInNewContext(block + '\npintarNegocioGate();', ctx);
  return el;
}
assert.equal(gateDisplay('').style.display, 'none');
assert.match(gateDisplay('NEW ACTIVE SHOP').innerHTML, /NEW ACTIVE SHOP/);
assert.doesNotMatch(gateDisplay('NEW ACTIVE SHOP').innerHTML, /OLD SIDE CAR/);
