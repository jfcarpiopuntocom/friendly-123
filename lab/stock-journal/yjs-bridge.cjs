'use strict';
/*
 * Isolated Yjs adapter for the shadow-only journal (never loaded by the PWA).
 * Important: Y.Map keys include SHA-256 of the FULL immutable event; conflicting
 * payloads with the SAME event ID remain visible as separate witness entries.
 * Never use eventId alone as a Y.Map key (LWW hides evidence of collisions).
 */
const {Journal,validate,stable}=require('./engine.cjs');
async function sha256(s) {
 if (typeof globalThis.crypto!=='undefined' && globalThis.crypto.subtle &&
     typeof globalThis.TextEncoder!=='undefined') {
   const data=new TextEncoder().encode(s);
   const bytes=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',data));
   return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
 }
 return require('node:crypto').createHash('sha256').update(s).digest('hex');
}
class ShadowYjsBridge {
 constructor(doc,journal,namespace='f123-stock-journal-shadow-v1') {
   if (!doc || typeof doc.getMap!=='function') throw Error('Y.Doc required');
   if (!(journal instanceof Journal)) throw Error('Journal required');
   this.doc=doc;this.journal=journal;this.map=doc.getMap(namespace);
   this.errors=[];this.inbound=0;this._queue=Promise.resolve();
   this._witnesses=new Map(); // known, already hash-verified immutable evidence
   this._observer=e=>{
     for (const key of e.keysChanged) {
       if (this.map.has(key)) this._schedule(key);
       else this._restoreKnown(key); // Yjs allows tombstones; business facts do not.
     }
   };
   this.map.observe(this._observer);
   for (const key of this.map.keys()) this._schedule(key);
 }
 _schedule(key) {
   this._queue=this._queue.then(async()=>{
     const raw=this.map.get(key);
     if (typeof raw!=='string') throw Error('event witness must be canonical string');
     const event=JSON.parse(raw);
     const normalized=validate(event,this.journal.notebook);
     const expected=normalized.id+'#'+await sha256(stable(normalized));
     if (key!==expected || raw!==stable(normalized))
       throw Error('event witness hash mismatch');
     const r=this.journal.append(normalized);
     this._witnesses.set(key,raw);
     this.inbound++;
     if (!r.ok) this.errors.push({key,reason:r.reason,id:normalized.id});
   }).catch(err=>{
     this.errors.push({key,reason:err.message});
   });
 }
 _restoreKnown(key) {
   this._queue=this._queue.then(()=>{
     const raw=this._witnesses.get(key);
     if (raw && !this.map.has(key)) this.map.set(key,raw);
     else if (!raw) this.errors.push({key,reason:'deleted-unknown-witness'});
   }).catch(err=>this.errors.push({key,reason:err.message}));
 }
 async publish(event) {
   const e=validate(event,this.journal.notebook);
   const raw=stable(e),key=e.id+'#'+await sha256(raw);
   const checked=this.journal.append(e);
   if (!checked.ok) return checked;
   if (this.map.has(key) && this.map.get(key)!==raw)
     throw Error('witness-key digest collision');
   this._witnesses.set(key,raw);
   if (!this.map.has(key)) this.map.set(key,raw);
   return {ok:true,added:checked.added,key};
 }
 async flush() {
   // Restoring a tombstone emits another Y.Map update; drain the resulting
   // observer work before claiming the peer has processed the state.
   while (true) { const pending=this._queue; await pending; if (pending===this._queue) break; }
   return {inbound:this.inbound,errors:this.errors.length};
 }
 close(){this.map.unobserve(this._observer);}
}
module.exports={ShadowYjsBridge,sha256};
