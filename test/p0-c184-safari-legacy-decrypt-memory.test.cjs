'use strict';
const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = fs.readFileSync('docs/sync-yjs.js', 'utf8');
const begin = source.indexOf('    function clasificarHeredados() {');
const end = source.indexOf('    // JFC test room:', begin);
assert.ok(begin >= 0 && end > begin, 'extract exact production classifier');

const makeClassifier = new Function('_outbox', 'API', 'descifrarBin', 'mutarOutbox', 'log',
  'var _heredadosListo = false;\n' + source.slice(begin, end) + '\nreturn clasificarHeredados;');

function envelope(id, groupIndex, idx, total) {
  const gid = 'G' + String(groupIndex).padStart(15, '0');
  const bytes = Buffer.alloc(22);
  bytes[0] = 3;
  bytes.write(gid, 2, 'ascii');
  bytes.writeUInt16BE(idx, 18);
  bytes.writeUInt16BE(total, 20);
  return { id, k: 'op', c: bytes.toString('base64') };
}

test('C184 Safari: legacy outbox decrypts at most four envelopes concurrently and retains every ciphertext', async () => {
  const pending = [];
  for (let group = 1; group <= 10; group++)
    for (let i = 0; i < 20; i++)
      pending.push(envelope(group + ':' + i, group, i, 20));
  const broken = envelope('partial:0', 99, 0, 2);
  const malformed = { id: 'bad', k: 'op', c: Buffer.from([1, 2]).toString('base64') };
  pending.push(broken, malformed);
  const alreadyGrouped = Object.assign(envelope('grouped', 77, 0, 1), { group: 'already-verified' });
  pending.push(alreadyGrouped);
  const initialCiphertext = pending.map(p => p.c);
  const outbox = { pending, checkpoint: 'unchanged', confirmed: ['receipt'] };
  let active = 0, peak = 0, mutations = 0;
  const decrypt = async (key, bytes) => {
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 2));
      return new Uint8Array(bytes);
    } finally {
      active--;
    }
  };
  const mutate = change => { mutations++; change(); return Promise.resolve(); };
  const classify = makeClassifier(outbox, { clave: {} }, decrypt, mutate, () => {});
  await classify();
  assert.ok(peak <= 4, 'unbounded Promise.all decrypts every legacy envelope at once; peak=' + peak);
  assert.equal(pending.length, 203, 'no deletion or compaction');
  assert.deepEqual(pending.map(p => p.c), initialCiphertext, 'ciphertext is byte-identical');
  assert.equal(outbox.checkpoint, 'unchanged');
  assert.deepEqual(outbox.confirmed, ['receipt']);
  assert.equal(mutations, 1);
  for (const p of pending.slice(0, 200))
    assert.equal(p.group, 'G' + p.id.split(':')[0].padStart(15, '0'), 'complete group preserved');
  assert.equal(broken.group, undefined);
  assert.ok(broken.huerfano && broken.huerfano.total === 2, 'partial group quarantined as before');
  assert.equal(malformed.group, undefined, 'malformed envelope retained');
  assert.equal(alreadyGrouped.group, 'already-verified');
  const calls = mutations;
  await classify();
  assert.equal(mutations, calls, 'classification at most once per channel lifetime');
});
