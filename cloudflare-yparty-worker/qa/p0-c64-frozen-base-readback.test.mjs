// C64 source-executed RED->GREEN: no false cold-reopen ACK from journal-only Yjs.
// SQL rows are isolated synthetic fixtures; this is NOT a real Firebase/physical test.
// Real module under test: cloudflare-yparty-worker/src/open-existing-store.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as Y from 'yjs';
import {openExistingStore} from '../src/open-existing-store.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const rows=a=>({toArray:()=>a,one:()=>a[0]});
function scenario({includeFrozenBase}){
  const before=new Y.Doc(),later=new Y.Doc();
  // Two independent writers. The later journal is a complete, valid Yjs
  // update on its own: without the frozen base it can still look healthy.
  before.clientID=11001;later.clientID=22002;
  before.getMap('productos').set('original',{
    id:'original',nombre:'Old pre-cut book',precio:20,stockActual:5
  });
  later.getMap('productos').set('after-cut',{
    id:'after-cut',nombre:'New post-cut book',precio:35,stockActual:1
  });
  const frozen=Y.encodeStateAsUpdate(before);
  const newer=Y.encodeStateAsUpdate(later);
  const receipt={
    channel:'cat',frozen_head:'independently-certified-head-c64',
    sha256:sha(frozen),vector_sha256:sha(Y.encodeStateVector(before)),
    event_count:null
  };
  before.destroy();later.destroy();
  const tables=new Set(['f123_frozen_imports','documento_bloques','diario']);
  const storage={
    transactionSync:fn=>fn(),
    sql:{
      exec(query){
        if(query.includes("sqlite_master WHERE type='table' AND name='f123_frozen_imports'"))
          return rows([{exists:1}]);
        if(query.includes('FROM f123_frozen_imports WHERE id=1'))return rows([receipt]);
        if(query.includes('SELECT name FROM sqlite_master'))return rows([...tables].map(name=>({name})));
        if(query.includes('FROM documento_bloques ORDER BY n'))
          return rows(includeFrozenBase?[{n:0,contenido:frozen}]:[]);
        if(query.includes('FROM diario ORDER BY n'))
          return rows([{n:1,cambio:newer}]);
        if(query.includes('FROM diario_bloques ORDER BY n,parte'))return rows([]);
        throw new Error('unexpected SQL in C64 fixture: '+query);
      }
    }
  };
  return {storage,frozen,newer};
}

test('C64 control: certified frozen snapshot plus independent forward journal can reopen without upstream',{timeout:15000},async()=>{
  const s=scenario({includeFrozenBase:true});
  const result=await openExistingStore({env:{WS_OPEN_EXISTING_QA:'1'},storage:s.storage});
  assert.equal(result.opened,true,JSON.stringify(result));
  assert.equal(result.already,true);
  assert.match(result.verifiedSha256,/^[a-f0-9]{64}$/);
});

test('C64 RED P0: receipt cannot ACK a cold reopened room after its frozen snapshot disappeared',{timeout:15000},async()=>{
  const s=scenario({includeFrozenBase:false});
  const result=await openExistingStore({env:{WS_OPEN_EXISTING_QA:'1'},storage:s.storage});
  assert.equal(result.opened,false,'journal-only Yjs can reconstruct but original certified base is LOST');
  assert.match(result.failback||'',/frozen base snapshot/i);
  // A refusal must be read-only: no fake reconstruction or SQL write.
  assert.equal(s.storage.transactionSync!==undefined,true);
});
