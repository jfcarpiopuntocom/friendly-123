#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';

const root = process.cwd();
const mode = process.argv.includes('--enforce') ? 'enforce' : 'shadow';
const result = { gate:'production-guardian', mode, status:'PASS', blockers:[], warnings:[], evidence:[] };
const add = (kind, code, detail) => {
  result[kind].push({code, detail});
  if (kind === 'blockers') result.status = 'BLOCK';
  else if (result.status === 'PASS') result.status = 'WATCH';
};
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const exists = p => fs.existsSync(path.join(root,p));
const run = cmd => cp.execSync(cmd,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();

try {
  if (!exists('docs/version.json') || !exists('docs/sw.js')) add('blockers','PG001','Missing docs/version.json or docs/sw.js');
  else {
    const v = JSON.parse(read('docs/version.json'));
    const sw = read('docs/sw.js');
    if (v.shell !== 'f123-shell-v448') add('blockers','PG002',`Public shell must remain f123-shell-v448, got ${v.shell}`);
    if (v.releaseName !== 'v448 GOLDEN') add('blockers','PG003',`releaseName must remain v448 GOLDEN, got ${v.releaseName}`);
    if (!/const CACHE\s*=\s*["']f123-shell-v448["']/.test(sw)) add('blockers','PG004','Service worker CACHE is not pinned to v448');
    if (!/^golden\d+$/.test(String(v.cacheGeneration || ''))) add('warnings','PG005','cacheGeneration is not an explicit golden generation');
    result.evidence.push({code:'golden-identity', shell:v.shell, releaseName:v.releaseName, cacheGeneration:v.cacheGeneration || null});
  }

  if (!exists('DATA-INTEGRITY-PRIME-DIRECTIVE.md')) add('blockers','PG006','Missing DATA-INTEGRITY-PRIME-DIRECTIVE.md');
  else {
    const d = read('DATA-INTEGRITY-PRIME-DIRECTIVE.md');
    for (const phrase of ['Preserve > clean up','Migrations are copy-only','Photos are append-only evidence','No guessing in automatic recovery']) {
      if (!d.includes(phrase)) add('blockers','PG007',`Prime Directive invariant missing: ${phrase}`);
    }
  }

  let diff = '';
  try {
    const base = process.env.GUARD_BASE || 'origin/master';
    diff = run(`git diff --no-ext-diff --unified=0 ${base}...HEAD -- docs cloudflare-worker cloudflare-sync-relay`);
  } catch {
    try { diff = run('git diff --no-ext-diff --unified=0 HEAD~1..HEAD -- docs cloudflare-worker cloudflare-sync-relay'); }
    catch { add('warnings','PG008','Could not inspect changed production lines'); }
  }
  const added = diff.split(/\r?\n/).filter(l => l.startsWith('+') && !l.startsWith('+++')).join('\n');
  const destructive = [
    [/localStorage\.clear\s*\(/i,'localStorage.clear'],
    [/indexedDB\.deleteDatabase\s*\(/i,'indexedDB.deleteDatabase'],
    [/\.delete\s*\([^)]*(foto|photo|venta|sale|producto|product|ubicacion|shelf)/i,'physical delete of business evidence'],
    [/removeItem\s*\([^)]*(foto|photo|venta|sale|producto|product|ubicacion|shelf)/i,'removal of business evidence']
  ];
  for (const [re,label] of destructive) if (re.test(added)) add('blockers','PG009',`New destructive production line detected: ${label}`);

  let changed = [];
  try { changed = run(`git diff --name-only ${process.env.GUARD_BASE || 'origin/master'}...HEAD`).split(/\r?\n/).filter(Boolean); } catch {}
  const riskTouched = changed.some(f => /^(docs\/(mock-backend|sync-realtime|sync-yjs|idb-fotos|auth-ui)\.js|docs\/dashboard\.html|cloudflare-(worker|sync-relay)\/)/.test(f));
  const testsTouched = changed.some(f => /^test\/.+\.test\.js$/.test(f));
  if (riskTouched && !testsTouched) add('warnings','PG010','Risk-sensitive production code changed without a test file in the same change set');
  result.evidence.push({code:'changed-files', count:changed.length, riskTouched, testsTouched});
} catch (e) {
  add('blockers','PG999',e.stack || e.message || String(e));
}

fs.mkdirSync('.artifacts',{recursive:true});
fs.writeFileSync('.artifacts/production-guardian.json', JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
if (result.status === 'BLOCK' || (mode === 'enforce' && result.status === 'WATCH')) process.exit(1);
