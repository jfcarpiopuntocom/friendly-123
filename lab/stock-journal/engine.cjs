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
      this._quarantine.set(e.id,{reason:result,attempted:clone(e)});
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
        if (prior && stable(prior)!==stable(e)) { this._quarantine.set(e.id,{reason:'id-collision',attempted:e}); return {ok:false,reason:'id-collision',id:e.id,added:0}; }
        if (seenSeq.has(key) && seenSeq.get(key)!==e.id) { this._quarantine.set(e.id,{reason:'sequence-collision',attempted:e}); return {ok:false,reason:'sequence-collision',id:e.id,added:0}; }
        incoming.set(e.id,e);seenSeq.set(key,e.id);
        const check=this._check(e);
        if (check!=='added'&&check!=='duplicate') { this._quarantine.set(e.id,{reason:check,attempted:e}); return {ok:false,reason:check,id:e.id,added:0}; }
      }
      for (const e of incoming.values()) if (!this._events.has(e.id)) additions.push(e);
      for (const e of additions) this._remember(e);
      return {ok:true,added:additions.length,duplicate:events.length-additions.length};
    }
    export() {
      const events=[...this._events.values()].map(clone).sort((a,b)=>a.id.localeCompare(b.id));
      return {schema:1,notebook:this.notebook,events};
    }
    import(snapshot) {
      if (!snapshot || snapshot.schema!==1 || snapshot.notebook!==this.notebook)
        throw Error('incompatible notebook or schema');
      return this.merge(snapshot.events);
    }
    get size() { return this._events.size; }
    get quarantined() { return [...this._quarantine.values()].map(clone); }
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
          for (const seen of anchor.observes) if (!this._events.has(seen)) issues.push('missing-observed-movement');
          for (const e of physical) {
            if (anchor.observes.includes(e.id)) continue;
            if (e.afterCountId===anchor.id ||
                (e.afterCountId && ancestor(e.afterCountId,anchor.id))) after.push(e);
            else issues.push('unresolved-concurrent-physical:'+e.id);
          }
        }
      } else if (openings.length===1) { anchor=openings[0];base=anchor.qty;after=physical; }
      else issues.push('missing-unambiguous-physical-baseline');
      if (this._quarantine.size) for (const item of this._quarantine.values())
        if (item.attempted.product===product) issues.push('quarantined-'+item.reason);
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
