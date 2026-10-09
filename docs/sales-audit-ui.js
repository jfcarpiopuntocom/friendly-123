/* Browser adapter for the same read-only report in Sold and Dashboard.
   Controls survive live refreshes. It never changes sales, payments or stock. */
(function(root){
  'use strict';
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function mount(host,sales,options={}){
    if(!host || !root.OCSalesAudit) return;
    const es=options.lang==='es',text=es?{
      title:'Historial de ventas y comprobación',from:'Desde',to:'Hasta',rack:'Percha / evento',all:'Todas',search:'Producto, SKU o evento',reset:'Todo el historial',net:'Ventas netas',cash:'Ventas en efectivo',credit:'Fiado',nonCash:'Otros medios',unspecified:'Sin medio registrado',returns:'Devoluciones',price:'Precio unitario',total:'Importe',empty:'No hay ventas para estos filtros.',note:'Ventas del periodo; no es el saldo de caja. Fiado y ventas sin medio registrado no se cuentan como efectivo.',invalid:'Registros con fecha o importe inválido: ',returned:'Devuelta',count:'ventas'
    }:{title:'Sales history and checking',from:'From',to:'To',rack:'Rack / event',all:'All',search:'Product, SKU or event',reset:'All history',net:'Net sales',cash:'Cash sales',credit:'On account',nonCash:'Other methods',unspecified:'No recorded method',returns:'Returns',price:'Unit price',total:'Amount',empty:'No sales match these filters.',note:'Sales for the period; this is not the cash drawer balance. Credit and sales without a recorded method are not counted as cash.',invalid:'Records with invalid date or amount: ',returned:'Returned',count:'sales'};
    const prior=host._salesAuditState || {from:'',to:'',rack:'',query:''};host._salesAuditState=prior;host._salesAuditRows=sales;
    const style='min-height:44px;max-width:100%;box-sizing:border-box;font:inherit;font-size:15px;padding:6px;border:2px solid #2E6278;border-radius:6px;background:#FFFFFF;color:#19354B;';
    const racks=[...new Map((sales||[]).filter(v=>v&&v.ubicacionId).map(v=>[String(v.ubicacionId),v.ubicacionNombre||v.ubicacionId])).entries()];
    host.innerHTML=`<div data-sales-audit style="font-size:15px;line-height:1.5;text-align:left;color:inherit;">
      <h3 style="font-size:18px;margin:0 0 10px;">${text.title}</h3>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;">
        <label>${text.from}<br><input data-audit-from type="date" value="${esc(prior.from)}" style="${style}"></label>
        <label>${text.to}<br><input data-audit-to type="date" value="${esc(prior.to)}" style="${style}"></label>
        <label>${text.rack}<br><select data-audit-rack style="${style}"><option value="">${text.all}</option>${racks.map(([id,name])=>`<option value="${esc(id)}"${id===prior.rack?' selected':''}>${esc(name)}</option>`).join('')}</select></label>
        <label style="flex:1 1 180px;min-width:0;">${text.search}<br><input data-audit-query type="search" value="${esc(prior.query)}" style="${style}width:100%;"></label>
        <button data-audit-reset type="button" style="${style}font-weight:700;">${text.reset}</button>
      </div><p style="font-size:14px;margin:10px 0;">${text.note}</p>
      <div data-audit-results aria-live="polite"></div></div>`;
    const money=n=>new Intl.NumberFormat(es?'es-EC':'en-US',{style:'currency',currency:'USD'}).format(n/100);
    function paint(){
      const r=root.OCSalesAudit.report(host._salesAuditRows,{...prior,timeZone:options.timeZone});host._salesAuditReport=r;
      const pairs=[[text.net,r.netCents],[text.cash,r.cashCents],[text.credit,r.creditCents],[text.nonCash,r.nonCashCents],[text.unspecified,r.unspecifiedCents],[text.returns,r.returnedCents]];
      host.querySelector('[data-audit-results]').innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;margin:12px 0;">${pairs.map(([label,n])=>`<div style="border:2px solid currentColor;border-radius:8px;padding:8px;"><div>${label}</div><strong style="font-size:20px;">${money(n)}</strong></div>`).join('')}</div>
        <p style="font-weight:700;">${r.rows.length} ${text.count}${r.invalid?' · '+text.invalid+r.invalid:''}</p>
        ${r.rows.length?r.rows.map(v=>`<div data-audit-sale="${esc(v.id)}" style="border-top:1px solid currentColor;padding:10px 0;"><strong>${esc(v.product)}</strong> · ${esc(v.day)}<div>${esc(v.rack)}${v.event?' · '+esc(v.event):''}</div><div>${v.units} × ${text.price} ${money(v.unitCents)} · ${text.total} <strong>${money(v.amountCents)}</strong> · ${esc(v.method || text.unspecified)}${v.returned?' · '+text.returned:''}</div></div>`).join(''):`<p>${text.empty}</p>`}`;
    }
    for(const key of ['from','to','rack','query']) host.querySelector('[data-audit-'+key+']').addEventListener(key==='query'?'input':'change',e=>{prior[key]=e.target.value;paint();});
    host.querySelector('[data-audit-reset]').addEventListener('click',()=>{for(const key of ['from','to','rack','query']){prior[key]='';host.querySelector('[data-audit-'+key+']').value='';}paint();});paint();
  }
  root.OCSalesAuditUI={mount};
})(window);
