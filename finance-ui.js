import {depositTotal,outstanding,stashBreakdown,financeMoney as money,nextThursday,financeDay} from './finance-model.js';
import {readDraft,saveDraft,clearDraft} from './draft-store.js';
import {escapeHtml as esc,timestamp,dayLabel,downloadCsv,uiIcon,revealContent,readUiPreference,saveUiPreference} from './ui-utils.js';
import {createQuickMath} from './quick-math.js';
import {scanImage,saveAlias} from './band-scan.js';
export async function mountFinance(root,session,{request,onSaved,onClean,canRefresh}){
  let state,tab='payouts',history='add',confirm=null,message='',filter='',statusFilter='all',from='',to='',limit=20,filtersOpen=false;
  const memberId=session.user.id,mode=root.dataset.financeMode;
  const sectionKey=name=>`finance-section:${session.user.id}:${name}`;
  const quickMath=createQuickMath();let mathOpen=readUiPreference(sectionKey('math'))==='open';
  const savedStash=readUiPreference(sectionKey('stash')),savedTreasury=readUiPreference(sectionKey('treasury'));
  if(['add','pending','history'].includes(savedStash))history=savedStash;
  if(['payouts','bills','transactions','cash'].includes(savedTreasury))tab=savedTreasury;
  if(mode==='settings')tab='settings';
  let draft=readDraft(memberId)||{quantities:{},notes:'',requestId:crypto.randomUUID()},draftStored=true,savedFlash=false,entered=false,shots=[],scanQueue=null,scanProgress='',scanOthersOpen=false,renderScan=null;
  const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const own=()=>state.deposits.filter(e=>e.userId===memberId);
  const hasDraft=()=>Object.values(draft.quantities).some(v=>Number(v)>0)||!!draft.notes;
  const notice=()=>root.querySelector('[data-finance-message]');
  function error(e){message=e.message;const n=notice();if(n){n.hidden=false;n.textContent=message;n.scrollIntoView({block:'nearest'});}}
  const canLoad=()=>root.isConnected&&!root.busy&&!confirm&&canRefresh();
  root.seenAccounts=session.versions?.accounts;
  root.openReceipt=id=>{const e=state?.deposits.find(e=>e.id===id);if(!e)return;history=e.status==='pending'?'pending':'history';tab='transactions';filter=id;statusFilter='all';from='';to='';limit=20;render();const card=root.querySelector('[data-receipt-id="'+CSS.escape(id)+'"]');if(card){const details=card.querySelector('details');if(details)details.open=true;card.scrollIntoView({block:'nearest'});}};
  function seen(){root.seenRevision=state.revision;root.seenDay=state.day;}
  root.refreshFromServer=async()=>{if(!canLoad())return false;const fresh=await request('/api/finance');if(!canLoad())return false;const focus=document.activeElement?.id,selection=document.activeElement?.selectionStart;
    if(mode==='bands'&&fresh.ratesVersion===state.ratesVersion&&root.querySelector('#finance-deposit-form')?.contains(document.activeElement)){state=fresh;seen();patchAroundForm();return true;}
    if(mode==='bands'&&hasDraft()&&fresh.ratesVersion!==state.ratesVersion)message='Band values were updated. Your counts are kept and the total now uses the new values.';state=fresh;seen();render();if(focus){const el=root.querySelector('#'+CSS.escape(focus));el?.focus();if(el&&selection!==null&&['text','search'].includes(el.type))el.setSelectionRange(selection,selection);}return true;};
  async function save(path,body){
    if(root.busy)return;root.busy=true;root.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=true);message='';
    try{state=await request(path,{method:'POST',body});seen();confirm=null;
      if(path==='/api/finance/deposits'){clearDraft(memberId);draft={quantities:{},notes:'',requestId:crypto.randomUUID()};history='pending';message='';savedFlash=true;}
      else message=mode==='bands'?'':'Saved. The updated records are shown below.';
      onClean();await onSaved(body?.decision==='withdraw'?'removed':'saved');render();
      if(savedFlash){savedFlash=false;root.querySelector('[data-calc-hero]')?.classList.add('is-saved');root.querySelector('.calc-row')?.classList.add('is-new');const status=root.querySelector('[data-draft-status]');if(status){status.textContent='Count saved. Your totals are updated.';status.classList.add('is-saved');}}
    }catch(e){error(e);}finally{root.busy=false;root.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=false);root.querySelectorAll('[data-finance-quantity]').forEach(i=>i.disabled=!state.bands.find(b=>b.id===i.dataset.financeQuantity)?.price);syncQuantityButtons();if(mode==='bands'){const total=draftTotal();root.querySelectorAll('[data-calc-save]').forEach(b=>b.disabled=!total);root.querySelectorAll('[data-discard]').forEach(b=>b.disabled=!hasDraft());}}
  }
  const identity=e=>[e.identity?.stateId?'State ID '+e.identity.stateId:'State ID not set',e.identity?.username?'@'+e.identity.username:''].filter(Boolean).join(' · ');
  const totalPaid=()=>state.payouts.filter(p=>p.userId===memberId&&!p.reversal).reduce((n,p)=>n+p.amount,0);
  function bandStrip(entries){const rows=stashBreakdown(entries);return rows.length?'<div class="band-strip">'+rows.map(b=>'<span style="--band:'+esc(b.color)+'"><i></i>'+esc(b.name)+' <strong>'+b.quantity.toLocaleString()+'</strong></span>').join('')+'</div>':'<p class="muted">No outstanding bands.</p>';}
  function entry(e,review=false){
    const payments=state.payouts.filter(p=>p.entryIds.includes(e.id)),partial=e.status==='pending'&&e.paidAmount>0;
return '<article class="transaction-card" data-receipt-id="'+esc(e.id)+'"><details><summary><span><strong>'+esc(e.name)+'</strong><small>'+esc(timestamp(e.at))+' · '+esc(identity(e))+'</small></span><span><strong>'+money(e.remaining||depositTotal(e))+'</strong><small>'+({pending:partial?'Partially paid':e.requiresVerification&&!e.verified?'Awaiting verification':'Awaiting payout',paid:'Paid',rejected:'Rejected',withdrawn:'Withdrawn'}[e.status])+' '+uiIcon('chevron')+'</small></span></summary><div class="transaction-body">'+e.lines.map(l=>'<div class="finance-line"><span>'+esc(l.name)+' × '+l.quantity+' <small>at '+money(l.price)+'</small></span><strong>'+money(l.price*l.quantity)+'</strong></div>').join('')+
      (partial?'<p>Original value '+money(depositTotal(e))+' · Paid '+money(e.paidAmount)+' · Remaining '+money(e.remaining)+'</p>':'')+(e.notes?'<p>'+esc(e.notes)+'</p>':'')+
      (e.verified?'<p>Verified by '+esc(e.verified.byName)+' · '+esc(timestamp(e.verified.at))+'</p>':'')+
      payments.map(p=>'<p class="finance-receipt">'+(p.reversal?'Reversed payment':'Payment')+' '+money(p.allocations?.find(a=>a.entryId===e.id)?.amount??depositTotal(e))+' · '+esc(p.byName)+' · '+esc(timestamp(p.at))+'<br><small>Reference '+esc(p.id)+'</small>'+(p.reversal?'<br>Reversed by '+esc(p.reversal.byName)+': '+esc(p.reversal.reason):'')+(state.owner&&!p.reversal?'<button class="text-button" data-reverse="'+esc(p.id)+'" data-kind="payout">Correct this payment</button>':'')+'</p>').join('')+
      (e.reason?'<p class="finance-receipt">'+esc(e.reviewedByName)+' · '+esc(timestamp(e.reviewedAt))+'<br>'+esc(e.reason)+'</p>':'')+'<small class="record-reference">Deposit '+esc(e.id)+'</small></div></details><div class="entry-actions">'+
      (e.status==='pending'&&review&&state.canManage?(e.requiresVerification&&!e.verified?'<button class="button secondary" data-verify="'+esc(e.id)+'">Verify bands</button>':'')+(e.paidAmount?'':'<button class="text-button" data-reject="'+esc(e.id)+'">Reject incorrect deposit</button>'):'')+
      (e.userId===memberId&&e.status==='pending'&&!e.paidAmount?'<button class="text-button" data-withdraw="'+esc(e.id)+'">Withdraw / correct</button>':'')+
      (e.userId===memberId&&['withdrawn','rejected'].includes(e.status)?'<button class="text-button" data-copy="'+esc(e.id)+'">Use quantities in a new draft</button>':'')+'</div></article>';
  }
  function historyControls(){return '<details class="finance-filters" '+(filtersOpen||filter||statusFilter!=='all'||from||to?'open':'')+'><summary>Search & filter receipts</summary><div class="history-tools"><label>Search receipts<input data-history-search value="'+esc(filter)+'" placeholder="Name, State ID, reference…"></label><label>Status<select data-history-status>'+['all','pending','paid','rejected','withdrawn'].map(s=>'<option '+(s===statusFilter?'selected':'')+' value="'+s+'">'+({all:'All statuses',pending:'Unpaid',paid:'Paid',rejected:'Rejected',withdrawn:'Withdrawn'}[s])+'</option>').join('')+'</select></label><label>From<input type="date" data-history-from value="'+from+'"></label><label>To<input type="date" data-history-to value="'+to+'"></label><button type="button" class="text-button" data-clear-filters>Clear filters</button><button class="button secondary" data-export>Export CSV</button></div></details>';}
  function filtered(rows){return rows.filter(e=>(statusFilter==='all'||e.status===statusFilter)&&(!filter||[e.name,e.id,identity(e)].join(' ').toLowerCase().includes(filter.toLowerCase()))&&(!from||e.at.slice(0,10)>=from)&&(!to||e.at.slice(0,10)<=to));}
  function list(rows,review=false){const results=filtered(rows);return '<div data-transaction-results>'+results.slice(0,limit).map(e=>entry(e,review)).join('')+(results.length?'':'<div class="finance-empty">No matching records.</div>')+(results.length>limit?'<button class="button secondary" data-more>Load 20 more ('+(results.length-limit)+' remaining)</button>':'')+'</div>';}
  // ── Band calculator (mode 'bands') ─────────────────────────────
  const counted=()=>own().filter(e=>['pending','paid'].includes(e.status));
  const entryDay=e=>financeDay(Date.parse(e.at));
  const weekStart=()=>{const next=nextThursday(state.day);if(next===state.day)return next;const d=new Date(next+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-7);return d.toISOString().slice(0,10);};
  const sumOf=rows=>rows.reduce((n,e)=>n+depositTotal(e),0);
  const qty=b=>Math.min(1000000,Math.max(0,Math.floor(Number(draft.quantities[b.id])||0)));
  const rawQty=b=>{const v=draft.quantities[b.id];return typeof v==='string'&&/^\d*$/.test(v)?v:String(qty(b));};
  const draftLines=()=>state.bands.filter(b=>b.price&&qty(b)>0).map(b=>({...b,quantity:qty(b),amount:b.price*qty(b)}));
  const draftTotal=()=>draftLines().reduce((n,l)=>n+l.amount,0);
  const share=(b,total)=>{const q=qty(b);return total&&b.price&&q?(b.price*q/total*100).toFixed(2):0;};
  const barHtml=total=>state.bands.map(b=>'<i style="--band:'+esc(b.color)+';--w:'+share(b,total)+'%"></i>').join('');
  const breakdownHtml=lines=>lines.length?lines.map(l=>'<span style="--band:'+esc(l.color)+'"><i></i>'+esc(l.name)+' <strong>'+l.quantity.toLocaleString()+'</strong></span>').join(''):'<span class="calc-hint">Step a band up or drop a screenshot to start counting.</span>';
  function animateMoney(el,from,to){
    if(el.calcFrame)cancelAnimationFrame(el.calcFrame);
    if(reduceMotion||from===to||Math.abs(to-from)>5000000000){el.textContent=money(to);return;}
    const start=performance.now(),duration=320;
    const step=t=>{const p=Math.min(1,(t-start)/duration),eased=1-Math.pow(1-p,3);el.textContent=money(p<1?Math.round((from+(to-from)*eased)/100)*100:to);if(p<1)el.calcFrame=requestAnimationFrame(step);};
    el.calcFrame=requestAnimationFrame(step);
  }
  function refreshTotals(){
    const lines=draftLines(),total=draftTotal();
    root.querySelectorAll('[data-finance-total]').forEach(el=>{const from=Number(el.dataset.cents);el.dataset.cents=total;if(el.classList.contains('calc-total'))el.classList.toggle('is-zero',!total);animateMoney(el,Number.isFinite(from)?from:total,total);});
    root.querySelectorAll('[data-calc-bar] i').forEach((seg,i)=>{const b=state.bands[i];if(b)seg.style.setProperty('--w',share(b,total)+'%');});
    const breakdown=root.querySelector('[data-calc-breakdown]');if(breakdown)breakdown.innerHTML=breakdownHtml(lines);
    for(const b of state.bands){const tile=root.querySelector('[data-calc-tile="'+CSS.escape(b.id)+'"]');if(!tile)continue;const q=qty(b),line=tile.querySelector('[data-calc-line]'),next=money(b.price*q);tile.classList.toggle('is-active',!!(b.price&&q));if(line.textContent!==next){line.textContent=next;if(!reduceMotion){line.classList.remove('is-bump');void line.offsetWidth;line.classList.add('is-bump');}}}
    root.querySelectorAll('[data-calc-save]').forEach(b=>b.disabled=!total||!!root.busy);
    root.querySelectorAll('[data-discard]').forEach(b=>b.disabled=!hasDraft()||!!root.busy);
    root.querySelector('[data-calc-hero]')?.classList.remove('is-saved');
  }
  function countRow(e){
    const when=new Date(e.at),today=financeDay(when.getTime())===state.day,label=(today?'Today':when.toLocaleDateString('en-US',{month:'short',day:'numeric'}))+' · '+when.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
    return '<article class="calc-row" data-receipt-id="'+esc(e.id)+'"><div><time datetime="'+esc(e.at)+'">'+esc(label)+'</time>'+(e.notes?'<span class="calc-row-note">'+esc(e.notes)+'</span>':'')+'<span class="calc-chips">'+e.lines.map(l=>'<span style="--band:'+esc(l.color)+'"><i></i>'+esc(l.name.replace(/ band$/i,''))+' <strong>'+l.quantity.toLocaleString()+'</strong></span>').join('')+'</span></div><div class="calc-row-amount"><strong>'+money(depositTotal(e))+'</strong>'+(e.status==='pending'&&!e.paidAmount?'<button type="button" class="text-button" data-remove="'+esc(e.id)+'">Remove</button>':'<small>Paid out</small>')+'</div></article>';
  }
  function heroHtml(){
    const rows=counted(),lines=draftLines(),total=draftTotal(),start=weekStart();
    const today=sumOf(rows.filter(e=>entryDay(e)===state.day)),week=sumOf(rows.filter(e=>entryDay(e)>=start)),all=sumOf(rows);
    return '<section class="calc-hero" data-calc-hero aria-label="Running total"><div class="calc-readout"><span class="calc-label">Counting now</span><strong class="calc-total'+(total?'':' is-zero')+'" data-finance-total data-cents="'+total+'">'+money(total)+'</strong><div class="calc-bar" data-calc-bar aria-hidden="true">'+barHtml(total)+'</div><p class="calc-breakdown" data-calc-breakdown>'+breakdownHtml(lines)+'</p></div><dl class="calc-totals"><div><dt>Today</dt><dd>'+money(today)+'</dd></div><div><dt>This week</dt><dd>'+money(week)+'</dd></div><div><dt>All time</dt><dd>'+money(all)+'</dd></div></dl></section>';
  }
  function countHtml(){
    const total=draftTotal();
    const tiles=state.bands.map((b,i)=>{const q=qty(b);return '<div class="calc-tile'+(b.price?(q?' is-active':''):' is-unpriced')+'" style="--band:'+esc(b.color)+';--i:'+i+'" data-calc-tile="'+esc(b.id)+'"><span class="calc-swatch" aria-hidden="true"></span><label for="finance-qty-'+esc(b.id)+'"><strong>'+esc(b.name)+'</strong><small>'+(b.price?money(b.price)+' each':state.owner?'<a href="#/settings">Set a value in Settings</a>':'No value set yet')+'</small></label><div class="quantity-stepper"><button type="button" data-quantity-step="-1" aria-label="One less '+esc(b.name)+'">−</button><input id="finance-qty-'+esc(b.id)+'" aria-label="'+esc(b.name)+' count" data-finance-quantity="'+esc(b.id)+'" type="number" min="0" max="1000000" step="1" inputmode="numeric" autocomplete="off" value="'+esc(rawQty(b))+'" '+(b.price?'':'disabled')+'><button type="button" data-quantity-step="1" aria-label="One more '+esc(b.name)+'">+</button></div><span class="calc-line-total" data-calc-line="'+esc(b.id)+'">'+money(b.price*q)+'</span></div>';}).join('');
    const saveButton='<button class="button primary" data-calc-save '+(total?'':'disabled')+'>Save count</button>';
    return '<section class="panel calc-count"><div class="calc-head"><div><h2>Count bands</h2><p>Step each band up or type the number. The total updates as you go.</p></div></div><form id="finance-deposit-form"><div class="calc-columns" aria-hidden="true"><span></span><span>Band</span><span>How many</span><span>Value</span></div><div class="calc-tiles">'+(tiles||'<p class="calc-empty"><strong>No bands set up yet.</strong>Add them in Settings and they show up here.</p>')+'</div><div class="calc-note"><label for="finance-note">Note (optional)</label><textarea id="finance-note" maxlength="2000" rows="1" placeholder="Where these came from…">'+esc(draft.notes)+'</textarea></div><div class="calc-save"><div class="calc-save-total"><span>Total</span><strong data-finance-total data-cents="'+total+'">'+money(total)+'</strong></div><div class="calc-save-actions"><button type="button" class="text-button" data-discard '+(hasDraft()?'':'disabled')+'>Clear</button>'+saveButton+'</div></div><p class="calc-status" data-draft-status>'+(hasDraft()?'Not saved yet. This count stays on this device for 24 hours.':'Saving adds this count to today, this week, and all time. Enter moves to the next band, Ctrl+Enter saves.')+'</p><div class="calc-sticky"><div class="calc-sticky-total"><span>Total</span><strong data-finance-total data-cents="'+total+'">'+money(total)+'</strong></div><div class="calc-sticky-actions"><button type="button" class="text-button" data-discard '+(hasDraft()?'':'disabled')+'>Clear</button>'+saveButton+'</div></div></form></section>';
  }
  function scanHtml(){
    return '<aside class="panel calc-scan"><div class="calc-head"><div><h2>Scan a screenshot</h2><p>Snip your inventory with <kbd>Win</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>, then paste it here. Bands and counts are read right on this device. More than one screenshot is fine.</p></div></div><label class="scan-zone" data-scan-zone><input type="file" accept="image/*" multiple data-scan-input hidden><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/></svg><strong>Drop a screenshot here</strong><small><kbd>Ctrl</kbd>+<kbd>V</kbd> anywhere on this page works too · or click to choose a file</small></label><div class="scan-actions"><button type="button" class="button secondary scan-paste" data-scan-paste><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>Paste screenshot</button></div><div class="scan-preview" data-scan-preview hidden><p class="scan-status" data-scan-status></p><div class="scan-shots" data-scan-shots></div><div class="scan-result" data-scan-result hidden></div><div class="scan-actions"><button type="button" class="text-button" data-scan-clear>Remove all</button></div></div></aside>';
  }
  function mathHtml(){
    return '<details class="panel calc-math" data-calc-math'+(mathOpen?' open':'')+'><summary><span class="calc-math-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01"/></svg></span><span><h2>Quick math</h2><p>A plain calculator for the odd sum. Nothing here is saved.</p></span><span class="calc-math-chevron" aria-hidden="true"></span></summary>'+quickMath.html()+'</details>';
  }
  function recentHtml(){
    const rows=counted();
    return '<section class="panel calc-recent"><div class="calc-head"><div><h2>Recent counts</h2><p>Every count you saved. Remove one if it was a mistake.</p></div></div><div class="calc-rows" data-transaction-results>'+(rows.length?rows.slice(0,limit).map(countRow).join(''):'<div class="calc-empty"><strong>Nothing counted yet.</strong>Save your first count and it shows up here.</div>')+'</div>'+(rows.length?'<div class="calc-recent-foot">'+(rows.length>limit?'<button type="button" class="button secondary" data-more>Show '+Math.min(20,rows.length-limit)+' more</button>':'')+'<button type="button" class="text-button" data-export>Export CSV</button></div>':'')+'</section>';
  }
  // Server data changed while the user is typing in the form: redraw everything except the form.
  function patchAroundForm(){
    const hero=root.querySelector('[data-calc-hero]'),recent=root.querySelector('.calc-recent');
    if(hero)hero.outerHTML=heroHtml();if(recent)recent.outerHTML=recentHtml();
    bindEntries();root.querySelector('[data-export]')?.addEventListener('click',exportCsv);
  }
  function ownPage(){
    const enter=entered?'':' calc-enter';entered=true;
    return '<div class="calc-page'+enter+'"><div class="page-heading"><div><span class="eyebrow">PTO</span><h1>Band calculator</h1><p>Count your bands, save the total, keep a running tally.</p></div></div>'+heroHtml()+'<div class="calc-workspace">'+countHtml()+'<div class="calc-side">'+scanHtml()+mathHtml()+recentHtml()+'</div></div></div>';
  }
  function growNote(note){note.style.height='auto';note.style.height=Math.min(220,note.scrollHeight)+'px';note.style.overflowY=note.scrollHeight>220?'auto':'hidden';}
  function bindQuantityFields(form){
    const fields=[...form.querySelectorAll('[data-finance-quantity]')];
    fields.forEach((input,index)=>{
      // Clicking in selects the whole number so typing replaces it (mouseup would otherwise drop the caret mid-number).
      let justFocused=false;
      input.addEventListener('focus',()=>{if(input.disabled)return;justFocused=true;input.select();setTimeout(()=>{justFocused=false;},250);});
      input.addEventListener('mouseup',e=>{if(justFocused){e.preventDefault();justFocused=false;}});
      input.addEventListener('wheel',()=>input.blur(),{passive:true});
      input.addEventListener('blur',()=>{const clean=String(Math.min(1000000,Math.max(0,Math.floor(Number(input.value)||0))));if(input.value!==clean){input.value=clean;input.dispatchEvent(new Event('input',{bubbles:true}));}});
      input.addEventListener('keydown',e=>{
        if(e.key!=='Enter')return;e.preventDefault();
        if(e.ctrlKey||e.metaKey){form.requestSubmit();return;}
        const next=fields.slice(index+1).find(f=>!f.disabled);next?next.focus():input.blur();
      });
    });
    // Hold a stepper button to keep counting.
    form.querySelectorAll('[data-quantity-step]').forEach(button=>{
      let delay,repeat,held=false;
      const stop=()=>{clearTimeout(delay);clearInterval(repeat);delay=repeat=null;};
      button.addEventListener('pointerdown',e=>{if(e.button!==0||button.disabled)return;held=false;stop();delay=setTimeout(()=>{repeat=setInterval(()=>{if(button.disabled){stop();return;}held=true;button.dispatchEvent(new CustomEvent('calc:step'));},70);},380);});
      for(const type of ['pointerup','pointerleave','pointercancel'])button.addEventListener(type,stop);
      button.addEventListener('click',e=>{if(held){held=false;e.stopImmediatePropagation();}},true);
    });
  }
  function legacyOwnPage(){
    const entries=own(),owed=outstanding(entries),pending=entries.filter(e=>e.status==='pending'),total=state.bands.reduce((n,b)=>n+b.price*(Number(draft.quantities[b.id])||0),0);
    const navigation='<nav class="tabs finance-nav" aria-label="My stash sections">'+[['add','Add bands'],['pending','Unpaid deposits'+(pending.length?' ('+pending.length+')':'')],['history','History']].map(([id,label])=>'<button data-own-tab="'+id+'" aria-pressed="'+(history===id)+'" class="'+(history===id?'selected':'')+'">'+label+'</button>').join('')+'</nav>';
    const form='<section class="panel finance-form-panel"><div class="finance-section-head"><div><h2>Record a deposit</h2><p>Enter the bands you placed in the stash. Your total updates as you type.</p></div></div><form id="finance-deposit-form"><div class="band-entry-heading"><span>Band / value each</span><span>Quantity</span></div><div class="band-entry-grid">'+state.bands.map(b=>'<div class="band-tile" style="--band:'+esc(b.color)+'"><span class="band-marker" aria-hidden="true"></span><label class="finance-band-name" for="finance-qty-'+esc(b.id)+'"><strong>'+esc(b.name)+'</strong><small>'+ (b.price?money(b.price)+' each':'Rate not set')+'</small></label><div class="quantity-stepper"><button type="button" data-quantity-step="-1" aria-label="Decrease '+esc(b.name)+' quantity">−</button><input id="finance-qty-'+esc(b.id)+'" aria-label="'+esc(b.name)+' quantity" data-finance-quantity="'+esc(b.id)+'" type="number" min="0" max="1000000" step="1" inputmode="numeric" value="'+esc(draft.quantities[b.id]||0)+'" '+(b.price?'':'disabled')+'><button type="button" data-quantity-step="1" aria-label="Increase '+esc(b.name)+' quantity">+</button></div></div>').join('')+'</div>'+
      '<label for="finance-note">Note (optional)</label><textarea id="finance-note" maxlength="2000" rows="2" placeholder="Where you left the bands…">'+esc(draft.notes)+'</textarea><div class="deposit-save-bar"><div><span>Deposit value</span><strong data-finance-total>'+money(total)+'</strong></div><button class="button primary">Save deposit</button></div><p class="draft-status" data-draft-status>'+(hasDraft()?'Draft saved on this device for 24 hours. Not submitted yet.':'Your draft saves on this device as you type.')+'</p><details class="finance-draft-options"><summary>Draft options</summary><div class="form-secondary-actions"><button type="button" class="text-button" data-refresh-rates>Refresh rates & review total</button><button type="button" class="text-button" data-discard>Discard draft</button></div></details></form></section>';
    const receipts='<section class="panel finance-history"><div class="finance-section-head"><div><h2>'+(history==='pending'?'Your unpaid deposits':'Your deposit history')+'</h2><p>'+(history==='pending'?'These deposits have an unpaid balance.':'Paid, withdrawn, and rejected deposits. Open a receipt for details.')+'</p></div></div>'+(history==='pending'&&pending.length?'<details class="finance-band-summary"><summary>View unpaid band quantities</summary>'+bandStrip(pending)+(pending.some(e=>e.paidAmount)?'<p class="finance-help">Quantities are the original deposit contents. A partial payment reduces money owed, not band counts.</p>':'')+'</details>':'')+historyControls()+(entries.filter(e=>history==='pending'?e.status==='pending':e.status!=='pending').length?list(entries.filter(e=>history==='pending'?e.status==='pending':e.status!=='pending')):'<div data-transaction-results class="finance-empty"><h3>'+(history==='pending'?'No unpaid deposits.':'No past deposits yet.')+'</h3><p>'+(history==='pending'?'Save a deposit from Add bands to start tracking it.':'Completed and corrected deposits will appear here.')+'</p></div>')+'</section>';
    return '<div class="page-heading"><div><span class="eyebrow">YOUR FINANCES</span><h1>My stash</h1><p>Record your bands and see what you are owed.</p></div>'+'</div>'+
      '<section class="stash-topline"><div><span>Owed to you</span><strong>'+money(owed)+'</strong></div><div><span>Paid to you</span><strong>'+money(totalPaid())+'</strong></div><p>'+esc(state.user.name)+'<br>State ID '+esc(state.user.stateId||'not set')+'</p></section>'+navigation+
      '<div class="stash-workspace">'+(history==='add'?form+'<aside class="stash-guide"><h2>From stash to payment</h2><ol><li><strong>Save your deposit</strong><p>Record the bands you put in the stash.</p></li><li><strong>'+(state.requireVerification?'Staff verify your bands':'Your balance updates')+'</strong><p>'+(state.requireVerification?'A finance manager checks the quantities before payout.':'Your deposit is added to the amount owed to you.')+'</p></li><li><strong>Get paid in game</strong><p>Once staff record your payment, your balance updates and the receipt shows who paid you.</p></li></ol><p class="finance-help">Your amounts are visible to you and authorized finance staff.</p></aside>':receipts)+'</div>';
  }
  function ledgerPage(){
    const pending=state.deposits.filter(e=>e.status==='pending'),groups=[...new Set(pending.map(e=>e.userId))].map(id=>({id,entries:pending.filter(e=>e.userId===id)})),next=nextThursday(state.day),current=state.bills.filter(b=>b.dueDate===next),due=state.bills.filter(b=>b.status==='due'||b.status==='overdue'),remaining=state.bills.filter(b=>b.status!=='paid').reduce((n,b)=>n+b.amount,0),weekly=current.reduce((n,b)=>n+b.amount,0),paid=current.filter(b=>b.status==='paid').reduce((n,b)=>n+b.amount,0);
    let content='';
    if(tab==='payouts'){
      const visible=groups.filter(g=>!filter||[g.entries[0].name,identity(g.entries[0])].join(' ').toLowerCase().includes(filter.toLowerCase()));
      content='<section class="panel"><div class="finance-section-head"><div><h2>Pay members</h2><p>'+groups.length+' member'+(groups.length===1?' is':'s are')+' waiting for payment. Record payments after paying in game.</p></div></div><label class="queue-search">Find a member<input data-queue-search type="search" placeholder="Name or State ID…" value="'+esc(filter)+'"></label>'+visible.map(g=>{
        const e=g.entries[0],owed=outstanding(g.entries),unverified=g.entries.some(e=>e.requiresVerification&&!e.verified);
        return '<article class="payout-row"><div class="payout-overview"><div class="payout-identity"><span class="finance-avatar">'+esc(e.name.split(' ').map(n=>n[0]).slice(0,2).join(''))+'</span><div><h3>'+esc(e.name)+'</h3><small>'+esc(identity(e))+'</small><small>'+g.entries.length+' unpaid deposit'+(g.entries.length===1?'':'s')+(unverified?' · Verification needed':'')+'</small></div></div><div class="payout-amount"><span>Owed</span><strong>'+money(owed)+'</strong></div>'+(state.canManage?(g.id===memberId&&!session.user.owner?'<span class="payout-note">Another manager must record your payment.</span>':unverified?'<span class="payout-note">Verify the deposits below before payment.</span>':'<button class="button primary" data-pay="'+esc(g.id)+'">Record payment</button>'):'')+'</div><details class="payout-receipts"><summary>View deposits'+(unverified?' & verify bands':'')+'</summary>'+bandStrip(g.entries)+(g.entries.some(e=>e.paidAmount)?'<p class="finance-help">Quantities show original contents; the balance accounts for partial payments.</p>':'')+g.entries.map(e=>entry(e,true)).join('')+'</details></article>';
      }).join('')+(!visible.length?'<div class="finance-empty"><h3>'+(groups.length?'No matching members.':'All member payments are up to date.')+'</h3><p>'+(groups.length?'Try another name or State ID.':'New deposits will appear here when members save them.')+'</p></div>':'')+'</section>';
    }
    if(tab==='transactions')content='<section class="panel"><div class="finance-section-head"><div><h2>Deposit history</h2><p>All member deposits and their payment receipts. Open a record to see its details.</p></div></div>'+historyControls()+list(state.deposits,true)+'</section>';
    if(tab==='bills')content='<section class="panel"><h2>Weekly bills</h2><p>Gang taxes, due Thursdays in Central time. Tracking from '+esc(dayLabel(state.startDate))+'</p><div class="bill-progress"><span>Next Thursday · '+esc(dayLabel(next))+'<strong>'+money(weekly)+'</strong></span><span>Paid toward next Thursday <strong>'+money(paid)+'</strong></span><span>Remaining for next Thursday <strong>'+money(weekly-paid)+'</strong></span></div>'+state.bills.filter(b=>b.status!=='paid').map(b=>'<div class="finance-bill"><div><strong>'+esc(b.name)+'</strong><small>'+esc(dayLabel(b.dueDate))+' · '+esc(b.status)+'</small></div><strong>'+money(b.amount)+'</strong>'+(state.canManage?'<button class="button secondary" data-bill="'+esc(b.kind)+'" data-due="'+b.dueDate+'">Confirm paid</button>':'')+'</div>').join('')+'<details class="finance-bill-history"><summary>View past bill payments ('+state.billPayments.length+')</summary>'+(state.billPayments||[]).map(b=>'<div class="finance-bill"><div><strong>'+esc(b.kind==='house'?'Gang house':'Gang taxes')+' · '+money(b.amount)+'</strong><small>For '+esc(dayLabel(b.dueDate))+' · '+esc(b.byName)+' · '+esc(timestamp(b.at))+'</small>'+(b.reversal?'<small>Reversed: '+esc(b.reversal.reason)+'</small>':'')+'</div>'+(state.owner&&!b.reversal?'<button class="text-button" data-reverse="'+esc(b.id)+'" data-kind="bill">Correct payment</button>':'')+'</div>').join('')+'</details></section>';
    if(tab==='cash')content='<section class="panel"><h2>Gang cashbook</h2><p>Band submissions do not add cash. Record income when money is received. Confirmed payouts and bills subtract cash after the opening balance is set.</p>'+(state.cashEnabled?'<div class="bill-progress"><span>Cash recorded<strong>'+money(state.cashBalance)+'</strong></span><span>After bills & member balances<strong>'+money(state.cashBalance-remaining-outstanding(pending))+'</strong></span></div>':'<p class="notice">The Owner needs to enter the current cash balance to start tracking. Earlier payments will not be deducted again.</p>')+
      (state.canManage&&(state.cashEnabled||state.owner)?'<form id="cash-form" class="stack-form"><label>Entry type<select name="kind">'+(state.cashEnabled?'<option value="income">Cash received</option><option value="expense">Other expense</option>'+(state.owner?'<option value="reconcile">Reconcile to actual balance</option>':''):'<option value="opening">Opening cash balance</option>')+'</select></label><label>Amount<input name="amount" type="number" min="0" step="0.01" required></label><label>Reason / source<input name="reason" maxlength="500" required></label><button class="button primary">Review cash entry</button></form>':'')+
      '<h3 class="section-gap">Cash history</h3><button class="button secondary" data-cash-export>Export cash CSV</button>'+state.cashEntries.slice(0,limit).map(e=>'<div class="cash-row"><div><strong>'+esc(e.reason)+'</strong><small>'+esc(e.kind)+' · '+esc(e.byName)+' · '+esc(timestamp(e.at))+'</small>'+(e.reversal?'<small>Reversed: '+esc(e.reversal.reason)+'</small>':'')+'</div><strong>'+money(e.amount)+'</strong>'+(state.owner&&!e.reversal&&['income','expense','reconcile'].includes(e.kind)?'<button class="text-button" data-reverse="'+esc(e.id)+'" data-kind="cash">Correct</button>':'')+'</div>').join('')+(state.cashEntries.length>limit?'<button data-more class="button secondary">Load 20 more</button>':'')+'</section>';
    if(tab==='settings'&&state.owner)content='<section class="panel"><h2>Finance settings</h2><form id="finance-settings-form" class="stack-form"><label class="check-line"><input name="verification" type="checkbox" '+(state.requireVerification?'checked':'')+'> Require verification for new deposits</label><p>Existing deposits keep their original requirement. Verified bands still need a separate payment confirmation.</p><label>Tracking starts Thursday<input name="startDate" type="date" value="'+state.startDate+'" '+(state.deposits.length||state.billPayments.length?'disabled':'')+'></label><details class="finance-tax-schedule"><summary>Change a future weekly tax amount</summary><label>Effective Thursday<input name="effectiveDate" type="date" min="'+next+'"></label><label>Gang taxes<input name="taxes" type="number" min="0" step="0.01" value="'+((current.find(b=>b.kind==='taxes')?.amount??500000)/100)+'"></label></details><button class="button primary">Save finance settings</button></form><h3 class="section-gap">Scheduled amounts</h3>'+state.schedules.map(s=>'<p>From '+esc(dayLabel(s.effectiveDate))+': taxes '+money(s.taxes)+'</p>').join('')+
      '</section>';
    if(mode==='settings')return state.owner?content:'';
    return '<div class="page-heading"><div><span class="eyebrow">GANG FINANCES</span><h1>Treasury</h1><p>Pay members, keep bills current, and track gang cash.</p></div><div class="finance-heading-actions">'+(state.owner?'<button class="text-button icon-label" data-settings-section="finance">'+uiIcon('settings')+'Finance settings</button>':'')+'</div></div><section class="treasury-metrics"><div><span>Owed to members</span><strong>'+money(outstanding(pending))+'</strong><small>'+groups.length+' member'+(groups.length===1?'':'s')+' awaiting payment</small></div><div><span>Bills due now</span><strong>'+money(due.reduce((n,b)=>n+b.amount,0))+'</strong><small>'+(due.length?due.length+' unpaid bill'+(due.length===1?'':'s'):'No due or overdue bills')+'</small></div><div><span>Gang cash on hand</span><strong>'+(state.cashEnabled?money(state.cashBalance):'Not set up')+'</strong><small>'+(state.cashEnabled?'Recorded in the gang cashbook':'Optional · set up in Gang cash')+'</small></div></section><nav class="tabs treasury-tabs finance-nav" aria-label="Treasury sections">'+[['payouts','Pay members'],['bills','Weekly bills'],['transactions','Deposit history'],['cash','Gang cash']].map(([id,label])=>'<button data-treasury-tab="'+id+'" aria-pressed="'+(tab===id)+'" class="'+(tab===id?'selected':'')+'">'+label+'</button>').join('')+'</nav>'+content;
  }
  function confirmation(){
    if(!confirm)return '';const c=confirm;
    return '<section class="finance-confirm panel" aria-label="Review finance action"><h2>'+esc(c.title)+'</h2><p>'+esc(c.description)+'</p><form id="finance-confirm-form">'+(c.amount?'<label>Payment amount<input name="amount" type="number" min="0.01" step="0.01" max="'+c.amount/100+'" value="'+c.amount/100+'" required></label><p>You may pay part of the balance. Payments apply to the oldest outstanding deposits first.</p>':'')+(c.reason?'<label>Reason<textarea name="reason" required maxlength="500"></textarea></label>':'')+'<p>'+esc(c.note||'This records an action taken in game. Review before confirming.')+'</p><div class="finance-confirm-actions"><button class="button primary">Confirm '+esc(c.verb||'change')+'</button><button type="button" class="button secondary" data-cancel>Cancel</button><button type="button" class="text-button" data-refresh-confirm>Refresh current records</button></div></form></section>';
  }
  function showConfirm(c){confirm=c;root.querySelector('[data-finance-confirm]').innerHTML=confirmation();bindConfirm();root.querySelector('[data-finance-confirm]').scrollIntoView({block:'nearest'});root.querySelector('#finance-confirm-form input,#finance-confirm-form textarea,#finance-confirm-form button')?.focus();}
  function bindConfirm(){
    root.querySelector('[data-cancel]')?.addEventListener('click',()=>{confirm=null;onClean();render();});
    root.querySelector('[data-refresh-confirm]')?.addEventListener('click',async()=>{confirm=null;onClean();try{state=await request('/api/finance');seen();message='Records refreshed. Select the action again to review the current amounts.';render();}catch(e){error(e);}});
    root.querySelector('#finance-confirm-form')?.addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget,c=confirm;save(c.path,{...c.body,...(c.amount?{amount:Math.round(Number(form.elements.amount.value)*100)}:{}),...(c.reason?{reason:form.elements.reason.value}:{})});});
  }
  function render(){if(!root.isConnected)return;root.innerHTML='<div class="notice" data-finance-message role="status" '+(message?'':'hidden')+'>'+esc(message)+'</div><div data-finance-confirm>'+confirmation()+'</div>'+(mode==='bands'?ownPage():ledgerPage());bind();bindConfirm();}
  function refreshList(){const rows=mode==='bands'?own().filter(e=>history==='pending'?e.status==='pending':e.status!=='pending'):state.deposits;root.querySelector('[data-transaction-results]').outerHTML=list(rows,mode!=='bands');bindEntries();}
  function bindEntries(){
    root.querySelectorAll('[data-reverse]').forEach(b=>b.onclick=()=>showConfirm({title:'Correct recorded '+b.dataset.kind,description:'The original record remains in history. A reversal restores the outstanding amount and adjusts linked cash entries.',reason:true,path:'/api/finance/reversals',body:{requestId:crypto.randomUUID(),recordId:b.dataset.reverse,kind:b.dataset.kind,revision:state.revision},verb:'reversal'}));
    for(const [attr,decision,title] of [['data-withdraw','withdraw','Withdraw this deposit'],['data-reject','reject','Reject this deposit'],['data-verify','verify','Verify received bands']])root.querySelectorAll('['+attr+']').forEach(b=>b.onclick=()=>{const e=state.deposits.find(e=>e.id===b.getAttribute(attr));showConfirm({title,description:e.name+' · '+money(depositTotal(e)),reason:decision!=='verify',path:'/api/finance/deposits/'+e.id,body:{decision},verb:decision,note:decision==='verify'?'Confirm you have checked the quantities. This does not record a payment.':'The original deposit and reason remain in history.'});});
    root.querySelectorAll('[data-copy]').forEach(b=>b.onclick=()=>{if(hasDraft()){error(Error('Discard or save your current draft before copying another deposit.'));return;}const e=state.deposits.find(e=>e.id===b.dataset.copy);draft={quantities:Object.fromEntries(e.lines.filter(l=>state.bands.some(b=>b.id===l.id)).map(l=>[l.id,l.quantity])),notes:e.notes,requestId:crypto.randomUUID()};history='add';saveDraft(memberId,draft);message='Quantities copied into a new draft at current rates. Review before submitting.';render();root.querySelector('#finance-deposit-form')?.scrollIntoView({block:'start'});});
    root.querySelectorAll('[data-more]').forEach(b=>b.onclick=()=>{limit+=20;mode==='bands'||tab==='cash'?render():refreshList();});
    root.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{const e=state.deposits.find(e=>e.id===b.dataset.remove);if(!e)return;showConfirm({title:'Remove this count',description:money(depositTotal(e))+' · '+e.lines.map(l=>l.name+' × '+l.quantity).join(', '),path:'/api/finance/deposits/'+e.id,body:{decision:'withdraw',reason:'Removed from the calculator'},verb:'removal',note:'It comes off your totals right away. Treasury history keeps a withdrawn record.'});});
  }
  async function thumbnail(file,max=420){
    const bitmap=await createImageBitmap(file);
    const scale=Math.min(1,max/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    return canvas.toDataURL('image/jpeg',.82);
  }
  function bindScan(){
    const zone=root.querySelector('[data-scan-zone]');if(!zone)return;
    const input=zone.querySelector('[data-scan-input]'),preview=root.querySelector('[data-scan-preview]'),strip=root.querySelector('[data-scan-shots]'),status=root.querySelector('[data-scan-status]'),paste=root.querySelector('[data-scan-paste]');
    const MAX_SHOTS=10,result=root.querySelector('[data-scan-result]');
    const say=text=>{if(shots.length){status.textContent=text;status.classList.add('is-warn');}else error(Error(text));};
    const plural=(n,word)=>n+' '+word+(n===1?'':'s');
    // Totals per band across every screenshot that has been read.
    const found=()=>{
      const totals=new Map();
      for(const s of shots)for(const it of s.scan?.items||[]){const t=totals.get(it.bandId)||{bandId:it.bandId,name:it.name,qty:0,shots:new Set(),unsure:0,unknown:0};if(it.qty===null)t.unknown++;else{t.qty+=it.qty;if(!it.sure)t.unsure++;}t.shots.add(s.id);totals.set(it.bandId,t);}
      return state.bands.filter(b=>totals.has(b.id)).map(b=>({...totals.get(b.id),color:b.color,priced:!!b.price}));
    };
    const others=()=>{const seen=new Set();return shots.flatMap(s=>s.scan?.others||[]).filter(t=>{const k=t.toLowerCase();if(seen.has(k))return false;seen.add(k);return true;});};
    const resultHtml=()=>{
      const busy=shots.filter(s=>s.scan?.busy).length,done=shots.filter(s=>s.scan&&!s.scan.busy),rows=found(),extra=others();
      if(!done.length)return '';
      const chips=rows.map(r=>'<li style="--band:'+esc(r.color)+'"'+(r.unknown||r.unsure?' class="is-unsure"':'')+'><i></i><span>'+esc(r.name.replace(/ band$/i,''))+'</span><strong>'+(r.unknown&&!r.qty?'?':'×'+r.qty.toLocaleString())+'</strong>'+(r.unknown?'<small>'+plural(r.unknown,'count')+' not readable</small>':r.unsure?'<small>double-check this one</small>':r.shots.size>1?'<small>'+plural(r.shots.size,'screenshot')+'</small>':'')+'</li>').join('');
      const errors=done.filter(s=>s.scan.error).map(s=>'Screenshot '+(shots.indexOf(s)+1)+': '+s.scan.error);
      const summary=(rows.length?'Found '+plural(rows.length,'band')+' in '+plural(done.length,'screenshot'):'No bands spotted'+(busy?' yet':'')+' in '+plural(done.length,'screenshot'))+(busy?', still reading '+busy+' more':'')+'.';
      return '<p class="scan-summary">'+esc(summary)+'</p>'+(errors.length?'<p class="scan-status is-warn">'+esc(errors.join(' '))+'</p>':'')
        +(rows.length?'<ul class="scan-found">'+chips+'</ul><div class="scan-actions"><button type="button" class="button primary" data-scan-fill'+(rows.some(r=>r.qty&&r.priced)?'':' disabled')+'>Fill in counts</button><small>Each screenshot adds up, so paste each pocket once.</small></div>':'')
        +(extra.length?'<details class="scan-others"'+(scanOthersOpen?' open':'')+'><summary>Other items read ('+extra.length+')</summary><p>Is one of these a band under another name? Tap it and pick the band. This device remembers the match.</p><div class="scan-chips">'+extra.map(t=>'<button type="button" data-scan-other="'+esc(t)+'">'+esc(t)+'</button>').join('')+'</div><div class="scan-teach" data-scan-teach hidden></div></details>':'');
    };
    const fillCounts=()=>{
      const form=root.querySelector('#finance-deposit-form');if(!form)return;
      let filled=0;const skipped=[];
      for(const r of found()){
        const input=form.querySelector('[data-finance-quantity="'+CSS.escape(r.bandId)+'"]');
        if(!input||input.disabled){skipped.push(r.name);continue;}
        if(!r.qty)continue;
        input.value=String(r.qty);filled++;
        const tile=input.closest('.calc-tile');if(tile){tile.classList.remove('is-filled');void tile.offsetWidth;tile.classList.add('is-filled');tile.addEventListener('animationend',()=>tile.classList.remove('is-filled'),{once:true});}
      }
      form.dispatchEvent(new Event('input',{bubbles:true}));
      const st=root.querySelector('[data-draft-status]');if(st)st.textContent=filled?'Counts filled in from your screenshots. Check them, then save.'+(skipped.length?' Skipped '+skipped.join(', ')+': no value set.':''):'Nothing to fill in yet.';
      form.scrollIntoView({block:'start',behavior:reduceMotion?'auto':'smooth'});
      form.querySelector('.calc-tile.is-filled input')?.focus({preventScroll:true});
    };
    const bindResults=()=>{
      result.querySelector('[data-scan-fill]')?.addEventListener('click',fillCounts);
      result.querySelector('.scan-others')?.addEventListener('toggle',e=>{scanOthersOpen=e.currentTarget.open;});
      const teach=result.querySelector('[data-scan-teach]');
      result.querySelectorAll('[data-scan-other]').forEach(b=>b.addEventListener('click',()=>{
        const text=b.dataset.scanOther;
        result.querySelectorAll('[data-scan-other]').forEach(x=>x.classList.toggle('is-picked',x===b));
        teach.hidden=false;teach.innerHTML='<label><span>“'+esc(text)+'” is</span><select data-scan-alias><option value="">Pick a band…</option>'+state.bands.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('')+'</select></label>';
        const select=teach.querySelector('select');select.focus();
        select.addEventListener('change',()=>{if(!select.value)return;saveAlias(text,select.value);for(const s of shots)if(s.scan?.others?.some(o=>o.toLowerCase()===text.toLowerCase()))s.scan=undefined;queueScan();});
      }));
    };
    const renderShots=(fresh)=>{
      preview.hidden=!shots.length;status.classList.remove('is-warn');
      const kb=Math.round(shots.reduce((n,s)=>n+s.size,0)/1024),busy=shots.some(s=>s.scan?.busy);
      status.textContent=shots.length?(busy?scanProgress||'Reading…':plural(shots.length,'screenshot')+' · '+(kb>1024?(kb/1024).toFixed(1)+' MB':kb+' KB')):'';
      status.classList.toggle('is-busy',busy);
      strip.innerHTML=shots.map((s,i)=>'<figure class="scan-shot'+(s.id===fresh?' is-new':'')+(s.scan?.busy?' is-reading':'')+'" data-shot="'+s.id+'"><img src="'+s.src+'" alt="Screenshot '+(i+1)+'" decoding="async"><figcaption>'+(i+1)+'</figcaption><button type="button" data-shot-remove="'+s.id+'" aria-label="Remove screenshot '+(i+1)+'">×</button></figure>').join('');
      strip.querySelectorAll('[data-shot-remove]').forEach(b=>b.addEventListener('click',()=>{shots=shots.filter(s=>s.id!==b.dataset.shotRemove);renderShots();}));
      result.innerHTML=resultHtml();result.hidden=!result.innerHTML;bindResults();
    };
    renderScan=renderShots;
    // One screenshot at a time through the reader; results land as each finishes.
    const queueScan=()=>{
      for(const s of shots)if(!s.scan)s.scan={busy:true};
      renderShots();
      if(scanQueue)return;
      scanQueue=(async()=>{
        for(;;){
          const s=shots.find(x=>x.scan?.busy);if(!s)break;
          const label=()=>'Screenshot '+(shots.indexOf(s)+1)+' of '+shots.length;
          scanProgress=label()+': reading…';renderScan?.();
          try{
            const r=await scanImage(s.file,state.bands,{onProgress:p=>{scanProgress=p.phase==='load'?p.text:label()+': '+p.text;const st=root.querySelector('[data-scan-status]');if(st&&st.classList.contains('is-busy'))st.textContent=scanProgress;}});
            s.scan=r;
          }catch(e){s.scan={error:e?.message||'Could not read this screenshot.'};}
          renderScan?.();
        }
        scanProgress='';
      })().finally(()=>{scanQueue=null;renderScan?.();});
    };
    const load=files=>{
      for(const file of [...files]){
        if(!file||!file.type.startsWith('image/')){say('That is not an image. Paste or drop a PNG or JPG screenshot.');continue;}
        if(file.size>12*1024*1024){say('That screenshot is over 12 MB. Crop it or use a smaller one.');continue;}
        if(shots.length>=MAX_SHOTS){say('That is '+MAX_SHOTS+' screenshots already. Remove one to add another.');break;}
        // Keep the original file for detection later; only a small thumbnail is drawn on the page.
        thumbnail(file).then(src=>{const id=crypto.randomUUID();shots.push({id,src,file,name:file.name||'pasted.png',size:file.size,at:Date.now()});renderShots(id);queueScan();}).catch(()=>say('That image could not be read. Try a PNG or JPG screenshot.'));
      }
    };
    renderShots();
    input.addEventListener('change',()=>{load(input.files);input.value='';});
    for(const type of ['dragenter','dragover'])zone.addEventListener(type,e=>{e.preventDefault();zone.classList.add('is-over');});
    for(const type of ['dragleave','drop'])zone.addEventListener(type,e=>{e.preventDefault();zone.classList.remove('is-over');});
    zone.addEventListener('drop',e=>load(e.dataTransfer.files));
    root.querySelector('[data-scan-clear]')?.addEventListener('click',()=>{shots=[];renderShots();});
    paste?.addEventListener('click',async()=>{
      if(!navigator.clipboard?.read){say('This browser cannot read the clipboard from a button. Press Ctrl+V on the page instead.');return;}
      try{
        const items=await navigator.clipboard.read();
        const files=[];
        for(const item of items){const type=item.types.find(t=>t.startsWith('image/'));if(type)files.push(new File([await item.getType(type)],'pasted.png',{type}));}
        if(!files.length){say('Nothing on the clipboard is an image yet. Snip your inventory with Win+Shift+S, then try again.');return;}
        load(files);
      }catch(e){say(e.name==='NotAllowedError'?'Clipboard access was blocked. Allow it in the address bar, or press Ctrl+V on the page instead.':e.message);}
    });
    if(root.pasteHandler)document.removeEventListener('paste',root.pasteHandler);
    root.pasteHandler=e=>{if(!root.isConnected){document.removeEventListener('paste',root.pasteHandler);return;}const files=[...(e.clipboardData?.items||[])].filter(i=>i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);if(files.length){e.preventDefault();load(files);zone.scrollIntoView({block:'nearest',behavior:reduceMotion?'auto':'smooth'});}};
    document.addEventListener('paste',root.pasteHandler);
  }
  function exportCsv(){const rows=filtered(mode==='bands'?counted():state.deposits);downloadCsv('pto-transactions-'+state.day+'.csv',[['Reference','Member','State ID','Submitted','Status','Original value','Paid','Remaining','Note','Review reason'],...rows.map(e=>[e.id,e.name,e.identity?.stateId,e.at,e.status,depositTotal(e)/100,e.paidAmount/100,e.remaining/100,e.notes,e.reason])]);}
  function syncQuantityButtons(){
    root.querySelectorAll('[data-quantity-step]').forEach(button=>{
      const input=button.closest('.quantity-stepper').querySelector('input'),value=Number(input.value)||0;
      button.disabled=root.busy||input.disabled||(Number(button.dataset.quantityStep)<0?value<=Number(input.min):value>=Number(input.max));
    });
  }
  function bind(){
    const form=root.querySelector('#finance-deposit-form');
    syncQuantityButtons();
    form?.addEventListener('input',syncQuantityButtons);
    root.querySelectorAll('[data-quantity-step]').forEach(button=>{const step=()=>{
      const input=button.closest('.quantity-stepper').querySelector('input');
      if(input.disabled||root.busy)return;
      if(!input.value||!Number.isFinite(Number(input.value)))input.value='0';
      Number(button.dataset.quantityStep)>0?input.stepUp():input.stepDown();
      input.dispatchEvent(new Event('input',{bubbles:true}));
    };button.addEventListener('click',step);button.addEventListener('calc:step',step);});
    if(form&&mode==='bands')bindQuantityFields(form);
    form?.addEventListener('input',()=>{draft.quantities=Object.fromEntries([...form.querySelectorAll('[data-finance-quantity]')].map(i=>[i.dataset.financeQuantity,i.value]));draft.notes=form.querySelector('#finance-note').value;draftStored=saveDraft(memberId,draft);const status=root.querySelector('[data-draft-status]');status.classList.remove('is-saved');status.textContent=draftStored?'Not saved yet. This count stays on this device for 24 hours.':'Not saved yet. This count lives in this tab only; device storage is unavailable.';refreshTotals();onClean();});
    form?.addEventListener('submit',e=>{e.preventDefault();const lines=state.bands.filter(b=>qty(b)>0).map(b=>({id:b.id,quantity:qty(b)}));if(!lines.length){error(Error('Count at least one band first.'));return;}save('/api/finance/deposits',{requestId:draft.requestId,ratesVersion:state.ratesVersion,lines,notes:draft.notes});});
    root.querySelectorAll('[data-discard]').forEach(b=>b.addEventListener('click',()=>{clearDraft(memberId);draft={quantities:{},notes:'',requestId:crypto.randomUUID()};onClean();message='';render();}));
    const note=form?.querySelector('#finance-note');if(note&&mode==='bands'){growNote(note);note.addEventListener('input',()=>growNote(note));}
    bindScan();
    const math=root.querySelector('[data-calc-math]');if(math){quickMath.bind(math);math.addEventListener('toggle',()=>{mathOpen=math.open;saveUiPreference(sectionKey('math'),mathOpen?'open':'closed');if(math.open)math.querySelector('[data-quick-math]')?.focus({preventScroll:true});});}
    root.querySelector('[data-refresh-rates]')?.addEventListener('click',async()=>{try{const before=state.bands.reduce((n,b)=>n+b.price*(Number(draft.quantities[b.id])||0),0);state=await request('/api/finance');seen();draft.quantities=Object.fromEntries(Object.entries(draft.quantities).filter(([id])=>state.bands.some(b=>b.id===id&&b.price)));saveDraft(memberId,draft);onClean();const after=state.bands.reduce((n,b)=>n+b.price*(Number(draft.quantities[b.id])||0),0);message='Rates refreshed: '+money(before)+' → '+money(after)+'. Quantities for unavailable bands were removed. Review and save when ready.';render();}catch(e){error(e);}});
    root.querySelectorAll('[data-own-tab]').forEach(b=>b.onclick=()=>{history=b.dataset.ownTab;saveUiPreference(sectionKey('stash'),history);filter='';statusFilter='all';from='';to='';filtersOpen=false;limit=20;confirm=null;render();root.querySelector('[data-own-tab="'+history+'"]')?.focus({preventScroll:true});revealContent(root.querySelector('.stash-workspace'));});
    root.querySelectorAll('[data-treasury-tab]').forEach(b=>b.onclick=()=>{if(!canRefresh()&&!confirm){error(Error('Save or discard the form before switching sections.'));return;}tab=b.dataset.treasuryTab;saveUiPreference(sectionKey('treasury'),tab);filter='';statusFilter='all';from='';to='';filtersOpen=false;limit=20;confirm=null;onClean();render();root.querySelector('[data-treasury-tab="'+tab+'"]')?.focus({preventScroll:true});revealContent(root.querySelector('.treasury-tabs')?.nextElementSibling);});
    root.querySelector('.finance-filters')?.addEventListener('toggle',e=>{if(e.currentTarget.isConnected)filtersOpen=e.currentTarget.open;});
    root.querySelector('[data-clear-filters]')?.addEventListener('click',()=>{filter='';statusFilter='all';from='';to='';limit=20;filtersOpen=true;render();root.querySelector('[data-history-search]')?.focus();});
    for(const [key,set] of [['search',v=>filter=v],['status',v=>statusFilter=v],['from',v=>from=v],['to',v=>to=v]])root.querySelector('[data-history-'+key+']')?.addEventListener(key==='search'?'input':'change',e=>{set(e.target.value);limit=20;refreshList();});
    root.querySelector('[data-queue-search]')?.addEventListener('input',e=>{filter=e.target.value;const pos=e.target.selectionStart;render();const input=root.querySelector('[data-queue-search]');input.focus();input.setSelectionRange(pos,pos);});
    root.querySelector('[data-cash-export]')?.addEventListener('click',()=>downloadCsv('pto-cashbook-'+state.day+'.csv',[['Reference','Date','Type','Amount','Recorded by','Reason','Reversed'],...state.cashEntries.map(e=>[e.id,e.at,e.kind,e.amount/100,e.byName,e.reason,e.reversal?'Yes':'No'])]));
    root.querySelector('[data-export]')?.addEventListener('click',exportCsv);
    root.querySelectorAll('[data-pay]').forEach(b=>b.onclick=()=>{const entries=state.deposits.filter(e=>e.userId===b.dataset.pay&&e.status==='pending'),owed=outstanding(entries);showConfirm({title:'Record member payment',description:entries[0].name+' · '+identity(entries[0])+(entries[0].identity?.phone?' · Phone '+entries[0].identity.phone:'')+' · '+money(owed)+' outstanding',amount:owed,path:'/api/finance/payouts',body:{requestId:crypto.randomUUID(),userId:b.dataset.pay,expectedOutstanding:owed,expectedEntryIds:entries.map(e=>e.id)},verb:'payment'});});
    root.querySelectorAll('[data-bill]').forEach(b=>b.onclick=()=>{const bill=state.bills.find(x=>x.kind===b.dataset.bill&&x.dueDate===b.dataset.due);showConfirm({title:'Confirm weekly payment',description:bill.name+' · '+money(bill.amount)+' · due '+dayLabel(bill.dueDate),path:'/api/finance/bills',body:{requestId:crypto.randomUUID(),kind:bill.kind,dueDate:bill.dueDate,expectedAmount:bill.amount},verb:'payment'});});
    root.querySelector('#cash-form')?.addEventListener('submit',e=>{e.preventDefault();const f=e.currentTarget;showConfirm({title:'Review cashbook entry',description:f.elements.kind.value+' · '+money(Math.round(Number(f.elements.amount.value)*100))+' · '+f.elements.reason.value,path:'/api/finance/cash',body:{requestId:crypto.randomUUID(),revision:state.revision,kind:f.elements.kind.value,amount:Math.round(Number(f.elements.amount.value)*100),reason:f.elements.reason.value},verb:'cash entry'});});
    root.querySelector('#finance-settings-form')?.addEventListener('submit',e=>{e.preventDefault();const f=e.currentTarget;save('/api/finance/settings',{revision:state.revision,requireVerification:f.elements.verification.checked,startDate:f.elements.startDate.value,...(f.elements.effectiveDate.value?{schedule:{effectiveDate:f.elements.effectiveDate.value,taxes:Math.round(Number(f.elements.taxes.value)*100)}}:{})});});
    bindEntries();
  }
  try{state=await request('/api/finance');if(!root.isConnected)return;seen();render();}catch(e){root.innerHTML='<p class="notice error">'+esc(e.message)+'</p>';}
}
