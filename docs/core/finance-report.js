/* Pure grouping over an immutable reporting cut; adapters supply periods and labels. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./business-read-model.js') : root.OCBusinessReadModel);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OCFinanceProjection = api;
})(globalThis, function (RM) {
  'use strict';
  function build(input, events) {
    const groups = new Map();
    for (const sale of input.sales || []) {
      if (!sale || sale.borrado) continue;
      const key = events ? RM.eventKey(sale, input.zone) : sale.ubicacionId;
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, {
        scope: events ? { eventKey: key } : { locationId: key },
        name: events ? (sale.eventoNombre || sale.productoNombre || '') + ' · ' + (sale.eventoFecha || '') : sale.ubicacionNombre || key
      });
    }
    for (const expense of input.expenses || []) {
      if (!expense || expense.borrado) continue;
      const eventId = expense.eventoId || expense.eventOccurrenceId || expense.ocurrenciaId;
      const key = events ? (expense.eventKey || (eventId ? 'id:' + eventId : null)) : expense.ubicacionId;
      if (!key || key === 'todas' || groups.has(key)) continue;
      groups.set(key, { scope: events ? { eventKey: key } : { locationId: key }, name: expense.eventoNombre || expense.ubicacionNombre || key });
    }
    const rows = [{ name: null, result: RM.businessResult(input) }];
    for (const group of groups.values()) {
      const result = RM.businessResult({ ...input, scope: group.scope });
      // Corrections can belong to a later period than the original sale. Conflicts
      // must remain visible as pending rows even when their IDs are quarantined.
      const pending = result.warnings.some(warning => ['conflicting-sale', 'conflicting-expense', 'conflicting-adjustment', 'unreconciled-commission-adjustment'].includes(warning));
      if (result.sourceIds.sales.length || result.sourceIds.adjustments.length || result.sourceIds.expenses.length && result.directExpensesCents !== 0 || pending) rows.push({ name: group.name, result });
    }
    return rows;
  }
  // D3 business-local realized earnings, O(sales) in the existing Worker.
  // An unknown cost or commission is NEVER interpreted as zero.
  const GROUPS={
    product:v=>[v.productoId,v.productoNombre],
    shelf:v=>[v.ubicacionId,v.ubicacionNombre],
    associate:v=>[v.asistenteId||v.promotoraId,v.asistenteNombre||v.promotoraNombre],
    customer:v=>[v.clienteId,v.clienteNombre],
    payment:v=>[v.formaPago,v.formaPago],
    channel:v=>[v.canalVenta,v.canalVenta],
    event:(v,z)=>[RM.eventKey(v,z),v.eventoNombre||v.nombreEvento]
  };
  function hour(iso,zone){
    const date=new Date(iso);
    if(!Number.isFinite(date.valueOf()))return null;
    return new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'2-digit',hourCycle:'h23'}).format(date);
  }
  function earnings(input={},by='product'){
    const zone=input.zone||'America/Guayaquil',period=input.period||{},groups=new Map();
    const within=date=>!!date&&(!period.from||date>=period.from)&&(!period.to||date<=period.to);
    const blank=(key,name)=>({key,name,units:0,netCents:0,costCents:0,commissionCents:0,
      profitCents:0,marginPct:null,salesWithoutCost:0});
    const total=blank(null,null);
    const add=(row,amounts,sign)=>{
      row.units=RM.sum([row.units,amounts.units===null?null:sign*amounts.units]);
      row.netCents=RM.sum([row.netCents,amounts.revenueCents===null?null:sign*amounts.revenueCents]);
      row.costCents=RM.sum([row.costCents,amounts.costCents===null?null:sign*amounts.costCents]);
      row.commissionCents=RM.sum([row.commissionCents,amounts.artistCents===null?null:sign*amounts.artistCents]);
      const profit=amounts.houseCents===null||amounts.costCents===null
        ? null:RM.sum([amounts.houseCents,-amounts.costCents]);
      row.profitCents=RM.sum([row.profitCents,profit===null?null:sign*profit]);
      if(amounts.costCents===null)row.salesWithoutCost++;
    };
    // Keep first occurrence of same immutable opId; conflicting duplicate IDs
    // mark the aggregate unknown rather than silently adding incompatible money.
    const seen=new Map();
    for(const v of input.sales||[]){
      if(!v||v.borrado||v.anulada)continue;
      const d=RM.day(v.fechaLocal||v.fecha,zone);
      const returnDay=v.devuelta?RM.day(v.fechaDevolucion,zone):'';
      const signs=[within(d)?1:0,v.devuelta&&within(returnDay)?-1:0].filter(Boolean);
      if(!signs.length)continue;
      const id=v.id==null?'':String(v.id);
      if(id){
        const canonical=JSON.stringify(v),prior=seen.get(id);
        if(prior!==undefined){
          if(prior!==canonical){total.costCents=null;total.profitCents=null;total.marginPct=null;}
          continue;
        }
        seen.set(id,canonical);
      }
      let key,name;
      if(by==='weekday')key=name=d?new Date(d+'T12:00:00Z').getUTCDay():null;
      else if(by==='hour')key=name=hour(v.fecha,zone);
      else [key,name]=(GROUPS[by]||GROUPS.product)(v,zone);
      key=key===null||key===undefined||key===''?'—':String(key);
      if(!groups.has(key))groups.set(key,blank(key,name==null||name===''?key:name));
      const amounts=RM.saleAmounts(v);
      for(const sign of signs){add(groups.get(key),amounts,sign);add(total,amounts,sign);}
    }
    const rows=[total,...groups.values()];
    for(const row of rows)row.marginPct=row.profitCents===null||row.netCents===null||
      row.netCents===0?null:Math.round(row.profitCents*1000/row.netCents)/10;
    return rows;
  }
  return { build, earnings };
});
