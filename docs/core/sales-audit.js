/* Read-only sales evidence, 2026-10-09. Sales and identified cash are different
   totals. Missing methods never become cash; this does not post ledger facts. */
(function(root){
  'use strict';
  function dayOf(v,zone,formatter){
    if (/^\d{4}-\d{2}-\d{2}$/.test(v.fechaLocal || '')) return v.fechaLocal;
    const ms=Date.parse(v.fecha)+ (Number(v.relojDesfaseMs)||0);
    if (!Number.isFinite(ms)) return '';
    const parts=(formatter || new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'})).formatToParts(new Date(ms));
    const get=k=>parts.find(p=>p.type===k).value;return `${get('year')}-${get('month')}-${get('day')}`;
  }
  function report(sales,filter={}){
    const r={rows:[],salesCents:0,returnedCents:0,netCents:0,cashCents:0,creditCents:0,nonCashCents:0,unspecifiedCents:0,invalid:0};
    const query=String(filter.query||'').trim().toLocaleLowerCase();
    let formatter;
    for(const v of Array.isArray(sales)?sales:[]){
      if(!v || v.anulada || v.borrado) continue;
      if(!v.fechaLocal && !formatter) formatter=new Intl.DateTimeFormat('en-CA',{timeZone:filter.timeZone || 'America/Guayaquil',year:'numeric',month:'2-digit',day:'2-digit'});
      const day=dayOf(v,filter.timeZone || 'America/Guayaquil',formatter);
      if(filter.from && day<filter.from || filter.to && day>filter.to || filter.rack && String(v.ubicacionId)!==filter.rack) continue;
      const product=v.productoNombre || v.nombre || v.productoId || '',rack=v.ubicacionNombre || v.ubicacionId || '';
      const event=v.eventoNombre || v.info && v.info.nombreEvento || '';
      if(query && ![product,rack,event,v.sku].join(' ').toLocaleLowerCase().includes(query)) continue;
      const units=Number(v.cantidad),price=Number(v.precioUnit),amount=Math.round(price*units*100);
      if(!day || !Number.isFinite(units) || units<=0 || !Number.isFinite(price) || price<0 || !Number.isSafeInteger(amount)){r.invalid++;continue;}
      const method=String(v.formaPago || v.info && v.info.formaPago || '').toLowerCase();
      const category=['cash','efectivo'].includes(method)?'cash':['fiado','credit','debt'].includes(method)?'credit':method?'nonCash':'unspecified';
      r.rows.push({id:v.id,day,at:Date.parse(v.fecha)+(Number(v.relojDesfaseMs)||0),product,rack,event,units,unitCents:Math.round(price*100),amountCents:amount,method,category,returned:!!v.devuelta});
      r.salesCents+=amount;
      if(v.devuelta) r.returnedCents+=amount;
      else {r.netCents+=amount;r[category+'Cents']+=amount;}
    }
    r.rows.sort((a,b)=>b.at-a.at || String(a.id).localeCompare(String(b.id)));return r;
  }
  root.OCSalesAudit={report,dayOf};
})(globalThis);
