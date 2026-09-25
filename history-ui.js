import {money,dayOf,addDays,weekStart} from './calc-model.js';
import {escapeHtml as esc,dayLabel,downloadCsv,readUiPreference,saveUiPreference} from './ui-utils.js';
// Read-only look back over one account: totals, a 30-day chart, what each band added up to, and every count.
export async function mountHistory(root,session,{request}){
  let state,range=readUiPreference('history-range:'+session.user.id)||'30',band='',query='',limit=40,entered=false;
  const seen=()=>{root.seenCounts=state.countsRevision;root.seenPrices=state.pricesRevision;root.seenDay=state.day;};
  root.refreshFromServer=async()=>{if(!root.isConnected)return false;state=await request('/api/me');seen();render();return true;};
  const dayOfCount=e=>dayOf(Date.parse(e.at));
  const sum=rows=>rows.reduce((n,e)=>n+e.total,0);
  const when=at=>new Date(at).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  const short=name=>name.replace(/ band$/i,'');
  const plural=(n,word)=>n.toLocaleString()+' '+word+(n===1?'':'s');
  function stats(){
    const rows=state.counts,today=state.day,week=weekStart(today),month=today.slice(0,8);
    const byDay=new Map();for(const e of rows){const d=dayOfCount(e);byDay.set(d,(byDay.get(d)||0)+e.total);}
    const best=[...byDay].sort((a,b)=>b[1]-a[1])[0];
    const cashed=state.cashouts.reduce((n,c)=>n+c.amount,0),open=sum(rows.filter(e=>!e.cashoutId));
    const tiles=[['Today',sum(rows.filter(e=>dayOfCount(e)===today))],['This week',sum(rows.filter(e=>dayOfCount(e)>=week)),'Since Thursday'],['This month',sum(rows.filter(e=>dayOfCount(e).startsWith(month)))],['All time',sum(rows),plural(rows.length,'count')],['Cashed out',cashed,plural(state.cashouts.length,'cash-out')],['Not cashed out',open],['Average count',rows.length?Math.round(sum(rows)/rows.length/100)*100:0],['Best day',best?best[1]:0,best?dayLabel(best[0]):'']];
    return '<dl class="history-stats">'+tiles.map(([label,value,note],i)=>'<div style="--i:'+i+'"><dt>'+label+'</dt><dd'+(value?'':' class="is-zero"')+'>'+money(value)+'</dd><small>'+esc(note||'')+'</small></div>').join('')+'</dl>';
  }
  function chart(){
    const days=[...Array(30)].map((_,i)=>addDays(state.day,i-29)),totals=new Map(days.map(d=>[d,0]));
    for(const e of state.counts){const d=dayOfCount(e);if(totals.has(d))totals.set(d,totals.get(d)+e.total);}
    const max=Math.max(...totals.values()),sum30=[...totals.values()].reduce((a,b)=>a+b,0),active=[...totals.values()].filter(Boolean).length;
    const cashDays=new Set(state.cashouts.map(c=>dayOf(Date.parse(c.at))));
    const label=d=>new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
    const bars=days.map((d,i)=>{const v=totals.get(d),h=max?Math.max(v?3:0,v/max*100):0;return '<li class="'+(d===state.day?'is-today':'')+(cashDays.has(d)?' is-cashout':'')+'" style="--h:'+h.toFixed(1)+'%;--i:'+i+'" title="'+esc(label(d)+': '+money(v)+(cashDays.has(d)?' · cashed out':''))+'">'+(cashDays.has(d)?'<i aria-hidden="true"></i>':'')+'<span class="history-bar"></span><span class="sr-only">'+esc(label(d)+': '+money(v))+'</span></li>';}).join('');
    const axis=[0,10,20,29].map(i=>'<span>'+esc(i===29?'Today':label(days[i]))+'</span>').join('');
    return '<section class="history-chart"><div class="history-head"><h2>Last 30 days</h2><p>'+(max?money(sum30)+' across '+plural(active,'day')+' · ':'')+'<span class="history-cash-key">▪</span> cash-out</p></div>'+(max?'<ol class="history-bars" aria-label="Daily totals, last 30 days">'+bars+'</ol><div class="history-axis" aria-hidden="true">'+axis+'</div>':'<p class="history-empty"><strong>Nothing in the last 30 days.</strong>Saved counts show up here as daily bars.</p>')+'</section>';
  }
  function bands(){
    const totals=new Map();
    for(const e of state.counts)for(const l of e.lines){const t=totals.get(l.id)||{name:l.name,color:l.color,quantity:0,amount:0};t.quantity+=l.quantity;t.amount+=l.quantity*l.price;totals.set(l.id,t);}
    const rows=[...totals.values()].sort((a,b)=>b.amount-a.amount),top=rows[0]?.amount||1;
    return '<section class="history-bands"><h2>By band</h2><p class="history-sub">At the price each count was saved at.</p>'+(rows.length?'<ul>'+rows.map(r=>'<li style="--band:'+esc(r.color)+';--w:'+(r.amount/top*100).toFixed(1)+'%"><span class="history-band-name"><i></i>'+esc(short(r.name))+'</span><span class="history-band-bar"><span></span></span><span class="history-band-qty">×'+r.quantity.toLocaleString()+'</span><strong>'+money(r.amount)+'</strong></li>').join('')+'</ul>':'<p class="history-empty"><strong>No bands counted yet.</strong></p>')+'</section>';
  }
  function cashouts(){
    const counts=new Map();for(const e of state.counts)if(e.cashoutId)counts.set(e.cashoutId,(counts.get(e.cashoutId)||0)+1);
    return '<section class="history-cashouts"><h2>Cash-outs</h2><p class="history-sub">Each one closed the running total at that moment.</p>'+(state.cashouts.length?'<ol>'+state.cashouts.map(c=>'<li><time datetime="'+esc(c.at)+'">'+esc(when(c.at))+'</time><strong>'+money(c.amount)+'</strong><span>'+plural(counts.get(c.id)||0,'count')+'</span></li>').join('')+'</ol>':'<p class="history-empty"><strong>No cash-outs yet.</strong>Cash out from the calculator when you get paid.</p>')+'</section>';
  }
  function filtered(){
    const from=range==='all'?'':addDays(state.day,1-Number(range)),q=query.trim().toLowerCase();
    return state.counts.filter(e=>(!from||dayOfCount(e)>=from)&&(!band||e.lines.some(l=>l.id===band))&&(!q||e.notes.toLowerCase().includes(q)||e.lines.some(l=>l.name.toLowerCase().includes(q))));
  }
  function list(){
    const rows=filtered(),names=new Map();for(const e of state.counts)for(const l of e.lines)if(!names.has(l.id))names.set(l.id,l.name);
    const byDay=new Map();for(const e of rows.slice(0,limit)){const d=dayOfCount(e);if(!byDay.has(d))byDay.set(d,[]);byDay.get(d).push(e);}
    const row=e=>'<article class="history-row"><time datetime="'+esc(e.at)+'">'+esc(new Date(e.at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}))+'</time><div class="history-row-detail"><span class="history-chips">'+e.lines.map(l=>'<span style="--band:'+esc(l.color)+'"><i></i>'+esc(short(l.name))+' <b>'+l.quantity.toLocaleString()+'</b></span>').join('')+'</span>'+(e.notes?'<span class="history-row-note">'+esc(e.notes)+'</span>':'')+'</div><strong>'+money(e.total)+'</strong><small>'+(e.cashoutId?'Cashed out':'Open')+'</small></article>';
    const groups=[...byDay].map(([d,items])=>'<div class="history-day"><h3><span>'+esc(d===state.day?'Today':d===addDays(state.day,-1)?'Yesterday':dayLabel(d))+'</span><strong>'+money(sum(state.counts.filter(e=>dayOfCount(e)===d)))+'</strong></h3>'+items.map(row).join('')+'</div>').join('');
    const chevron='<span class="history-chevron" aria-hidden="true"><i></i></span>';
    return '<section class="history-list"><div class="history-head"><h2>Every count</h2><p class="history-count">'+plural(rows.length,'count')+' · '+money(sum(rows))+'</p></div><div class="history-filters"><label class="history-pill"><span class="sr-only">Range</span><select data-history-range><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All time</option></select>'+chevron+'</label><label class="history-pill"><span class="sr-only">Band</span><select data-history-band><option value="">Any band</option>'+[...names].map(([id,name])=>'<option value="'+esc(id)+'">'+esc(name)+'</option>').join('')+'</select>'+chevron+'</label><label class="history-pill history-search"><span class="sr-only">Search</span><input type="search" data-history-query placeholder="Search notes or bands" value="'+esc(query)+'"></label></div><div data-history-rows>'+(groups||'<p class="history-empty"><strong>No counts match.</strong>Try a wider range.</p>')+'</div>'+(rows.length>limit?'<div class="history-more"><button type="button" class="button secondary" data-history-more>Show '+Math.min(40,rows.length-limit)+' more</button></div>':'')+'</section>';
  }
  function exportCsv(){
    const rows=filtered(),ids=[];const names=new Map();for(const e of rows)for(const l of e.lines)if(!names.has(l.id)){names.set(l.id,l.name);ids.push(l.id);}
    downloadCsv('pto-counts-'+state.day+'.csv',[['Date','Time','Total','Note','Cashed out',...ids.map(id=>names.get(id))],...rows.map(e=>{const d=new Date(e.at);return [dayOfCount(e),d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}),(e.total/100).toFixed(2),e.notes,e.cashoutId?'yes':'no',...ids.map(id=>e.lines.find(l=>l.id===id)?.quantity||'')];})]);
  }
  function render(){
    if(!root.isConnected)return;
    const focus=document.activeElement?.matches?.('[data-history-query]'),caret=focus?document.activeElement.selectionStart:0;
    const enter=entered?'':' history-enter';entered=true;
    root.innerHTML='<div class="history-page'+enter+'"><div class="page-heading"><div><h1>History</h1><p>Every count you\'ve saved and every cash-out. Days follow Central time; weeks start Thursday.</p></div><button type="button" class="button secondary history-csv" data-history-csv '+(filtered().length?'':'disabled')+'>Export CSV</button></div>'+stats()+'<div class="history-grid">'+chart()+bands()+'</div><div class="history-grid">'+list()+cashouts()+'</div></div>';
    root.querySelector('[data-history-range]').value=range;root.querySelector('[data-history-band]').value=band;
    root.querySelector('[data-history-range]').onchange=e=>{range=e.target.value;saveUiPreference('history-range:'+session.user.id,range);limit=40;render();};
    root.querySelector('[data-history-band]').onchange=e=>{band=e.target.value;limit=40;render();};
    const search=root.querySelector('[data-history-query]');search.oninput=()=>{query=search.value;limit=40;render();};
    if(focus){search.focus();search.setSelectionRange(caret,caret);}
    root.querySelector('[data-history-csv]').onclick=exportCsv;
    root.querySelector('[data-history-more]')?.addEventListener('click',()=>{limit+=40;render();});
  }
  try{state=await request('/api/me');if(!root.isConnected)return;seen();render();}catch(e){root.innerHTML='<p class="notice error">'+esc(e.message)+'</p>';}
}
