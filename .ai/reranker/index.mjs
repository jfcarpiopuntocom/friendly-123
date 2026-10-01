#!/usr/bin/env node
import fs from 'node:fs';
import { rankCandidates, buildContextPack } from './core.mjs';

function argsOf(argv) {
  const out={};
  for (let i=0;i<argv.length;i++) {
    if (!argv[i].startsWith('--')) continue;
    const k=argv[i].slice(2);
    const next=argv[i+1];
    out[k] = next && !next.startsWith('--') ? argv[++i] : true;
  }
  return out;
}

const a=argsOf(process.argv.slice(2));
if (!a.query || !a.input) {
  console.error('usage: node index.mjs --query "..." --input candidates.json --project friendly-123 --mode deep --top 12 [--format json|md]');
  process.exit(2);
}
const raw=JSON.parse(fs.readFileSync(a.input,'utf8'));
const candidates=Array.isArray(raw) ? raw : raw.candidates || [];
const mode=a.mode || 'deep';
const defaults={fast:6,deep:12,forensic:18};
const top=Number(a.top || defaults[mode] || 12);
const ranked=rankCandidates(a.query,candidates,{project:a.project,top,now:a.now});
if ((a.format||'md')==='json') {
  process.stdout.write(JSON.stringify({query:a.query,project:a.project||null,mode,ranked},null,2)+'\n');
} else {
  process.stdout.write(buildContextPack(a.query,ranked,{top})+'\n');
}
