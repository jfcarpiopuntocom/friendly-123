#!/usr/bin/env node
import fs from 'node:fs';
import { rankCandidates } from './core.mjs';

const file=process.argv[2] || './golden-set.json';
const cases=JSON.parse(fs.readFileSync(file,'utf8'));
let rr=0, recall=0;
const rows=[];
for (const c of cases) {
  const ranked=rankCandidates(c.query,c.candidates,{project:c.project,top:10,now:c.now});
  const ids=ranked.map(x=>x.id);
  const positions=c.expected.map(id=>ids.indexOf(id)).filter(x=>x>=0).map(x=>x+1);
  const best=positions.length ? Math.min(...positions) : 0;
  if (positions.length) recall++;
  if (best) rr += 1/best;
  rows.push({query:c.query,best_rank:best,top3:ids.slice(0,3)});
}
const n=cases.length || 1;
console.log(JSON.stringify({
  cases:cases.length,
  recall_at_10:recall/n,
  mrr:rr/n,
  rows
},null,2));
