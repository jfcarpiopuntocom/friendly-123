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
   this._observer=e=>{
     for (const key of e.keysChanged) {
       if (this.map.has(key)) this._schedule(key);
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
     this.inbound++;
     if (!r.ok) this.errors.push({key,reason:r.reason,id:normalized.id});
   }).catch(err=>{
     this.errors.push({key,reason:err.message});
   });
 }
 async publish(event) {
   const e=validate(event,this.journal.notebook);
   const raw=stable(e),key=e.id+'#'+await sha256(raw);
   const checked=this.journal.append(e);
   if (!checked.ok) return checked;
   if (this.map.has(key) && this.map.get(key)!==raw)
     throw Error('witness-key digest collision');
   if (!this.map.has(key)) this.map.set(key,raw);
   return {ok:true,added:checked.added,key};
 }
 async flush() {await this._queue;return {inbound:this.inbound,errors:this.errors.length};}
 close(){this.map.unobserve(this._observer);}
}
module.exports={ShadowYjsBridge,sha256};
