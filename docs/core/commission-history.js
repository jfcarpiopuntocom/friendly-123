/* Belén 2026-11-21: read-only, full-history Commissions projection used by
   BOTH the app and the Dashboard. Never write payments, stock or snapshots. */
(function(root,factory){
  var api=factory();
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  if(root)root.OCCommissionHistory=api;
})(typeof window!=="undefined"?window:null,function(){
  "use strict";
  var views=["producto","percha","cliente","comisionista","mes"];
  function keyDay(value,zone){
    if(!value)return "";
    var t=Date.parse(value);
    if(!Number.isFinite(t))return /^\d{4}-\d{2}-\d{2}/.test(String(value))?String(value).slice(0,10):"";
    try{
      var parts=new Intl.DateTimeFormat("en-US",{timeZone:zone||"America/Guayaquil",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(t));
      var take=function(type){return (parts.find(function(p){return p.type===type;})||{}).value||"";};
      return take("year")+"-"+take("month")+"-"+take("day");
    }catch(_){return new Date(t).toISOString().slice(0,10);}
  }
  function finite(value){if(value===null||value===undefined||value==="")return null;var n=Number(value);return Number.isFinite(n)?n:null;}
  function safeName(value,fallback){return String(value==null||String(value).trim()===""?fallback:value);}
  function escape(value){return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
  function project(input){
    input=input||{};
    var group=views.indexOf(input.group)>=0?input.group:"producto";
    var from=/^\d{4}-\d{2}-\d{2}$/.test(input.from||"")?input.from:"";
    var to=/^\d{4}-\d{2}-\d{2}$/.test(input.to||"")?input.to:"";
    var lang=input.lang==="es"?"es":"en",zone=input.zone||"America/Guayaquil";
    var all=Array.isArray(input.sales)?input.sales:[];
    var rows=[],tot={count:0,cancelled:0,gross:0,commission:0,unknownGross:0,unknownCommission:0};
    var groups=new Map();
    all.forEach(function(v){
      if(!v||typeof v!=="object")return;
      var day=keyDay(v.fecha,zone);
      if(from&&(!day||day<from))return;
      if(to&&(!day||day>to))return;
      if(v.anulada||v.cancelled){tot.cancelled++;return;}
      var qty=finite(v.cantidad),price=finite(v.precioUnit);
      var gross=qty!==null&&qty>0&&price!==null?qty*price:null;
      var commission=finite(v.comisionAsociado);
      if(commission===null&&v.split)commission=finite(v.split.montoComisionSocio);
      if(commission===null&&v.noCommission===true)commission=0;
      tot.count++;
      if(gross===null)tot.unknownGross++;else tot.gross+=gross;
      if(commission===null)tot.unknownCommission++;else tot.commission+=commission;
      var label="",id="";
      if(group==="producto"){id=String(v.productoId||v.productoNombre||"");label=safeName(v.productoNombre,lang==="es"?"Sin producto":"Unnamed product");}
      else if(group==="percha"){id=String(v.ubicacionId||v.ubicacionNombre||"");label=safeName(v.ubicacionNombre,lang==="es"?"Sin percha":"Unnamed rack");}
      else if(group==="cliente"){id=String(v.clienteId||v.clienteNombre||"");label=safeName(v.clienteNombre,lang==="es"?"Sin cliente":"No customer");}
      else if(group==="comisionista"){
        id=String(v.promotoraId||v.asociadoNombre||"");
        label=safeName(v.asociadoNombre,lang==="es"?"Sin comisionista asignado":"Unassigned associate");
      } else {id=day.slice(0,7);label=day.slice(0,7)|| (lang==="es"?"Sin fecha":"Undated");}
      // One receipt may split an exact commission between two people.
      // Attribute only the money explicitly assigned to each, never give both
      // associates the entire sale or invent a beneficiary for an unknown split.
      var targets=[{id:id||label,label:label,commission:commission,gross:gross}];
      if(group==="comisionista"&&Array.isArray(v.reparto)&&v.reparto.length>1){
        targets=v.reparto.map(function(r,i){
          var name=safeName(i===1?v.asistenteNombre:v.asociadoNombre,
            safeName(r&&r.nombre,lang==="es"?"Comisionista sin nombre":"Unnamed associate"));
          return {id:String(r&&(r.promotoraId||r.payeeId)||name),label:name,
            commission:finite(r&&r.monto),gross:null};
        });
      }
      targets.forEach(function(target){
        var k=target.id,g=groups.get(k);
        if(!g){g={id:k,label:target.label,count:0,gross:0,commission:0,unknownGross:0,unknownCommission:0};groups.set(k,g);}
        g.count++;if(target.gross===null)g.unknownGross++;else g.gross+=target.gross;
        if(target.commission===null)g.unknownCommission++;else g.commission+=target.commission;
        rows.push({id:String(v.id||""),day:day,group:k,gross:target.gross,commission:target.commission});
      });
    });
    return {group:group,from:from,to:to,lang:lang,zone:zone,rows:rows,totals:tot,
      groups:Array.from(groups.values()).sort(function(a,b){return (group==="comisionista"?b.commission-a.commission:b.gross-a.gross)||a.label.localeCompare(b.label);})};
  }
  function render(input){
    var view=project(input),es=view.lang==="es",t=view.totals;
    var fmt=function(n){return "$"+Number(n).toLocaleString(es?"es-EC":"en-US",{minimumFractionDigits:2,maximumFractionDigits:2});};
    var money=function(n,unknown){return unknown?es?"Por verificar":"Needs review":fmt(n);};
    var title=es?"Historial completo de ventas y comisiones":"Full sales and commissions history";
    var label=es?"Ventas brutas":"Gross sales",com=es?"Comisiones registradas":"Recorded commissions";
    var info=es?"Vista de consulta de todas las fechas. Los pagos, devoluciones y saldos se concilian en el mes correspondiente; selecciona un mes para registrarlos.":"Read-only view across dates. Payments, returns and balances remain reconciled in their own month; select a month to record them.";
    var groupName={producto:es?"Producto":"Product",percha:es?"Percha / evento":"Rack / event",cliente:es?"Cliente":"Customer",comisionista:es?"Comisionista":"Associate",mes:es?"Mes":"Month"}[view.group];
    var body=view.groups.map(function(g){
      return '<div data-comm-history-group class="tag-card" style="margin:0 0 8px;padding:10px 14px;text-align:left;">'
        +'<strong style="display:block;font-size:16px;color:var(--ink,#0F1923);">'+escape(g.label)+'</strong>'
        +'<span style="display:block;font-size:14px;color:var(--ink,#0F1923);">'+g.count+' '+(es?"ventas relacionadas":"related sales")+
        (view.group==="comisionista"?"":' · '+label+': '+money(g.gross,g.unknownGross))
        +' · '+com+': '+money(g.commission,g.unknownCommission)+'</span></div>';
    }).join("");
    return '<section data-comm-history-report style="margin-top:12px;">'
      +'<h3 style="font-size:18px;font-weight:800;color:var(--ink,#0F1923);">'+title+'</h3>'
      +'<p style="font-size:14px;color:var(--ink,#0F1923);">'+info+'</p>'
      +'<div class="cm-grid" style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;">'
      +'<div class="tag-card" style="flex:1 1 145px;padding:12px;text-align:left;"><b>'+label+'</b><div style="font-size:20px;">'+money(t.gross,t.unknownGross)+'</div></div>'
      +'<div class="tag-card" style="flex:1 1 145px;padding:12px;text-align:left;"><b>'+com+'</b><div style="font-size:20px;">'+money(t.commission,t.unknownCommission)+'</div></div>'
      +'<div class="tag-card" style="flex:1 1 110px;padding:12px;text-align:left;"><b>'+(es?"Ventas":"Sales")+'</b><div style="font-size:20px;">'+t.count+'</div></div></div>'
      +'<h4 style="font-size:16px;margin:10px 0;">'+groupName+'</h4>'
      +(body||'<p style="font-size:15px;">'+(es?"No hay ventas en las fechas elegidas.":"No sales in the selected dates.")+'</p>')
      +'</section>';
  }
  return {views:views,day:keyDay,project:project,render:render};
});
