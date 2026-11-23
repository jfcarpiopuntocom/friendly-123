/* Belén 2026-11-21: read-only, full-history Commissions projection used by
   BOTH the app and the Dashboard. Never write payments, stock or snapshots. */
(function(root,factory){
  var api=factory();
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  if(root)root.OCCommissionHistory=api;
})(typeof window!=="undefined"?window:null,function(){
  "use strict";
  var views=["total","producto","percha","cliente","comisionista","mes"];
  // C172 Safari: one immutable formatter per business timezone, not one
  // constructor per receipt per pass. Only zone names are cached, never sales.
  var dayFormatters=new Map();
  function dateFormatter(zone){
    var z=zone||"America/Guayaquil",fmt=dayFormatters.get(z);
    if(!fmt){
      fmt=new Intl.DateTimeFormat("en-US",{timeZone:z,year:"numeric",month:"2-digit",day:"2-digit"});
      if(dayFormatters.size>=4)dayFormatters.clear();
      dayFormatters.set(z,fmt);
    }
    return fmt;
  }
  // C174: the app and its CSV omit the zone argument while Dashboard passes
  // the authenticated business zone explicitly. Share the same browser default
  // without changing persisted timestamps, money or calendar-only dates.
  function businessZone(explicit){
    if(explicit)return explicit;
    if(typeof window!=="undefined"&&window){
      try {
        var stored=window.localStorage&&window.localStorage.getItem("f123_timezone");
        if(stored)return stored;
      }catch(_){}
      try {
        var current=window.Intl&&window.Intl.DateTimeFormat().resolvedOptions().timeZone;
        if(current)return current;
      }catch(_){}
    }
    return "America/Guayaquil";
  }
  function keyDay(value,zone){
    if(!value)return "";
    // A business calendar date has no UTC conversion: Ecuador local Nov 21 stays Nov 21.
    if(/^\d{4}-\d{2}-\d{2}$/.test(String(value)))return String(value);
    var t=Date.parse(value);
    if(!Number.isFinite(t))return /^\d{4}-\d{2}-\d{2}/.test(String(value))?String(value).slice(0,10):"";
    try{
      var parts=dateFormatter(zone).formatToParts(new Date(t));
      var take=function(type){return (parts.find(function(p){return p.type===type;})||{}).value||"";};
      return take("year")+"-"+take("month")+"-"+take("day");
    }catch(_){return new Date(t).toISOString().slice(0,10);}
  }
  function finite(value){if(value===null||value===undefined||value==="")return null;var n=Number(value);return Number.isFinite(n)?n:null;}
  // Use the same per-receipt cent rounding as payout-ledger.js and the
  // business read model. Unsafe amounts remain explicitly unverified.
  function cents(n){
    if(n===null||!Number.isFinite(n)||Math.abs(n)>=1e21)return null;
    var value=Math.round(Number(n.toFixed(10)+"e2"));
    return Number.isSafeInteger(value)?value:null;
  }
  function money(c){return c===null?null:c/100;}
  function accumulate(row,field,unknown,value){
    if(value===null||!Number.isSafeInteger(row[field]+value)){row[unknown]++;return;}
    row[field]+=value;
  }
  function economicSignature(v,zone){
    // Compare the economic identity, not volatile sync or display metadata.
    return JSON.stringify([
      keyDay(v.fechaLocal||v.fecha,zone),String(v.productoId||v.productoNombre||""),
      String(v.ubicacionId||v.ubicacionNombre||""),String(v.promotoraId||""),
      finite(v.cantidad),finite(v.precioUnit),finite(v.comisionAsociado),
      finite(v.split&&v.split.montoComisionSocio),finite(v.netoCasa),
      !!v.noCommission,!!v.anulada,!!v.cancelled,!!v.borrado,
      // Payment shares are an economic SET: remote replay may reorder rows.
      // Preserve payee, ROLE and amount, but never treat list position as money.
      Array.isArray(v.reparto)?v.reparto.map(function(r){
        return [String(r&&(r.promotoraId||r.payeeId)||""),String(r&&r.rol||""),finite(r&&r.monto)];
      }).sort(function(a,b){return JSON.stringify(a).localeCompare(JSON.stringify(b));}):null
    ]);
  }
  function associateAttribution(v){
    if(Array.isArray(v.reparto)&&v.reparto.length){
      // Payee order can change across peers. Prefer stable payee IDs, then
      // the same role-based display fallback used by the actual grouping.
      return JSON.stringify(v.reparto.map(function(r,i){
        var rol=String(r&&r.rol||"");
        var fallback=rol==="asistente"?v.asistenteNombre:
          rol==="vendedor"?v.asociadoNombre:
          (i===1?v.asistenteNombre:v.asociadoNombre);
        return String(r&&(r.promotoraId||r.payeeId||r.nombre)||fallback||"");
      }).sort());
    }
    return String(v.promotoraId||v.asociadoNombre||"");
  }
  function safeName(value,fallback){return String(value==null||String(value).trim()===""?fallback:value);}
  function escape(value){return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
  /* C247 (JFC 23 nov 2026, Belen: «los filtros deben poder sumarse»): cumulative filters. Every non-empty list narrows the SAME set of
     sales (AND between filters, OR inside one filter), together with the date range. Ids are the ones the groups already use. */
  function _saleAssociates(v,lang){
    if(Array.isArray(v.reparto)&&v.reparto.length>0){
      return v.reparto.map(function(r,i){
        var rol=String(r&&r.rol||"");
        var fallback=rol==="asistente"?v.asistenteNombre:
          rol==="vendedor"?v.asociadoNombre:
          (i===1?v.asistenteNombre:v.asociadoNombre);
        var name=safeName(r&&r.nombre,safeName(fallback,lang==="es"?"Comisionista sin nombre":"Unnamed associate"));
        var num=finite(r&&r.monto);
        return {id:String(r&&(r.promotoraId||r.payeeId)||name),name:name,commissionCents:num===null?null:cents(num)};
      });
    }
    var a=String(v.promotoraId||v.asociadoNombre||"");
    return a?[{id:a,name:safeName(v.asociadoNombre,a),commissionCents:null}]:[];
  }
  function _idsDe(v){
    var pers=_saleAssociates(v,"en").map(function(a){return a.id;});
    return {
      comisionista:pers.filter(Boolean),
      producto:[String(v.productoId||v.productoNombre||"")],
      percha:[String(v.ubicacionId||v.ubicacionNombre||"")],
      cliente:[String(v.clienteId||v.clienteNombre||"")]
    };
  }
  function _cumple(v,filtros){
    if(!filtros)return true;
    var ids=null;
    for(var k in filtros){
      var sel=filtros[k];
      if(!Array.isArray(sel)||!sel.length)continue;
      ids=ids||_idsDe(v);
      var mine=ids[k]||[];
      if(!sel.some(function(x){return mine.indexOf(String(x))>=0;}))return false;
    }
    return true;
  }
  // Options for the filter lists: from the valid sales inside the date range only (never narrowed by the other filters), so choices never vanish.
  function facets(input){
    input=input||{};
    var from=/^\d{4}-\d{2}-\d{2}$/.test(input.from||"")?input.from:"",to=/^\d{4}-\d{2}-\d{2}$/.test(input.to||"")?input.to:"";
    var lang=input.lang==="es"?"es":"en",zone=businessZone(input.zone);
    var out={comisionista:new Map(),producto:new Map(),percha:new Map(),cliente:new Map()},seen=new Set();
    (Array.isArray(input.sales)?input.sales:[]).forEach(function(v){
      if(!v||typeof v!=="object"||v.anulada||v.cancelled||v.borrado)return;
      var rid=v.id==null?"":String(v.id);
      if(rid){if(seen.has(rid))return;seen.add(rid);}
      var day=keyDay(v.fechaLocal||v.fecha,zone);
      if(from&&(!day||day<from))return;
      if(to&&(!day||day>to))return;
      _saleAssociates(v,lang).forEach(function(a){if(a.id&&!out.comisionista.has(a.id))out.comisionista.set(a.id,a.name);});
      var p=String(v.productoId||v.productoNombre||"");if(p&&!out.producto.has(p))out.producto.set(p,safeName(v.productoNombre,p));
      var u=String(v.ubicacionId||v.ubicacionNombre||"");if(u&&!out.percha.has(u))out.percha.set(u,safeName(v.ubicacionNombre,u));
      var c=String(v.clienteId||v.clienteNombre||"");if(c&&!out.cliente.has(c))out.cliente.set(c,safeName(v.clienteNombre,c));
    });
    var res={};
    Object.keys(out).forEach(function(k){
      res[k]=Array.from(out[k]).map(function(e){return {id:e[0],name:e[1]};}).sort(function(x,y){return String(x.name).localeCompare(String(y.name),lang);});
    });
    return res;
  }
  // Same date range + cumulative filters as project(), returned as a plain list (used by hosts that need one consistent source).
  function filterSales(input){
    input=input||{};
    var from=/^\d{4}-\d{2}-\d{2}$/.test(input.from||"")?input.from:"",to=/^\d{4}-\d{2}-\d{2}$/.test(input.to||"")?input.to:"",zone=businessZone(input.zone);
    return (Array.isArray(input.sales)?input.sales:[]).filter(function(v){
      if(!v||typeof v!=="object")return false;
      if(from||to){var day=keyDay(v.fechaLocal||v.fecha,zone);if(from&&(!day||day<from))return false;if(to&&(!day||day>to))return false;}
      return _cumple(v,input.filtros);
    });
  }
  function project(input){
    input=input||{};
    var group=views.indexOf(input.group)>=0?input.group:"total";
    var from=/^\d{4}-\d{2}-\d{2}$/.test(input.from||"")?input.from:"";
    var to=/^\d{4}-\d{2}-\d{2}$/.test(input.to||"")?input.to:"";
    var lang=input.lang==="es"?"es":"en",zone=businessZone(input.zone);
    // Invalid calendar range is not a real zero commission.
    if(from&&to&&from>to)return {group:group,from:from,to:to,lang:lang,zone:zone,
      invalidRange:true,rows:[],totals:null,groups:[]};
    var all=Array.isArray(input.sales)?input.sales:[];
    var assocSel=(input.filtros&&Array.isArray(input.filtros.comisionista)&&input.filtros.comisionista.length)
      ?input.filtros.comisionista.map(String):null;
    var rows=[],tot={count:0,cancelled:0,conflicts:0,splitConflicts:0,customerConflicts:0,associateConflicts:0,gross:0,commission:0,unknownGross:0,unknownCommission:0};
    var groups=new Map(),seen=new Set(),firstById=new Map(),conflictingIds=new Set();
    var firstCustomerById=new Map(),conflictingCustomerIds=new Set();
    var firstAssociateById=new Map(),conflictingAssociateIds=new Set();
    all.forEach(function(v){
      if(!v||typeof v!=="object"||v.id==null||String(v.id)==="")return;
      var receiptId=String(v.id),signature=economicSignature(v,zone);
      if(firstById.has(receiptId)&&firstById.get(receiptId)!==signature)conflictingIds.add(receiptId);
      else if(!firstById.has(receiptId))firstById.set(receiptId,signature);
      // Client identity controls BY-CLIENT allocation, not the monetary
      // validity of an otherwise matching receipt.
      var customerKey=String(v.clienteId||v.clienteNombre||"");
      if(firstCustomerById.has(receiptId)&&firstCustomerById.get(receiptId)!==customerKey)conflictingCustomerIds.add(receiptId);
      else if(!firstCustomerById.has(receiptId))firstCustomerById.set(receiptId,customerKey);
      var associateKey=associateAttribution(v);
      if(firstAssociateById.has(receiptId)&&firstAssociateById.get(receiptId)!==associateKey)conflictingAssociateIds.add(receiptId);
      else if(!firstAssociateById.has(receiptId))firstAssociateById.set(receiptId,associateKey);
    });
    all.forEach(function(v){
      if(!v||typeof v!=="object")return;
      var day=keyDay(v.fechaLocal||v.fecha,zone);
      if(from&&(!day||day<from))return;
      if(to&&(!day||day>to))return;
      if(!_cumple(v,input.filtros))return; // C247: cumulative filters
      // Deduplicate before cancellation or conflict accounting too.
      var receiptId=v.id==null?"":String(v.id);
      if(receiptId&&seen.has(receiptId))return;
      if(receiptId)seen.add(receiptId);
      if(receiptId&&conflictingIds.has(receiptId)){
        // Never let whichever conflicting copy arrived first decide the money.
        tot.conflicts++;tot.unknownGross++;tot.unknownCommission++;return;
      }
      if(v.anulada||v.cancelled){tot.cancelled++;return;}
      if(v.borrado)return;
      var qty=finite(v.cantidad),price=finite(v.precioUnit);
      var gross=qty!==null&&qty>0&&price!==null?cents(qty*price):null;
      var commissionRaw=finite(v.comisionAsociado);
      if(commissionRaw===null&&v.split)commissionRaw=finite(v.split.montoComisionSocio);
      if(commissionRaw===null&&v.noCommission===true)commissionRaw=0;
      var commission=cents(commissionRaw);
      // Match the sale's recorded commission to its explicit payout shares.
      // A mismatched/missing amount must NOT display exact money in either UI.
      var splitMismatch=false;
      if(commission!==null&&Array.isArray(v.reparto)&&v.reparto.length){
        var shares=0;
        for(var si=0;si<v.reparto.length;si++){
          var part=cents(finite(v.reparto[si]&&v.reparto[si].monto));
          if(part===null||!Number.isSafeInteger(shares+part)){splitMismatch=true;break;}
          shares+=part;
        }
        if(shares!==commission)splitMismatch=true;
      }
      if(splitMismatch){tot.splitConflicts++;commission=null;}
      if(assocSel&&!splitMismatch&&Array.isArray(v.reparto)&&v.reparto.length&&!(receiptId&&conflictingAssociateIds.has(receiptId))){
        var matchedShare=0,shareBad=false;
        _saleAssociates(v,lang).forEach(function(a){
          if(assocSel.indexOf(a.id)<0)return;
          if(a.commissionCents===null||!Number.isSafeInteger(matchedShare+a.commissionCents)){shareBad=true;return;}
          matchedShare+=a.commissionCents;
        });
        commission=shareBad?null:matchedShare;
      }
      tot.count++;
      accumulate(tot,"gross","unknownGross",gross);
      accumulate(tot,"commission","unknownCommission",commission);
      var label="",id="";
      if(group==="total"){id="total";label=lang==="es"?"Total general":"Overall total";}
      else if(group==="producto"){id=String(v.productoId||v.productoNombre||"");label=safeName(v.productoNombre,lang==="es"?"Sin producto":"Unnamed product");}
      else if(group==="percha"){id=String(v.ubicacionId||v.ubicacionNombre||"");label=safeName(v.ubicacionNombre,lang==="es"?"Sin percha":"Unnamed rack");}
      else if(group==="cliente"){
        if(receiptId&&conflictingCustomerIds.has(receiptId)){
          id="__f123_cliente_por_verificar__";
          label=lang==="es"?"Cliente por verificar":"Customer needs review";
          tot.customerConflicts++;
        }else{
          id=String(v.clienteId||v.clienteNombre||"");
          label=safeName(v.clienteNombre,lang==="es"?"Sin cliente":"No customer");
        }
      }
      else if(group==="comisionista"){
        id=String(v.promotoraId||v.asociadoNombre||"");
        label=safeName(v.asociadoNombre,lang==="es"?"Sin comisionista asignado":"Unassigned associate");
      } else {id=day.slice(0,7);label=day.slice(0,7)|| (lang==="es"?"Sin fecha":"Undated");}
      // One receipt may allocate to a single payee or split between people.
      // Attribute only the money explicitly assigned to each, never give both
      // associates the entire sale or invent a beneficiary for an unknown split.
      var targets=[{id:id||label,label:label,commission:commission,gross:gross}];
      if(group==="comisionista"&&receiptId&&conflictingAssociateIds.has(receiptId)){
        tot.associateConflicts++;
        targets=[{id:"__f123_comisionista_por_verificar__",
          label:lang==="es"?"Comisionista por verificar":"Associate needs review",
          commission:commission,
          gross:Array.isArray(v.reparto)&&v.reparto.length?null:gross}];
      }else if(group==="comisionista"&&Array.isArray(v.reparto)&&v.reparto.length>0){
        targets=_saleAssociates(v,lang).filter(function(a){
          return !assocSel||assocSel.indexOf(a.id)>=0;
        }).map(function(a){
          return {id:a.id,label:a.name,
            commission:splitMismatch?null:a.commissionCents,gross:null};
        });
      }
      targets.forEach(function(target){
        var k=target.id,g=groups.get(k);
        if(!g){g={id:k,label:target.label,count:0,gross:0,commission:0,unknownGross:0,unknownCommission:0};groups.set(k,g);}
        // C227 (JFC 23 nov 2026: "devuelveme ... flechas causales de comisiones"): keep the product's commission arrow.
        if(group==="producto"){if(v.productoId)g.productoId=String(v.productoId);if(v.direccionProducto==="asociadoPaga")g.direccion="asociadoPaga";}
        g.count++;
        accumulate(g,"gross","unknownGross",target.gross);
        accumulate(g,"commission","unknownCommission",target.commission);
        rows.push({id:String(v.id||""),day:day,group:k,gross:money(target.gross),commission:money(target.commission)});
      });
    });
    tot.gross=money(tot.gross);tot.commission=money(tot.commission);
    return {group:group,from:from,to:to,lang:lang,zone:zone,rows:rows,totals:tot,
      groups:Array.from(groups.values()).map(function(g){
        g.gross=money(g.gross);g.commission=money(g.commission);return g;
      }).sort(function(a,b){return (group==="comisionista"?b.commission-a.commission:b.gross-a.gross)||a.label.localeCompare(b.label);})};
  }
  function render(input){
    var view=project(input),es=view.lang==="es",t=view.totals;
    if(view.invalidRange)return '<section data-comm-history-report data-comm-history-invalid-range="1" role="alert"'
      +' style="margin-top:12px;padding:12px;border:2px solid var(--rojo-ink,#a3392a);">'
      +(es?"Rango de fechas inválido: «Desde» debe ser anterior o igual a «Hasta». Corrige las fechas para consultar las comisiones.":"Invalid date range: From must be on or before To. Correct the dates to view commissions.")
      +'</section>';
    var fmt=function(n){return "$"+Number(n).toLocaleString(es?"es-EC":"en-US",{minimumFractionDigits:2,maximumFractionDigits:2});};
    var money=function(n,unknown){return unknown?es?"Por verificar":"Needs review":fmt(n);};
    var title=es?"Historial completo de ventas y comisiones":"Full sales and commissions history";
    var label=es?"Ventas brutas":"Gross sales",com=view.group==="total"?(es?"Total de comisiones":"Total commissions"):(es?"Comisiones registradas":"Recorded commissions");
    var info=es?"Vista de consulta de todas las fechas. Los pagos, devoluciones y saldos se concilian en el mes correspondiente; selecciona un mes para registrarlos.":"Read-only view across dates. Payments, returns and balances remain reconciled in their own month; select a month to record them.";
    var groupName={total:es?"Total general":"Overall total",producto:es?"Producto":"Product",percha:es?"Percha / evento":"Rack / event",cliente:es?"Cliente":"Customer",comisionista:es?"Comisionista":"Associate",mes:es?"Mes":"Month"}[view.group];
    var body=view.groups.map(function(g){
      return '<div data-comm-history-group class="tag-card" style="margin:0 0 8px;padding:10px 14px;text-align:left;">'
        +'<strong style="display:block;font-size:16px;color:var(--ink,#0F1923);">'+escape(g.label)+'</strong>'
        +'<span style="display:block;font-size:14px;color:var(--ink,#0F1923);">'+g.count+' '+(es?"ventas relacionadas":"related sales")+
        (view.group==="comisionista"?"":' · '+label+': '+money(g.gross,g.unknownGross))
        +' · '+com+': '+money(g.commission,g.unknownCommission)+'</span>'
        // C227: same causal arrow as the month Summary by Product (UI 1.0): who pays whom; tapping it uses girarFlechaComision.
        +(view.group==="producto"&&g.productoId&&typeof window!=="undefined"&&typeof window.flechaComisionHtml==="function"
          ?'<div data-comm-flecha style="margin-top:6px;">'+window.flechaComisionHtml("",g.direccion||"casaPaga",g.productoId,g.label)+'</div>':"")
        +'</div>';
    }).join("");
    return '<section data-comm-history-report style="margin-top:12px;">'
      +(t.conflicts?'<p role="alert">'+(es?"Recibos con el mismo ID y valores distintos: importes por verificar.":"Receipt IDs with conflicting economic values: totals need review.")+'</p>':"")
      +(t.splitConflicts?'<p role="alert">'+(es?"El reparto de comisiones no coincide con el total registrado: importes por verificar.":"Commission shares do not match the recorded total: amounts need review.")+'</p>':"")
      +(t.customerConflicts?'<p role="alert">'+(es?"Una venta aparece con clientes distintos: importe conservado, cliente por verificar.":"A receipt has conflicting customer IDs: amount preserved, customer needs review.")+'</p>':"")
      +(t.associateConflicts?'<p role="alert">'+(es?"Una venta aparece con comisionistas distintos: importe conservado, comisionista por verificar.":"A receipt has conflicting associates: amount preserved, associate needs review.")+'</p>':"")
      +'<h3 style="font-size:18px;font-weight:800;color:var(--ink,#0F1923);">'+title+'</h3>'
      +'<p style="font-size:14px;color:var(--ink,#0F1923);">'+info+'</p>'
      +'<div class="cm-grid" style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;">'
      +'<div class="tag-card" style="flex:1 1 145px;padding:12px;text-align:left;"><b>'+com+'</b><div style="font-size:26px;font-weight:800;">'+money(t.commission,t.unknownCommission)+'</div></div>'
      +'<div class="tag-card" style="flex:1 1 145px;padding:12px;text-align:left;"><b>'+label+'</b><div style="font-size:20px;">'+money(t.gross,t.unknownGross)+'</div></div>'
      +'<div class="tag-card" style="flex:1 1 110px;padding:12px;text-align:left;"><b>'+(es?"Ventas":"Sales")+'</b><div style="font-size:20px;">'+t.count+'</div></div></div>'
      +(view.group==="total"?'':('<h4 style="font-size:16px;margin:10px 0;">'+groupName+'</h4>'
      +(body||'<p style="font-size:15px;">'+(es?"No hay ventas en las fechas elegidas.":"No sales in the selected dates.")+'</p>')))
      +'</section>';
  }
  return {views:views,day:keyDay,saleAssociates:_saleAssociates,project:project,render:render,facets:facets,filterSales:filterSales};
});
