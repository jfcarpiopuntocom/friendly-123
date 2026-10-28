'use strict';
/*
 * friendly-123 / isolated shadow inventory journal, schema 1.
 * NO integration with production data. No browser storage, relay, or timers.
 * Algorithmic prototype for Claude review, never the source of truth by default.
 * All records are immutable; set-union replication is order independent.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.F123StockJournalShadow = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const TYPES = new Set(['OPEN', 'RECEIVE', 'ORDER', 'FULFILL', 'CANCEL',
    'RETURN', 'LOSS', 'ADJUST', 'COUNT']);
  const PHYSICAL = new Set(['OPEN', 'RECEIVE', 'FULFILL', 'RETURN', 'LOSS', 'ADJUST']);
  const FIELDS = new Set(['id','kind','notebook','product','device','seq','qty',
    'delta','orderId','observes','supersedes','afterCountId','memo']);
  function own(o,k) { return Object.prototype.hasOwnProperty.call(o,k); }
  function stable(o) {
    if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
    if (o && typeof o === 'object') return '{' + Object.keys(o).sort()
      .map(k=>JSON.stringify(k)+':'+stable(o[k])).join(',') + '}';
    return JSON.stringify(o);
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function label(v) { return typeof v === 'string' && v.length > 0 && v.length <= 180; }
  function nonnegative(v) { return Number.isSafeInteger(v) && v >= 0; }
  function positive(v) { return Number.isSafeInteger(v) && v > 0; }
  function list(v) { return Array.isArray(v) && v.every(label) && new Set(v).size === v.length; }
  function validate(e, notebook) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw Error('event must be object');
    if (Object.keys(e).some(k=>!FIELDS.has(k))) throw Error('unexpected event field');
    for (const name of ['id','notebook','product','device']) if (!label(e[name])) throw Error('invalid '+name);
    if (e.notebook !== notebook) throw Error('cross-notebook event refused');
    if (!TYPES.has(e.kind)) throw Error('unknown event kind');
    if (!positive(e.seq)) throw Error('sequence must be a positive integer');
    if (e.memo != null && (typeof e.memo !== 'string' || e.memo.length > 300)) throw Error('invalid memo');
    if (e.kind === 'ADJUST') {
      if (!Number.isSafeInteger(e.delta) || e.delta === 0) throw Error('adjust delta required');
      if (own(e,'qty')) throw Error('adjust uses delta, not qty');
    } else {
      if (e.kind === 'OPEN' || e.kind === 'COUNT') {
        if (!nonnegative(e.qty)) throw Error('opening/count qty must be nonnegative');
      } else if (!positive(e.qty)) throw Error('event qty must be positive');
      if (own(e,'delta')) throw Error('only adjust uses delta');
    }
    if (['ORDER','FULFILL','CANCEL'].includes(e.kind)) {
      if (!label(e.orderId)) throw Error('orderId required');
    } else if (own(e,'orderId')) throw Error('orderId forbidden for physical operations');
    if (e.kind === 'COUNT') {
      if (!list(e.observes) || !list(e.supersedes)) throw Error('count needs causal frontiers');
      if (e.observes.includes(e.id) || e.supersedes.includes(e.id)) throw Error('self observation');
    } else if (own(e,'observes') || own(e,'supersedes')) throw Error('only count has frontiers');
    if (e.afterCountId != null && (!PHYSICAL.has(e.kind) || e.kind === 'OPEN' || !label(e.afterCountId)))
      throw Error('afterCountId only for physical movement');
    return clone(e);
  }
  function addSafe(a,b) {
    if (!Number.isSafeInteger(a+b)) throw Error('quantity overflow');
    return a+b;
  }
  class Journal {
    constructor(notebook) {
      if (!label(notebook)) throw Error('notebook identifier required');
      this.notebook = notebook;
      this._events = new Map();
      this._product = new Map();
      this._quarantine = new Map();
      this._rejectedBatches = new Map(); // local-only, never replayed as business facts
      this._sequences = new Map();
    }
    _check(e) {
      const v = validate(e,this.notebook);
      const old = this._events.get(v.id);
      if (old) return stable(old) === stable(v) ? 'duplicate' : 'id-collision';
      const seqKey = v.device + '\u0000' + v.seq;
      if (this._sequences.has(seqKey)) return 'sequence-collision';
      return 'added';
    }
    _recordConflict(e,reason) {
      // A second/third payload with the same ID is a separate piece of
      // immutable evidence, not an overwrite of the previous rejection.
      this._quarantine.set(e.id+'\u0000'+stable(e),{reason,attempted:clone(e)});
    }
    _rememberRejectedBatch(events,reason) {
      if (!['id-collision','sequence-collision'].includes(reason) ||
          !Array.isArray(events) || events.length===0) throw Error('invalid rejected batch');
      const envelope={reason,events:events.map(e=>validate(e,this.notebook))};
      this._rejectedBatches.set(stable(envelope),envelope);
      return envelope;
    }
    _remember(e) {
      const frozen = Object.freeze(e);
      this._events.set(e.id,frozen);
      this._sequences.set(e.device+'\u0000'+e.seq,e.id);
      if (!this._product.has(e.product)) this._product.set(e.product,new Set());
      this._product.get(e.product).add(e.id);
    }
    append(event) {
      const e=validate(event,this.notebook), result=this._check(e);
      if (result === 'added') { this._remember(e); return {ok:true,added:1,duplicate:0}; }
      if (result === 'duplicate') return {ok:true,added:0,duplicate:1};
      this._recordConflict(e,result);
      return {ok:false,reason:result,id:e.id};
    }
    merge(events) {
      // Validate the WHOLE batch before applying a single event. A collision is
      // not an invitation to overwrite or silently lose the rest of the batch.
      if (!Array.isArray(events)) throw Error('events array required');
      const incoming = new Map(), seenSeq = new Map();
      const additions=[];
      for (const raw of events) {
        const e=validate(raw,this.notebook), key=e.device+'\u0000'+e.seq;
        const prior=incoming.get(e.id);
        if (prior && stable(prior)!==stable(e)) {
          this._rememberRejectedBatch(events,'id-collision');
          return {ok:false,reason:'id-collision',id:e.id,added:0,rejectedBatchStored:true};
        }
        if (seenSeq.has(key) && seenSeq.get(key)!==e.id) {
          this._rememberRejectedBatch(events,'sequence-collision');
          return {ok:false,reason:'sequence-collision',id:e.id,added:0,rejectedBatchStored:true};
        }
        incoming.set(e.id,e);seenSeq.set(key,e.id);
        const check=this._check(e);
        if (check!=='added'&&check!=='duplicate') {
          this._recordConflict(e,check); // accepted anchor exists already
          this._rememberRejectedBatch(events,check); // all unapplied batch witnesses survive
          return {ok:false,reason:check,id:e.id,added:0,rejectedBatchStored:true};
        }
      }
      for (const e of incoming.values()) if (!this._events.has(e.id)) additions.push(e);
      for (const e of additions) this._remember(e);
      return {ok:true,added:additions.length,duplicate:events.length-additions.length};
    }
    export() {
      const events=[...this._events.values()].map(clone).sort((a,b)=>a.id.localeCompare(b.id));
      const quarantine=[...this._quarantine.values()].map(clone)
        .sort((a,b)=>(a.attempted.id+'|'+stable(a.attempted)).localeCompare(b.attempted.id+'|'+stable(b.attempted)));
      const rejectedBatches=[...this._rejectedBatches.values()].map(clone)
        .sort((a,b)=>stable(a).localeCompare(stable(b)));
      return {schema:1,notebook:this.notebook,events,quarantine,rejectedBatches};
    }
    import(snapshot) {
      if (!snapshot || snapshot.schema!==1 || snapshot.notebook!==this.notebook)
        throw Error('incompatible notebook or schema');
      const alternatives=snapshot.quarantine||[];
      if (!Array.isArray(alternatives)) throw Error('invalid conflicting evidence');
      // Conflicts may reuse a DEVICE SEQUENCE with a different event ID.
      // A valid backup can anchor its rejected witness by either identifier
      // or (device, sequence); refusing the latter would lose a real fact.
      if (!Array.isArray(snapshot.events)) throw Error('backup events array required');
      const ids=new Set(snapshot.events.map(e=>e.id));
      const sequences=new Set(snapshot.events.map(e=>e.device+'\u0000'+e.seq));
      for (const c of alternatives) {
        if (!c || !c.attempted) throw Error('invalid conflicting evidence');
        const attempted=validate(c.attempted,this.notebook);
        if (!ids.has(attempted.id) && !sequences.has(attempted.device+'\u0000'+attempted.seq))
          throw Error('orphan conflict evidence in backup');
      }
      // Batch rejection remains distinct from valid append-only business facts.
      // A rejection must be corroborated by two contradictory witnesses, one
      // of which belongs to that batch (the other may be an accepted event).
      const rejected=snapshot.rejectedBatches||[];
      if (!Array.isArray(rejected)) throw Error('invalid rejected-batch list');
      const verified=[];
      const accepted=snapshot.events.map(e=>validate(e,this.notebook));
      for (const batch of rejected) {
        if (!batch || !Array.isArray(batch.events) || !batch.events.length ||
            !['id-collision','sequence-collision'].includes(batch.reason))
          throw Error('invalid rejected-batch envelope');
        const items=batch.events.map(e=>validate(e,this.notebook));
        const witnesses=accepted.concat(items);
        const conflict=items.some(a=>witnesses.some(b=>
          batch.reason==='id-collision'
            ? (a.id===b.id && stable(a)!==stable(b))
            : (a.device===b.device && a.seq===b.seq && a.id!==b.id)));
        if (!conflict) throw Error('unsubstantiated rejected-batch envelope');
        verified.push({reason:batch.reason,events:items});
      }
      const merged=this.merge(snapshot.events);
      if (!merged.ok) return merged;
      for (const c of alternatives) this.append(c.attempted);
      for (const batch of verified) this._rememberRejectedBatch(batch.events,batch.reason);
      return {...merged,restoredConflicts:alternatives.length,restoredRejectedBatches:verified.length};
    }
    get size() { return this._events.size; }
    get quarantined() { return [...this._quarantine.values()].map(clone); }
    get rejectedBatches() { return [...this._rejectedBatches.values()].map(clone); }
    project(product) {
      if (!label(product)) throw Error('invalid product id');
      const ids=this._product.get(product)||new Set();
      const events=[...ids].map(id=>this._events.get(id));
      const issues=[], count=events.filter(e=>e.kind==='COUNT');
      const openings=events.filter(e=>e.kind==='OPEN');
      const physical=events.filter(e=>PHYSICAL.has(e.kind)&&e.kind!=='OPEN');
      let anchor=null,base=null, after=[];
      if (openings.length>1) issues.push('multiple-opening-epochs');
      if (count.length) {
        const byId=new Map(count.map(x=>[x.id,x]));
        function ancestor(current,target,visited=new Set()) {
          if (current===target) return true;
          if (visited.has(current)) return false;
          visited.add(current);
          const v=byId.get(current);
          if (!v) return false;
          return v.supersedes.some(id=>ancestor(id,target,visited));
        }
        const last=count.filter(c=>count.every(other=>other.id===c.id || ancestor(c.id,other.id)));
        if (last.length!==1) issues.push('concurrent-counts');
        else {
          anchor=last[0];base=anchor.qty;
          for (const parent of anchor.supersedes) if (!byId.has(parent)) issues.push('missing-count-ancestor');
          // A physical count cannot bless a prior opening it never saw.
          // Its frontier may contain only physical events of THIS product.
          for (const open of openings)
            if (!anchor.observes.includes(open.id)) issues.push('unobserved-opening:'+open.id);
          for (const seen of anchor.observes) {
            const fact=this._events.get(seen);
            if (!fact) issues.push('missing-observed-movement');
            else if (fact.product!==product) issues.push('observed-other-product:'+seen);
            else if (!PHYSICAL.has(fact.kind)) issues.push('observed-nonphysical:'+seen);
          }
          for (const e of physical) {
            if (anchor.observes.includes(e.id)) continue;
            if (e.afterCountId===anchor.id ||
                (e.afterCountId && ancestor(e.afterCountId,anchor.id))) after.push(e);
            else issues.push('unresolved-concurrent-physical:'+e.id);
          }
        }
      } else if (openings.length===1) { anchor=openings[0];base=anchor.qty;after=physical; }
      else issues.push('missing-unambiguous-physical-baseline');
      if (this._quarantine.size) for (const item of this._quarantine.values()) {
        const attempted=item.attempted;
        const accepted=this._events.get(attempted.id) ||
          this._events.get(this._sequences.get(attempted.device+'\u0000'+attempted.seq));
        // Cross-product ID/sequence collisions taint BOTH claimed products,
        // including the one belonging to the previously accepted witness.
        if (attempted.product===product || (accepted && accepted.product===product))
          issues.push('quarantined-'+item.reason);
      }
      for (const batch of this._rejectedBatches.values())
        if (batch.events.some(e=>e.product===product))
          issues.push('local-rejected-batch:'+batch.reason);
      let physicalClaim=null;
      if (base!==null && !issues.length) {
        physicalClaim=base;
        try { for (const e of after) {
          const d=e.kind==='ADJUST'?e.delta:(e.kind==='FULFILL'||e.kind==='LOSS'?-e.qty:e.qty);
          physicalClaim=addSafe(physicalClaim,d);
        }} catch(_) { issues.push('unsafe-quantity-overflow');physicalClaim=null; }
        if (physicalClaim!==null && physicalClaim<0) issues.push('physical-deficit');
      }
      const orders=new Map();
      for (const e of events.filter(e=>e.kind==='ORDER')) {
        if (orders.has(e.orderId)) issues.push('duplicate-business-order:'+e.orderId);
        else orders.set(e.orderId,{qty:e.qty,fulfilled:0,cancelled:0});
      }
      for (const e of events.filter(e=>e.kind==='FULFILL'||e.kind==='CANCEL')) {
        const o=orders.get(e.orderId);
        if (!o) {issues.push('orphan-'+e.kind.toLowerCase()+':'+e.id);continue;}
        if (e.kind==='FULFILL') o.fulfilled=addSafe(o.fulfilled,e.qty);
        else o.cancelled=addSafe(o.cancelled,e.qty);
      }
      let pending=0;
      for (const [orderId,o] of orders) {
        if (o.fulfilled+o.cancelled>o.qty) issues.push('overcommitted-order:'+orderId);
        else pending=addSafe(pending,o.qty-o.fulfilled-o.cancelled);
      }
      const trusted=issues.length===0;
      const onHand=trusted?physicalClaim:null;
      const reserved=trusted?Math.min(onHand,pending):null;
      return {
        product,trust:trusted?'verified':'needs-reconciliation',
        baseline:anchor?{id:anchor.id,kind:anchor.kind,qty:anchor.qty}:null,
        onHand,physicalClaim,orders:orders.size,unfulfilled:pending,
        reserved,available:trusted?onHand-reserved:null,
        preorder:trusted?pending-reserved:null,
        issues:[...new Set(issues)].sort(),
        facts:events.length
      };
    }
  }
  return Object.freeze({Journal,validate,stable});
});
