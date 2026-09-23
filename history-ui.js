import {money,dayOf,addDays,weekStart} from './calc-model.js';
import {escapeHtml as esc,dayLabel,downloadCsv,readUiPreference,saveUiPreference} from './ui-utils.js';
// Read-only look back over one account: totals, a 30-day chart, what each band added up to, and every count.
export async function mountHistory(root,session,{request}){
  let state,range=readUiPreference('history-range:'+session.user.id)||'30',band='',query='',limit=40;
  const seen=()=>{root.seenCounts=state.countsRevision;root.seenPrices=state.pricesRevision;root.seenDay=state.day;};
  root.refreshFromServer=async()=>{if(!root.isConnected)return false;state=await request('/api/me');seen();render();return true;};
  const dayOfCount=e=>dayOf(Date.parse(e.at));
  const sum=rows=>rows.reduce((n,e)=>n+e.total,0);
  const when=at=>new Date(at).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  function stats(){
    const rows=state.counts,today=state.day,week=weekStart(today),month=today.slice(0,8);
    const byDay=new Map();for(const e of rows){const d=dayOfCount(e);byDay.set(d,(byDay.get(d)||0)+e.total);}
    const best=[...byDay].sort((a,b)=>b[1]-a[1])[0];
    const cashed=state.cashouts.reduce((n,c)=>n+c.amount,0),open=sum(rows.filter(e=>!e.cashoutId));
    const tiles=[['Today',sum(rows.filter(e=>dayOfCount(e)===today))],['This week',sum(rows.filter(e=>dayOfCount(e)>=week)),'Since Thursday'],['This month',sum(rows.filter(e=>dayOfCount(e).startsWith(month)))],['All time',sum(rows),rows.length+(rows.length===1?' count':' counts')],['Cashed out',cashed,state.cashouts.length+(state.cashouts.length===1?' cash-out':' cash-outs')],['Not cashed out',open],['Average count',rows.length?Math.round(sum(rows)/rows.length/100)*100:0],['Best day',best?best[1]:0,best?dayLabel(best[0]):'']];
    return '<dl class="history-stats">'+tiles.map(([label,value,note])=>'<div><dt>'+label+'</dt><dd>'+money(value)+'</dd>'+(note?'<small>'+esc(note)+'</small>':'')+'</div>').join('')+'</dl>';
  }
  function chart(){
    const days=[...Array(30)].map((_,i)=>addDays(state.day,i-29)),totals=new Map(days.map(d=>[d,0]));
    for(const e of state.counts){const d=dayOfCount(e);if(totals.has(d))totals.set(d,totals.get(d)+e.total);}
    const max=Math.max(...totals.values()),sum30=[...totals.values()].reduce((a,b)=>a+b,0),active=[...totals.values()].filter(Boolean).length;
    const cashDays=new Set(state.cashouts.map(c=>dayOf(Date.parse(c.at))));
    const bars=days.map(d=>{const v=totals.get(d),h=max?Math.max(v?3:0,v/max*100):0;const label=new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});return '<li class="'+(d===state.day?'is-today':'')+(cashDays.has(d)?' is-cashout':'')+'" style="--h:'+h.toFixed(1)+'%" title="'+esc(label+': '+money(v)+(cashDays.has(d)?' · cashed out':''))+'"><span class="history-bar"></span><span class="sr-only">'+esc(label+': '+money(v))+'</span></li>';}).join('');
    const axis=[0,10,20,29].map(i=>'<span style="--x:'+(i/29*100).toFixed(1)+'%">'+esc(new Date(days[i]+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}))+'</span>').join('');
    return '<section class="panel history-chart"><div class="calc-head"><div><h2>Last 30 days</h2><p>'+money(sum30)+' across '+active+(active===1?' day':' days')+(max?' · best day '+money(max):'')+'. Gold marks a cash-out.</p></div></div>'+(max?'<ol class="history-bars" aria-label="Daily totals, last 30 days">'+bars+'</ol><div class="history-axis" aria-hidden="true">'+axis+'</div>':'<p class="calc-empty"><strong>Nothing in the last 30 days.</strong>Saved counts show up here as daily bars.</p>')+'</section>';
  }
  function bands(){
    const totals=new Map();
    for(const e of state.counts)for(const l of e.lines){const t=totals.get(l.id)||{name:l.name,color:l.color,quantity:0,amount:0};t.quantity+=l.quantity;t.amount+=l.quantity*l.price;totals.set(l.id,t);}
    const rows=[...totals.values()].sort((a,b)=>b.amount-a.amount),top=rows[0]?.amount||1;
    return '<section class="panel history-bands"><div class="calc-head"><div><h2>By band</h2><p>Everything you have ever saved, at the price each count was saved at.</p></div></div>'+(rows.length?'<ul>'+rows.map(r=>'<li style="--band:'+esc(r.color)+';--w:'+(r.amount/top*100).toFixed(1)+'%"><span class="history-band-name"><i></i>'+esc(r.name)+'</span><span class="history-band-bar"><span></span></span><span class="history-band-qty">×'+r.quantity.toLocaleString()+'</span><strong>'+money(r.amount)+'</strong></li>').join('')+'</ul>':'<p class="calc-empty"><strong>No bands counted yet.</strong></p>')+'</section>';
  }
  function cashouts(){
    const counts=new Map();for(const e of state.counts)if(e.cashoutId)counts.set(e.cashoutId,(counts.get(e.cashoutId)||0)+1);
    return '<section class="panel history-cashouts"><div class="calc-head"><div><h2>Cash-outs</h2><p>Each one closed out the running total at that moment.</p></div></div>'+(state.cashouts.length?'<ol>'+state.cashouts.map(c=>'<li><time datetime="'+esc(c.at)+'">'+esc(when(c.at))+'</time><span>'+(counts.get(c.id)||0)+((counts.get(c.id)||0)===1?' count':' counts')+'</span><strong>'+money(c.amount)+'</strong></li>').join('')+'</ol>':'<p class="calc-empty"><strong>No cash-outs yet.</strong>Cash out from the calculator when you get paid.</p>')+'</section>';
  }
  function filtered(){
    const from=range==='all'?'':addDays(state.day,1-Number(range)),q=query.trim().toLowerCase();
    return state.counts.filter(e=>(!from||dayOfCount(e)>=from)&&(!band||e.lines.some(l=>l.id===band))&&(!q||e.notes.toLowerCase().includes(q)||e.lines.some(l=>l.name.toLowerCase().includes(q))));
  }
  function list(){
    const rows=filtered(),names=new Map();for(const e of state.counts)for(const l of e.lines)if(!names.has(l.id))names.set(l.id,l.name);
    const byDay=new Map();for(const e of rows.slice(0,limit)){const d=dayOfCount(e);if(!byDay.has(d))byDay.set(d,[]);byDay.get(d).push(e);}
    const groups=[...byDay].map(([d,items])=>'<div class="history-day"><h3><span>'+esc(d===state.day?'Today':d===addDays(state.day,-1)?'Yesterday':dayLabel(d))+'</span><strong>'+money(sum(state.counts.filter(e=>dayOfCount(e)===d)))+'</strong></h3>'+items.map(e=>'<article class="calc-row"><div><time datetime="'+esc(e.at)+'">'+esc(new Date(e.at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}))+'</time>'+(e.notes?'<span class="calc-row-note">'+esc(e.notes)+'</span>':'')+'<span class="calc-chips">'+e.lines.map(l=>'<span style="--band:'+esc(l.color)+'"><i></i>'+esc(l.name.replace(/ band$/i,''))+' <strong>'+l.quantity.toLocaleString()+'</strong></span>').join('')+'</span></div><div class="calc-row-amount"><strong>'+money(e.total)+'</strong><small>'+(e.cashoutId?'Cashed out':'Open')+'</small></div></article>').join('')+'</div>').join('');
    return '<section class="panel history-list"><div class="calc-head"><div><h2>Every count</h2><p>'+rows.length+(rows.length===1?' count':' counts')+' · '+money(sum(rows))+'</p></div><button type="button" class="button secondary" data-history-csv '+(rows.length?'':'disabled')+'>Export CSV</button></div><div class="history-filters"><label>Range<select data-history-range><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All time</option></select></label><label>Band<select data-history-band><option value="">Any band</option>'+[...names].map(([id,name])=>'<option value="'+esc(id)+'">'+esc(name)+'</option>').join('')+'</select></label><label class="history-search">Search<input type="search" data-history-query placeholder="Note or band" value="'+esc(query)+'"></label></div><div data-history-rows>'+(groups||'<p class="calc-empty"><strong>No counts match.</strong>Try a wider range.</p>')+'</div>'+(rows.length>limit?'<div class="calc-recent-foot"><button type="button" class="button secondary" data-history-more>Show '+Math.min(40,rows.length-limit)+' more</button></div>':'')+'</section>';
  }
  function exportCsv(){
    const rows=filtered(),ids=[];const names=new Map();for(const e of rows)for(const l of e.lines)if(!names.has(l.id)){names.set(l.id,l.name);ids.push(l.id);}
    downloadCsv('pto-counts-'+state.day+'.csv',[['Date','Time','Total','Note','Cashed out',...ids.map(id=>names.get(id))],...rows.map(e=>{const d=new Date(e.at);return [dayOfCount(e),d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}),(e.total/100).toFixed(2),e.notes,e.cashoutId?'yes':'no',...ids.map(id=>e.lines.find(l=>l.id===id)?.quantity||'')];})]);
  }
  function render(){
    if(!root.isConnected)return;
    const focus=document.activeElement?.matches?.('[data-history-query]'),caret=focus?document.activeElement.selectionStart:0;
    root.innerHTML='<div class="history-page"><div class="page-heading"><div><span class="eyebrow">Your account</span><h1>History</h1><p>Every count you have saved and every cash-out.</p></div><a class="button secondary" href="#/">Back to the calculator</a></div>'+stats()+'<div class="history-grid">'+chart()+bands()+'</div><div class="history-grid history-grid-wide">'+list()+cashouts()+'</div></div>';
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
