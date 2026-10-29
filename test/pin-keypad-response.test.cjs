const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('PIN validates on the next event turn, ignores extra clicks, and resets for correction', () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../docs/auth-ui.js'), 'utf8');
  const start = source.indexOf('  function montarTeclado(');
  const end = source.indexOf('  // ---------- Candado principal', start);
  const jobs = new Map(); let sequence = 0;
  const slots = Array.from({length: 3}, () => ({textContent: '', classList: {add(){}, remove(){}}}));
  const pad = {dataset: {}, appendChild(){}, addEventListener(type, fn){ this.click = fn; }};
  const context = {document: {createElement: () => ({dataset: {}})}, setTimeout(fn, ms){const id=++sequence; jobs.set(id,{fn,ms}); return id;}, clearTimeout(id){jobs.delete(id);}};
  vm.createContext(context); vm.runInContext(source.slice(start,end),context);
  const completed=[];
  const keyboard=context.montarTeclado(pad,{querySelectorAll:()=>slots},pin=>completed.push(pin));
  function click(d){pad.click({target:{closest:()=>({dataset:{d:String(d)}})}});}
  [1,2,3,4].forEach(click);
  assert.deepEqual(completed, []);
  assert.equal(slots.map(s=>s.textContent).join(''),'●●3');
  const pending=[...jobs.values()].filter(j=>j.ms!==300);
  assert.equal(pending.length,1);
  assert.equal(pending[0].ms,0,'no artificial pause after the complete PIN');
  pending[0].fn(); jobs.clear();
  assert.deepEqual(completed,['123']);
  keyboard.reset();
  assert.equal(slots.map(s=>s.textContent).join(''),'');
  [9,8,7].forEach(click);
  [...jobs.values()].find(j=>j.ms===0).fn();
  assert.deepEqual(completed,['123','987']);
});
