/* friendly-123 C100 — Comisiones por artista/comisionista, SOLO PRESENTACION.
   Suma balances verificados de /api/liquidaciones por payeeId estable.
   No reconstruye ventas, no modifica pagos ni saldos del ledger. */
(function (root) {
  'use strict';
  function cents(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    var v = Math.round(n * 100);
    return Number.isSafeInteger(v) ? v : null;
  }
  function add(a, b) {
    if (a === null || b === null) return null;
    var total = a + b;
    return Number.isSafeInteger(total) ? total : null;
  }
  function group(liquidaciones) {
    var byId = new Map(), unverified = [], seen = new Set();
    (Array.isArray(liquidaciones) ? liquidaciones : []).forEach(function (l) {
      if (!l || !Array.isArray(l.payoutBalances) || !l.payoutBalances.length) {
        unverified.push({ rackId: l && l.ubicacionId || '', rackName: l && l.ubicacion || '' });
        return;
      }
      l.payoutBalances.forEach(function (b) {
        var id = b && typeof b.payeeId === 'string' ? b.payeeId.trim() : '';
        var rackId = String(l.ubicacionId || '');
        if (!id || id === '__unassigned__' || !rackId) {
          unverified.push({ rackId: rackId, rackName: String(l.ubicacion || '') });
          return;
        }
        var g = byId.get(id);
        if (!g) {
          g = { id: id, name: String(b.nombre || id), total: {earned:0,paid:0,due:0,held:0},
            deals:[], needsReview:false };
          byId.set(id, g);
        }
        var key = JSON.stringify([rackId, id]);
        if (seen.has(key)) {
          g.needsReview = true;
          g.deals.filter(function(d){return d.rackId===rackId;}).forEach(function(d){d.review=true;d.payable=false;});
          unverified.push({ rackId:rackId, rackName:String(l.ubicacion || ''), duplicate:true });
          return;
        }
        seen.add(key);
        var review = !!(l.needsReview ||
          (Array.isArray(l.paymentConflicts) && l.paymentConflicts.length) ||
          (Array.isArray(l.paymentQuarantine) && l.paymentQuarantine.length) ||
          (b && b.needsReview));
        var amounts = {earned:cents(b.earned), paid:cents(b.paid), due:cents(b.due), held:cents(b.held)};
        Object.keys(g.total).forEach(function (k) { g.total[k] = add(g.total[k], amounts[k]); });
        if (review) g.needsReview = true;
        var percentage = l.payoutBalances.length === 1 && typeof l.pctEfectivo==='number' &&
          Number.isFinite(l.pctEfectivo) ? l.pctEfectivo : null;
        g.deals.push({rackId:rackId,rackName:String(l.ubicacion || rackId),
          name:String(b.nombre || g.name), amount:amounts, percentage:percentage, review:review,
          payable:!review && Object.keys(amounts).every(function(k){return amounts[k]!==null;}) && amounts.due > 0 && !!b.nombre});
      });
    });
    return { people:Array.from(byId.values()).sort(function (a,b) {
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    }), unverified:unverified };
  }
  root.F123CommissionsByPerson = {group:group};
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  var container = document.getElementById('listaComisiones');
  if (!container || typeof MutationObserver === 'undefined') return;
  var state = {active:false, seq:0, grouped:null, selected:'', period:'', loading:false};
  function es() {
    try { return root.localStorage && root.localStorage.getItem('f123_lang') === 'es'; }
    catch (_) { return document.documentElement.lang === 'es'; }
  }
  function tx(a,b) {return es() ? a : b;}
  function esc(s) {return String(s == null ? '' : s).replace(/[&<>"']/g,function(c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });}
  function money(c) {
    if (c === null || !Number.isSafeInteger(c)) return '\u2014';
    if (typeof root.fmtMoney === 'function') return root.fmtMoney(c / 100);
    return '$' + (c / 100).toFixed(2);
  }
  function period() {
    var p = container.querySelector('[data-commissions-month]');
    return p ? String(p.value || '') : '';
  }
  function isPerson() {return state.active && root._ocVistaComisiones === 'person';}
  function ensure() {
    var bar = container.querySelector('[data-commissions-toolbar] [role="tablist"]');
    if (!bar) return false;
    if (!container.querySelector('#comm-tab-person')) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.id = 'comm-tab-person'; btn.className = 'tecla';
      btn.setAttribute('role', 'tab'); btn.dataset.commissionsView = 'person';
      btn.setAttribute('aria-controls','comm-panel-person');
      btn.setAttribute('aria-selected','false');
      btn.tabIndex = -1;
      btn.textContent = tx('Por artista / comisionista','By artist / associate');
      bar.insertBefore(btn,bar.firstChild);
    }
    if (!container.querySelector('[data-commissions-person-filter]')) {
      var filter = document.createElement('label');
      filter.dataset.commissionsPersonFilter = '1';
      filter.style.cssText = 'display:none;align-items:center;gap:6px;min-width:0;font-size:14px;font-weight:700;';
      var title = document.createElement('span');
      title.textContent = tx('Persona','Person');
      var select = document.createElement('select');
      select.dataset.commissionsPersonSelect = '1';
      select.style.cssText = 'min-height:40px;max-width:180px;min-width:0;background:white;color:#0F1923;border:2px solid #2C3E50;border-radius:6px;';
      filter.appendChild(title); filter.appendChild(select);
      bar.insertAdjacentElement('afterend',filter);
    }
    if (!container.querySelector('#comm-panel-person')) {
      var panel = document.createElement('section');
      panel.id = 'comm-panel-person';
      panel.setAttribute('role','tabpanel'); panel.setAttribute('aria-labelledby','comm-tab-person');
      panel.dataset.commissionsSection = 'by-person';
      panel.hidden = true;
      container.appendChild(panel);
    }
    return true;
  }
  function setMode() {
    if (!ensure()) return;
    var person = isPerson();
    var panel = container.querySelector('#comm-panel-person');
    var filter = container.querySelector('[data-commissions-person-filter]');
    if (panel) panel.hidden = !person;
    if (filter) filter.style.display = person ? 'inline-flex' : 'none';
    if (person) {
      container.querySelectorAll('[data-commissions-section]').forEach(function(p) {
        if (p !== panel) p.hidden = true;
      });
    }
    // C226: while By artist / associate is on, the global group buttons are shown released (one pressed button at a time).
    if (person) container.querySelectorAll('[data-commissions-view-global]').forEach(function(b) {
      b.setAttribute('aria-selected','false'); b.classList.remove('hundida');
    });
    container.querySelectorAll('[data-commissions-view]').forEach(function(b) {
      var on = person ? b.dataset.commissionsView === 'person' : b.dataset.commissionsView !== 'person' && b.getAttribute('aria-selected') === 'true';
      b.setAttribute('aria-selected',on ? 'true':'false');
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle('hundida',on);
    });
  }
  function selectOptions() {
    var select = container.querySelector('[data-commissions-person-select]');
    if (!select) return;
    /* C249+C247: in All dates use sales facets within the active date range + any live balances so
       the Persona pulldown is never empty and survives repaints/date changes. */
    var people = state.grouped ? state.grouped.people.slice() : [];
    var known = new Set(people.map(function(p){return String(p.id);}));
    if (root.OCCommissionHistory && root.OCCommissionHistory.facets && Array.isArray(root._ocComHistorySales)) {
      var fac = root.OCCommissionHistory.facets({
        sales: root._ocComHistorySales,
        from: root._ocComDesde || '',
        to: root._ocComHasta || '',
        lang: es() ? 'es' : 'en'
      });
      (fac.comisionista || []).forEach(function (a) {
        if (!a || !a.id || known.has(String(a.id))) return;
        known.add(String(a.id)); people.push({ id: String(a.id), name: String(a.name || a.id) });
      });
    } else {
      (Array.isArray(root._ocComHistorySales) ? root._ocComHistorySales : []).forEach(function(v) {
        var id = String(v && (v.promotoraId || v.asociadoNombre) || '');
        if (!id || known.has(id)) return;
        known.add(id); people.push({id:id, name:String(v.asociadoNombre || id)});
      });
    }
    people.sort(function(a,b){return String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id));});
    var ext = root._ocComFiltros && Array.isArray(root._ocComFiltros.comisionista) && root._ocComFiltros.comisionista.length === 1
      ? String(root._ocComFiltros.comisionista[0]) : '';
    var old = ext || state.selected;
    if (old && !people.some(function(p){return String(p.id) === old;})) old = '';
    state.selected = old;
    select.replaceChildren();
    [{id:'',name:tx('Todas las personas','All people')}].concat(people).forEach(function(p){
      var o = document.createElement('option'); o.value=p.id; o.textContent=p.name; select.appendChild(o);
    });
    select.value = old;
  }
  function groupAllDates(sales) {
    var H = root.OCCommissionHistory, lang = es() ? 'es' : 'en';
    var from = String(root._ocComDesde || ''), to = String(root._ocComHasta || '');
    if (from && to && from > to) return { allDates: true, invalidRange: true, people: [], unverified: [] };
    var fIn = root._ocComFiltros || {};
    var filtros = {
      comisionista: Array.isArray(fIn.comisionista) ? fIn.comisionista : [],
      producto: Array.isArray(fIn.producto) ? fIn.producto : [],
      percha: Array.isArray(fIn.percha) ? fIn.percha : [],
      cliente: Array.isArray(fIn.cliente) ? fIn.cliente : []
    };
    var filtered = H.filterSales({ sales: sales, from: from, to: to, filtros: filtros });
    var assocSet = filtros.comisionista.length ? new Set(filtros.comisionista.map(String)) : null;
    var seen = new Set(), byPerson = new Map(), byRack = new Map();
    filtered.forEach(function (v) {
      if (!v || v.anulada || v.cancelled || v.borrado) return;
      var rid = v.id != null ? String(v.id) : '';
      if (rid) { if (seen.has(rid)) return; seen.add(rid); }
      var rackId = String(v.ubicacionId || v.ubicacionNombre || 'rack');
      var rackName = String(v.ubicacionNombre || rackId || tx('Sin percha', 'Unnamed rack'));
      var shares = typeof H.saleAssociates === 'function'
        ? H.saleAssociates(v, lang).filter(function (a) { return !assocSet || assocSet.has(a.id); }).map(function (a) {
            if (a.commissionCents !== null) return { id: a.id, name: a.name, earnedCents: a.commissionCents };
            var raw = v.comisionAsociado != null ? Number(v.comisionAsociado) : (v.split ? Number(v.split.montoComisionSocio) : (v.noCommission === true ? 0 : NaN));
            return { id: a.id, name: a.name, earnedCents: Number.isFinite(raw) ? Math.round(raw * 100) : null };
          })
        : [];
      shares.forEach(function (s) {
        if (!s.id) return;
        var p = byPerson.get(s.id);
        if (!p) { p = { id: s.id, name: s.name, total: { earned: 0, paid: null, due: null, held: null }, deals: [], needsReview: false }; byPerson.set(s.id, p); }
        p.total.earned = add(p.total.earned, s.earnedCents);
        var dk = JSON.stringify([s.id, rackId]);
        var d = byRack.get(dk);
        if (!d) {
          d = { rackId: rackId, rackName: rackName, name: s.name, amount: { earned: 0, paid: null, due: null, held: null }, percentage: null, review: false, payable: false };
          byRack.set(dk, d); p.deals.push(d);
        }
        d.amount.earned = add(d.amount.earned, s.earnedCents);
      });
    });
    return {
      allDates: true,
      people: Array.from(byPerson.values()).sort(function (a, b) { return a.name.localeCompare(b.name) || a.id.localeCompare(b.id); }),
      unverified: []
    };
  }
  function render() {
    var panel = container.querySelector('#comm-panel-person');
    if (!panel || !isPerson()) return;
    if (!state.grouped) {
      panel.innerHTML = '<div class="tag-card" role="status">' +
        esc(state.loading ? tx('Consultando saldos por persona\u2026','Loading per-person balances\u2026') :
          tx('Saldos por persona no disponibles. Conservamos las vistas originales.','Per-person balances unavailable. Original views are unchanged.')) +
        '</div>';
      return;
    }
    if (state.grouped.invalidRange) {
      panel.innerHTML = '<div class="tag-card" role="alert" style="border:2px solid #a3392a;">' +
        esc(tx('Rango de fechas inv\u00e1lido: \u00abDesde\u00bb debe ser anterior o igual a \u00abHasta\u00bb.','Invalid date range: From must be on or before To.')) +
        '</div>';
      return;
    }
    var groups = state.grouped.people.filter(function(p) {return !state.selected || p.id === state.selected;});
    var html = '<h4 class="seccion" style="font-size:16px;margin:18px 0 10px;">' +
      esc(tx('Comisiones por artista / comisionista','Commissions by artist / associate')) + '</h4>';
    if (state.grouped.allDates) {
      html += '<p style="font-size:13px;color:var(--ink-soft,#334E68);margin:0 0 10px;">' +
        esc(tx('Comisiones devengadas seg\u00fan los filtros activos. Para registrar pagos, elige un mes en Per\u00edodo.','Earned commissions matching active filters. Select a month in Period to record payments.')) + '</p>';
    }
    groups.forEach(function(p) {
      html += '<article class="tag-card" data-cm-person-id="' + esc(p.id) +
        '" style="text-align:left;margin:0 0 12px;padding:14px 16px;">' +
        '<strong style="font-size:17px;">' + esc(p.name) + '</strong>' +
        (p.needsReview ? ' <span class="badge-estado rojo">' + esc(tx('Revisar pagos','Review payments')) + '</span>' : '') +
        '<div class="stats" style="margin:10px 0;">' +
        [[tx('Devengado','Earned'),'earned'],[tx('Pagado','Paid'),'paid'],
         [tx('Retenido','On hold'),'held'],[tx('Pendiente','Still due'),'due']].map(function(x) {
           return '<div><div class="rotulo">'+esc(x[0])+'</div><div class="cifra">'+
             esc(money(p.total[x[1]]))+'</div></div>';
         }).join('') + '</div>' +
        '<details><summary style="min-height:44px;cursor:pointer;font-size:14px;font-weight:700;">' +
        esc(tx('Ver tratos y perchas','Show deals and racks')) + ' (' + p.deals.length + ')</summary>';
      p.deals.forEach(function(d) {
        html += '<div style="border-top:1px solid #D7E0E8;padding:8px 0;" data-cm-person-rack="' + esc(d.rackId) + '">' +
          '<strong>' + esc(d.rackName) + '</strong>' +
          (d.percentage === null ? '' : ' <span style="font-size:13px;">(' + esc(d.percentage) + '%)</span>') +
          '<div style="font-size:14px;">' +
          esc(tx('Devengado','Earned')) + ': ' + esc(money(d.amount.earned)) + ' \u00b7 ' +
          esc(tx('Pagado','Paid')) + ': ' + esc(money(d.amount.paid)) + ' \u00b7 ' +
          esc(tx('Pendiente','Still due')) + ': ' + esc(money(d.amount.due)) + '</div>' +
          (d.payable ? '<button type="button" class="ir" data-cm-person-pay="' + esc(p.id) +
            '" data-cm-person-rack="' + esc(d.rackId) + '" style="min-height:44px;">' +
            esc(tx('Registrar pago','Record payment')) + ' ('+esc(money(d.amount.due))+')</button>' : '') +
          '</div>';
      });
      html += '</details></article>';
    });
    if (!groups.length) html += '<div class="tag-card">'+esc(tx('Ningún saldo conciliado para esta selección.','No reconciled balances for this selection.'))+'</div>';
    if (state.grouped.unverified.length) html += '<div class="tag-card" role="status" style="font-size:14px;">' +
      esc(tx('Hay perchas sin saldos individuales verificables. Consulta la vista Por percha; no se han supuesto montos ni beneficiarios.','Some racks lack verified person balances. Check By rack; no amounts or identities were guessed.')) + '</div>';
    panel.innerHTML=html;
  }
  async function load() {
    if (!isPerson() || !ensure()) return;
    var seq=++state.seq, month=period();
    state.period=month; state.grouped=null; state.loading=true;
    setMode(); render();
    try {
      if (!month && root.OCCommissionHistory && typeof root.OCCommissionHistory.filterSales === 'function') {
        var sales = Array.isArray(root._ocComHistorySales) ? root._ocComHistorySales : null;
        if (!sales) {
          var apiBase = typeof root.API === 'string' && root.API ? root.API : '/api';
          var vr = await fetch(apiBase + '/ventas/todas?ubicacionId=todas');
          if (!vr.ok) throw new Error('HTTP ' + vr.status);
          sales = await vr.json();
          if (Array.isArray(sales)) root._ocComHistorySales = sales;
        }
        if (seq !== state.seq || !isPerson() || month !== period()) return;
        state.grouped = groupAllDates(sales);
      } else {
        var response=await fetch('/api/liquidaciones?mes='+encodeURIComponent(month));
        if (!response.ok) throw new Error('HTTP '+response.status);
        var rows=await response.json();
        if (!Array.isArray(rows)) throw new Error('Invalid balances');
        if (seq !== state.seq || !isPerson() || month !== period()) return;
        state.grouped=group(rows);
      }
    } catch (_) {
      if (seq !== state.seq || !isPerson()) return;
      state.grouped=null;
    } finally {
      if (seq === state.seq && isPerson()) {
        state.loading=false; selectOptions(); render();
      }
    }
  }
  root.F123CommissionsByPerson.refresh = function () {
    if (isPerson()) load();
  };
  var original=root.cambiarVistaComisiones;
  if (typeof original !== 'function') return;
  root.cambiarVistaComisiones = function (vista) {
    if (vista !== 'person') {
      state.active=false; state.seq++;
      original(vista); setMode(); return;
    }
    original('product');
    state.active=true;
    root._ocVistaComisiones='person';
    setMode(); load();
  };
  container.addEventListener('click',function(e) {
    var tab=e.target.closest('#comm-tab-person');
    // C226 (JFC 23 nov 2026: "By artist/associate debe ser des-elegible"): a second tap turns it off; with nothing on -> RAW.
    if (tab) {
      e.preventDefault();
      if (isPerson()) {
        root.cambiarVistaComisiones('product');
        if (typeof root.cambiarRangoComisionesGlobal === 'function') root.cambiarRangoComisionesGlobal('grupo','total');
      } else root.cambiarVistaComisiones('person');
      return;
    }
    var b=e.target.closest('[data-cm-person-pay]');
    if (!b || !isPerson()) return;
    var p=state.grouped && state.grouped.people.find(function(x){return x.id===b.dataset.cmPersonPay;});
    var d=p && p.deals.find(function(x){return x.rackId===b.dataset.cmPersonRack;});
    if (!p || !d || !d.payable || d.amount.due===null || d.amount.due<=0 ||
      typeof root.marcarComisionPagada!=='function') return;
    root.marcarComisionPagada(d.rackId,d.name,d.amount.due/100,p.id);
  });
  container.addEventListener('change',function(e){
    if (!e.target.matches('[data-commissions-person-select]')) return;
    state.selected=e.target.value; render();
  });
  var observer=new MutationObserver(function() {
    if (!container.querySelector('[data-commissions-toolbar]')) return;
    var had=!!container.querySelector('#comm-tab-person');
    if (!ensure()) return;
    setMode();
    if (isPerson()) selectOptions();
    if (isPerson() && !had) load();
  });
  observer.observe(container,{childList:true,subtree:false});
  ensure();
  if (root._ocVistaComisiones === 'person') root.cambiarVistaComisiones('person');
})(typeof window !== 'undefined' ? window : globalThis);
