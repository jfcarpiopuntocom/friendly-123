import crypto from 'node:crypto';

const DEFAULT_WEIGHTS = Object.freeze({
  reranker: 0.50,
  exact: 0.18,
  authority: 0.12,
  freshness: 0.10,
  project: 0.07,
  pinned: 0.03,
  stalePenalty: 0.22,
  crossProjectPenalty: 0.35
});

const STOP = new Set([
  'a','al','and','are','as','at','con','de','del','el','en','es','for','in','la','las','los',
  'of','on','or','para','por','que','the','to','un','una','y'
]);

export function normalizeText(value='') {
  return String(value)
    .normalize('NFD').replace(/\p{Diacritic}/gu,'')
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

export function tokens(value='') {
  return normalizeText(value).split(' ').filter(t => t && !STOP.has(t));
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i=0;i<str.length;i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashEmbedding(text, dims=256) {
  const v = new Array(dims).fill(0);
  const ts = tokens(text);
  const feats = [];
  for (const t of ts) {
    feats.push(`w:${t}`);
    if (t.length >= 4) {
      for (let i=0;i<=t.length-3;i++) feats.push(`c:${t.slice(i,i+3)}`);
    }
  }
  for (let i=0;i<ts.length-1;i++) feats.push(`b:${ts[i]}_${ts[i+1]}`);
  for (const f of feats) {
    const h = fnv1a(f);
    const idx = h % dims;
    const sign = (h & 0x80000000) ? -1 : 1;
    v[idx] += sign;
  }
  const norm = Math.hypot(...v) || 1;
  return v.map(x => x / norm);
}

export function cosineSimilarity(a,b) {
  let s=0;
  const n=Math.min(a.length,b.length);
  for (let i=0;i<n;i++) s += a[i]*b[i];
  return Math.max(-1, Math.min(1, s));
}

function overlapScore(query, candidate) {
  const q = new Set(tokens(query));
  const text = new Set(tokens(`${candidate.title||''} ${candidate.text||''}`));
  if (!q.size) return 0;
  let hit=0;
  for (const t of q) if (text.has(t)) hit++;
  return hit / q.size;
}

function phraseScore(query, candidate) {
  const q=normalizeText(query);
  const t=normalizeText(`${candidate.title||''} ${candidate.text||''}`);
  if (!q) return 0;
  if (t.includes(q)) return 1;
  return overlapScore(query,candidate);
}

function freshnessScore(updatedAt, now) {
  const a = Date.parse(updatedAt || '');
  const b = Date.parse(now || new Date().toISOString());
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0.35;
  const days = Math.max(0, (b-a)/86400000);
  return Math.exp(-days/45);
}

function projectScore(candidateProject, project) {
  if (!project) return 0.5;
  if (!candidateProject) return 0.35;
  return normalizeText(candidateProject) === normalizeText(project) ? 1 : 0;
}

function dedupeTokens(c) {
  const body = normalizeText(c.text || '').replace(/[._/-]+/g, ' ');
  return new Set(tokens(body));
}

function nearDuplicate(a,b) {
  const ta = dedupeTokens(a);
  const tb = dedupeTokens(b);
  if (!ta.size || !tb.size) return false;
  let common=0;
  for (const t of ta) if (tb.has(t)) common++;
  const j = common / (ta.size + tb.size - common);
  return j >= 0.86;
}

export function scoreCandidate(query, candidate, options={}) {
  const weights={...DEFAULT_WEIGHTS,...(options.weights||{})};
  const qVec=hashEmbedding(query, options.dims||256);
  const cVec=hashEmbedding(`${candidate.title||''} ${candidate.text||''}`, options.dims||256);
  const embedding=Math.max(0,cosineSimilarity(qVec,cVec));
  const exact=phraseScore(query,candidate);
  const authority=Math.max(0,Math.min(1,Number(candidate.authority ?? 0.5)));
  const freshness=freshnessScore(candidate.updated_at, options.now);
  const project=projectScore(candidate.project, options.project);
  const pinned=candidate.user_pinned ? 1 : 0;
  const stale=candidate.superseded ? weights.stalePenalty : 0;
  const cross=(options.project && candidate.project && project===0) ? weights.crossProjectPenalty : 0;
  let score =
    weights.reranker*embedding +
    weights.exact*exact +
    weights.authority*authority +
    weights.freshness*freshness +
    weights.project*project +
    weights.pinned*pinned -
    stale - cross;
  if (candidate.constraint) score += 2;
  return {...candidate, scores:{embedding,exact,authority,freshness,project,pinned,stale,cross}, final_score:score};
}

export function rankCandidates(query, candidates, options={}) {
  const scored=(candidates||[])
    .filter(Boolean)
    .map(c=>scoreCandidate(query,c,options))
    .sort((a,b)=> b.final_score-a.final_score);

  const out=[];
  for (const c of scored) {
    if (out.some(x=>nearDuplicate(x,c))) continue;
    out.push(c);
  }
  return out.slice(0, options.top || out.length);
}

export function buildContextPack(query, ranked, options={}) {
  const top=(ranked||[]).slice(0, options.top||10);
  const constraints=top.filter(x=>x.constraint && !x.superseded);
  const superseded=top.filter(x=>x.superseded);
  const facts=top.filter(x=>!x.constraint && !x.superseded);
  const lines = [];
  lines.push(`TASK\n${query}`);
  lines.push('\nCURRENT CONSTRAINTS');
  if (!constraints.length) lines.push('- none surfaced');
  for (const c of constraints) lines.push(`- [${c.source||'unknown'}:${c.id||'?'}] ${c.title||''}: ${c.text||''}`);
  lines.push('\nTOP FACTS');
  if (!facts.length) lines.push('- none surfaced');
  for (const c of facts) lines.push(`- [${c.source||'unknown'}:${c.id||'?'} score=${c.final_score.toFixed(3)}] ${c.title||''}: ${c.text||''}`);
  lines.push('\nCONFLICTS / UNCERTAINTY');
  if (!superseded.length) lines.push('- none flagged');
  else for (const c of superseded) lines.push(`- superseded [${c.source||'unknown'}:${c.id||'?'}] ${c.title||''}: ${c.text||''}`);
  lines.push('\nSOURCE POINTERS');
  for (const c of top) lines.push(`- ${c.source||'unknown'}:${c.id||'?'} ${c.path||c.url||''}`.trim());
  lines.push('\nFILES TO READ FULLY');
  for (const c of top.filter(x=>x.constraint || x.authority>=0.85).slice(0,5)) lines.push(`- ${c.path||c.url||c.title||c.id}`);
  lines.push('\nSUPERSEDED');
  if (!superseded.length) lines.push('- none');
  else for (const c of superseded) lines.push(`- ${c.id||'?'} ${c.title||''}`);
  return lines.join('\n');
}

export function checksumText(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}
