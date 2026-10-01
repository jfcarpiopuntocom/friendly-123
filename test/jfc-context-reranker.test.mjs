import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  rankCandidates,
  buildContextPack,
  normalizeText,
  hashEmbedding,
  cosineSimilarity
} from '../.ai/reranker/core.mjs';

const now = '2026-10-01T12:00:00Z';

test('explicit constraints outrank semantically similar secondary notes', () => {
  const candidates = [
    { id:'old', source:'notion', title:'friendly commissions ideas', text:'comisiones por producto, ideas antiguas', project:'friendly-123', authority:0.45, updated_at:'2026-09-01T00:00:00Z' },
    { id:'rule', source:'repo', title:'AGENTS.md', text:'COUNTER NO ES LA CASA; venta de mostrador conserva comisión', project:'friendly-123', authority:0.95, constraint:true, updated_at:'2026-10-01T00:00:00Z' }
  ];
  const ranked = rankCandidates('comisiones mostrador', candidates, { project:'friendly-123', now });
  assert.equal(ranked[0].id, 'rule');
  assert.equal(ranked[0].constraint, true);
});

test('cross-project distractors are penalized', () => {
  const candidates = [
    { id:'f', source:'notion', title:'friendly', text:'vista Por Producto de comisiones', project:'friendly-123', authority:0.8, updated_at:'2026-09-30T00:00:00Z' },
    { id:'c', source:'notion', title:'consultorio', text:'vista Por Producto de comisiones', project:'consultorio-123', authority:0.9, updated_at:'2026-10-01T00:00:00Z' }
  ];
  const ranked = rankCandidates('Por Producto comisiones', candidates, { project:'friendly-123', now });
  assert.equal(ranked[0].id, 'f');
});

test('near duplicate chunks collapse to one result', () => {
  const candidates = [
    { id:'a', source:'notion', title:'A', text:'Belén pidió que Por Producto muestre total por producto y reparto casa asociado.', project:'friendly-123', authority:0.9, updated_at:'2026-10-01T00:00:00Z' },
    { id:'b', source:'notion', title:'B', text:'Belen pidio que Por Producto muestre total por producto y reparto casa asociado', project:'friendly-123', authority:0.88, updated_at:'2026-10-01T00:00:00Z' }
  ];
  const ranked = rankCandidates('Belen Por Producto', candidates, { project:'friendly-123', now });
  assert.equal(ranked.length, 1);
});

test('hash embeddings are deterministic and produce useful cosine similarity', () => {
  const a = hashEmbedding(normalizeText('comisiones por producto'), 128);
  const b = hashEmbedding(normalizeText('comisiones producto'), 128);
  const c = hashEmbedding(normalizeText('SEO homepage canonical'), 128);
  assert.deepEqual(a, hashEmbedding(normalizeText('comisiones por producto'), 128));
  assert.ok(cosineSimilarity(a,b) > cosineSimilarity(a,c));
});

test('context pack separates constraints, conflicts and top facts', () => {
  const ranked = rankCandidates('música reel', [
    { id:'m1', source:'chat', title:'Current instruction', text:'Usar la misma música del primer video.', project:'friendly-123', authority:1, constraint:true, updated_at:'2026-10-01T11:00:00Z' },
    { id:'m2', source:'notion', title:'Old note', text:'Usar chunky bass jazz.', project:'friendly-123', authority:0.4, superseded:true, updated_at:'2026-10-01T10:00:00Z' }
  ], { project:'friendly-123', now });
  const pack = buildContextPack('música reel', ranked, { top:6 });
  assert.match(pack, /CURRENT CONSTRAINTS/);
  assert.match(pack, /misma música/i);
  assert.match(pack, /SUPERSEDED/);
});

test('benchmark CLI runs and reports recall/MRR', () => {
  const r = spawnSync(process.execPath, ['.ai/reranker/benchmark.mjs','.ai/reranker/golden-set.json'], { encoding:'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.cases, 3);
  assert.ok(out.recall_at_10 >= 0.99);
  assert.ok(out.mrr >= 0.99);
});

test('ranking CLI emits a compact context pack', () => {
  const data = JSON.parse(fs.readFileSync('.ai/reranker/golden-set.json','utf8'))[0].candidates;
  const tmp = '.ai/reranker/.tmp-candidates.json';
  fs.writeFileSync(tmp, JSON.stringify(data));
  try {
    const r = spawnSync(process.execPath, ['.ai/reranker/index.mjs','--query','música reel','--input',tmp,'--project','friendly-123','--mode','deep'], { encoding:'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /CURRENT CONSTRAINTS/);
    assert.match(r.stdout, /same music/i);
  } finally {
    fs.rmSync(tmp,{force:true});
  }
});
