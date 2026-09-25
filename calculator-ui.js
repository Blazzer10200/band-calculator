import {money,dayOf,weekStart,countTotal,MAX_QTY,DEFAULT_BANDS} from './calc-model.js';
import {readDraft,saveDraft,clearDraft} from './draft-store.js';
import {escapeHtml as esc,readUiPreference,saveUiPreference} from './ui-utils.js';
import {createQuickMath} from './quick-math.js';
import {scanImage,saveAlias,warmReader,hasLearned,forgetLearned} from './band-scan.js';
import {createPanelLayout} from './panel-layout.js';
// Signed in: counts save to the account and add to a running total. Guest: the same calculator, kept on this device only.
export async function mountCalculator(root,session,{request,onSaved,onClean,canRefresh}){
  // Standalone (GitHub Pages): no server, so built-in prices and no account prompts.
  const standalone=!!session.standalone,signedIn=!!session.authenticated,owner=!!session.user?.owner,draftKey=signedIn?session.user.id:'guest';
  let state,confirm=null,message='',undoRemove=null,limit=12;
  const sectionKey=name=>`calc-section:${draftKey}:${name}`;
  const quickMath=createQuickMath();let mathOpen=readUiPreference(sectionKey('quick-math'))!=='closed';
  const layout=createPanelLayout({key:sectionKey('layout'),onChange:()=>syncArrangeBar()});
  const blank=()=>({quantities:{},notes:'',requestId:crypto.randomUUID()});
  let draft=readDraft(draftKey)||blank(),draftStored=true,savedFlash=false,entered=false,shots=[],scanQueue=null,scanProgress='',scanOthersOpen=false,renderScan=null,noteOpen=false,scanFilled=false;
  // A count started as a guest follows you into your new account.
  if(signedIn&&!readDraft(draftKey)){const guest=readDraft('guest');if(guest&&Object.values(guest.quantities).some(v=>Number(v)>0)){draft={quantities:guest.quantities,notes:guest.notes,requestId:crypto.randomUUID()};saveDraft(draftKey,draft);clearDraft('guest');message='The count you started before signing in is right where you left it.';}}
  const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasDraft=()=>Object.values(draft.quantities).some(v=>Number(v)>0)||!!draft.notes;
  const notice=()=>root.querySelector('[data-finance-message]');
  function error(e){message=e.message;undoRemove=null;const n=notice();if(n){n.hidden=false;n.innerHTML=noticeHtml();n.scrollIntoView({block:'nearest'});}}
  const canLoad=()=>root.isConnected&&!root.busy&&!confirm&&!layout.arranging()&&canRefresh();
  // A save that lands while a background refresh is in flight makes that refresh's answer older than what we already have.
  let writes=0;
  function seen(){root.seenPrices=state.pricesRevision;root.seenCounts=state.countsRevision;root.seenDay=state.day;}
  const load=async()=>signedIn?request('/api/me'):{...(standalone?{pricesRevision:0,bands:DEFAULT_BANDS}:await request('/api/bands')),day:dayOf(),counts:[],cashouts:[]};
  root.refreshFromServer=async()=>{if(!canLoad())return false;const sent=writes,fresh=await load();if(!canLoad()||sent!==writes)return false;const focus=document.activeElement?.id,selection=document.activeElement?.selectionStart;
    if(fresh.pricesRevision===state.pricesRevision&&root.querySelector('#finance-deposit-form')?.contains(document.activeElement)){state=fresh;seen();patchAroundForm();return true;}
    if(hasDraft()&&fresh.pricesRevision!==state.pricesRevision)message='Band prices were just updated. Your count is kept and the total now uses the new prices.';state=fresh;seen();render();if(focus){const el=root.querySelector('#'+CSS.escape(focus));el?.focus();if(el&&selection!==null&&['text','search'].includes(el.type))el.setSelectionRange(selection,selection);}return true;};
  async function save(path,body,kind){
    if(root.busy)return;root.busy=true;writes++;root.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=true);message='';undoRemove=null;
    const before=heroView().total;
    try{state=await request(path,{method:'POST',body});seen();confirm=null;
      if(kind==='saved'){clearDraft(draftKey);draft=blank();noteOpen=false;savedFlash=true;shots=[];scanFilled=false;}
      if(kind==='removed'){undoRemove=path.split('/')[3];message='Count removed.';}
      onClean();await onSaved(kind);render();
      if(kind==='cashed'){const hero=root.querySelector('[data-calc-hero]'),total=hero?.querySelector('.calc-total');hero?.classList.add('is-cashed');if(total)animateMoney(total,before,heroView().total);}
      if(savedFlash){savedFlash=false;root.querySelector('[data-calc-hero]')?.classList.add('is-saved');root.querySelector('.calc-row')?.classList.add('is-new');const status=root.querySelector('[data-draft-status]');if(status){status.textContent='Count saved. Your totals are updated.';status.classList.add('is-saved');}}
    }catch(e){
      if(e.payload?.pricesChanged){const {error:_,pricesChanged:__,...fresh}=e.payload;state=fresh;seen();message=e.message;render();}
      else error(e);
    }finally{root.busy=false;root.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=false);root.querySelectorAll('[data-finance-quantity]').forEach(i=>i.disabled=!state.bands.find(b=>b.id===i.dataset.financeQuantity)?.price);syncQuantityButtons();const total=draftTotal();root.querySelectorAll('[data-calc-save]').forEach(b=>b.disabled=!total);root.querySelectorAll('[data-discard]').forEach(b=>b.disabled=!hasDraft());renderScan?.();}
  }
  const entryDay=e=>dayOf(Date.parse(e.at));
  const sumOf=rows=>rows.reduce((n,e)=>n+e.total,0);
  const qty=b=>Math.min(MAX_QTY,Math.max(0,Math.floor(Number(draft.quantities[b.id])||0)));
  const rawQty=b=>{const v=draft.quantities[b.id];return typeof v==='string'&&/^\d*$/.test(v)?v:String(qty(b));};
  const draftLines=()=>state.bands.filter(b=>b.price&&qty(b)>0).map(b=>({...b,quantity:qty(b),amount:b.price*qty(b)}));
  const draftTotal=()=>draftLines().reduce((n,l)=>n+l.amount,0);
  const whenLabel=e=>{const when=new Date(e.at);return (dayOf(when.getTime())===state.day?'Today':when.toLocaleDateString('en-US',{month:'short',day:'numeric'}))+' · '+when.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});};
  const open=()=>state.counts.filter(e=>!e.cashoutId);
  // The hero is a running tally: every saved count not cashed out yet, plus whatever is being counted right now. A cash-out starts it over.
  const heroView=()=>{
    const rows=open(),saved=sumOf(rows),counting=draftTotal(),byBand=new Map();
    const add=l=>{const t=byBand.get(l.id)||{id:l.id,name:l.name,color:l.color,quantity:0,amount:0};t.quantity+=l.quantity;t.amount+=l.quantity*l.price;byBand.set(l.id,t);};
    for(const e of rows)for(const l of e.lines)add(l);
    for(const l of draftLines())add(l);
    const order=state.bands.map(b=>b.id),lines=[...byBand.values()].sort((a,b)=>(order.indexOf(a.id)+1||99)-(order.indexOf(b.id)+1||99));
    const note=!signedIn?(standalone?'Kept on this device for 24 hours.':'Kept on this device for 24 hours. No account needed.'):counting&&saved?money(counting)+' of this is the count you have not saved yet.':saved?'Saved counts since your last cash-out.':'';
    return {rows,saved,counting,total:saved+counting,lines,note};
  };
  const widthOf=(b,view)=>{const l=view.lines.find(x=>x.id===b.id);return view.total&&l?Math.min(100,l.amount/view.total*100).toFixed(2):0;};
  const barHtml=view=>state.bands.map(b=>{const w=widthOf(b,view);return '<i'+(Number(w)?'':' class="is-empty"')+' style="--band:'+esc(b.color)+';--w:'+w+'%"></i>';}).join('');
  const breakdownHtml=view=>view.lines.length?view.lines.map(l=>'<span style="--band:'+esc(l.color)+'"><i></i>'+esc(l.name.replace(/ band$/i,''))+' <strong>'+l.quantity.toLocaleString()+'</strong></span>').join('')+(view.note?'<span class="calc-hint">'+esc(view.note)+'</span>':''):'<span class="calc-hint">Step a band up or paste a screenshot to start counting.</span>';
  // Totals count up to the new value; a timeout lands the final figure even if frames stop (background tab).
  function animateMoney(el,from,to){
    if(el.calcFrame)cancelAnimationFrame(el.calcFrame);clearTimeout(el.calcDone);
    if(reduceMotion||document.hidden||from===to||Math.abs(to-from)>5000000000){el.textContent=money(to);return;}
    const start=performance.now(),duration=560;
    const step=t=>{const p=Math.min(1,(t-start)/duration),eased=1-Math.pow(1-p,3);el.textContent=money(p<1?Math.round((from+(to-from)*eased)/100)*100:to);if(p<1)el.calcFrame=requestAnimationFrame(step);};
    el.calcFrame=requestAnimationFrame(step);
    el.calcDone=setTimeout(()=>{cancelAnimationFrame(el.calcFrame);el.textContent=money(to);},duration+150);
  }
  const mathChips=()=>[{label:'This count '+money(draftTotal()),value:draftTotal()/100,color:'var(--ink-2)'},...state.bands.filter(b=>b.price).map(b=>({label:b.name.replace(/ band$/i,'')+' '+(b.price/100).toLocaleString('en-US'),value:b.price/100,color:b.color}))];
  function refreshTotals(){
    const total=draftTotal(),view=heroView();
    root.querySelectorAll('[data-finance-total]').forEach(el=>{const hero=el.classList.contains('calc-total'),next=hero?view.total:total,from=Number(el.dataset.cents);el.dataset.cents=next;if(hero)el.classList.toggle('is-zero',!next);animateMoney(el,Number.isFinite(from)?from:next,next);});
    root.querySelectorAll('[data-calc-bar] i').forEach((seg,i)=>{const b=state.bands[i];if(!b)return;const w=widthOf(b,view);seg.style.setProperty('--w',w+'%');seg.classList.toggle('is-empty',!Number(w));});
    quickMath.setChips(root,mathChips());
    const breakdown=root.querySelector('[data-calc-breakdown]');if(breakdown)breakdown.innerHTML=breakdownHtml(view);
    for(const b of state.bands){const tile=root.querySelector('[data-calc-tile="'+CSS.escape(b.id)+'"]');if(!tile)continue;const q=qty(b),line=tile.querySelector('[data-calc-line]'),next=money(b.price*q);tile.classList.toggle('is-active',!!(b.price&&q));if(line.textContent!==next){line.textContent=next;if(!reduceMotion){line.classList.remove('is-bump');void line.offsetWidth;line.classList.add('is-bump');}}}
    root.querySelectorAll('[data-calc-save]').forEach(b=>b.disabled=!total||!!root.busy);
    root.querySelectorAll('[data-discard]').forEach(b=>b.disabled=!hasDraft()||!!root.busy);
    root.querySelector('[data-calc-hero]')?.classList.remove('is-saved');
  }
  const chips=e=>'<span class="calc-chips">'+e.lines.map(l=>'<span style="--band:'+esc(l.color)+'"><i></i>'+esc(l.name.replace(/ band$/i,''))+' <strong>'+l.quantity.toLocaleString()+'</strong></span>').join('')+'</span>';
  function countRow(e){
    return '<article class="calc-row" data-receipt-id="'+esc(e.id)+'"><time datetime="'+esc(e.at)+'">'+esc(whenLabel(e))+'</time><strong class="calc-row-total">'+money(e.total)+'</strong><div class="calc-row-detail">'+(e.notes?'<span class="calc-row-note">'+esc(e.notes)+'</span>':'')+chips(e)+'</div><div class="calc-row-action">'+(e.cashoutId?'<small>Cashed out</small>':'<button type="button" class="text-button" data-remove="'+esc(e.id)+'">Remove</button>')+'</div></article>';
  }
  const readoutHtml=(label,view)=>'<div class="calc-readout"><p class="eyebrow">'+label+'</p><strong class="calc-total'+(view.total?'':' is-zero')+'" data-finance-total data-cents="'+view.total+'">'+money(view.total)+'</strong><div class="calc-bar" data-calc-bar aria-hidden="true">'+barHtml(view)+'</div><p class="calc-breakdown" data-calc-breakdown>'+breakdownHtml(view)+'</p></div>';
  function heroHtml(){
    const view=heroView();
    if(!signedIn)return '<section class="calc-hero is-guest" data-calc-hero aria-label="This count">'+readoutHtml('This count',view)+(standalone?'':'<div class="calc-guest-pitch"><h3>Keep a running total</h3><p>A free account saves counts, handles cash-outs, and keeps your history on any device.</p><div><button type="button" class="button primary" data-action="register">Create account</button><button type="button" class="text-button" data-action="login">Sign in</button></div></div>')+'</section>';
    const rows=state.counts,start=weekStart(state.day),undo=state.cashouts[0];
    const today=sumOf(rows.filter(e=>entryDay(e)===state.day)),week=sumOf(rows.filter(e=>entryDay(e)>=start)),all=sumOf(rows);
    const stat=(label,cents)=>'<div><dt>'+label+'</dt><dd'+(cents?'':' class="is-zero"')+'>'+money(cents)+'</dd></div>';
    let side='<dl class="calc-totals">'+stat('Today',today)+stat('This week',week)+stat('All time',all)+'</dl>';
    if(view.saved)side+='<button type="button" class="button secondary calc-cashout" data-cashout>Cash out '+money(view.saved)+'</button><p class="calc-cashout-note">Starts the running total over. History keeps every count.</p>';
    if(undo)side+='<button type="button" class="text-button calc-undo" data-undo-cashout="'+esc(undo.id)+'">Undo the '+money(undo.amount)+' cash-out from '+esc(whenLabel(undo))+'</button>';
    return '<section class="calc-hero" data-calc-hero aria-label="Running total">'+readoutHtml('Not cashed out',view)+'<div class="calc-hero-side">'+side+'</div></section>';
  }
  const draftNote=()=>signedIn?'Not saved yet. This count stays on this device for 24 hours.':standalone?'Kept on this device for 24 hours.':'Kept on this device for 24 hours. Make an account to save it for good.';
  function countHtml(){
    const total=draftTotal(),showNote=noteOpen||!!draft.notes;
    const tiles=state.bands.map((b,i)=>{const q=qty(b);return '<div class="calc-tile'+(b.price?(q?' is-active':''):' is-unpriced')+'" style="--band:'+esc(b.color)+';--i:'+i+'" data-row data-calc-tile="'+esc(b.id)+'"><span class="calc-swatch" aria-hidden="true"></span><label for="finance-qty-'+esc(b.id)+'"><strong>'+esc(b.name)+'</strong><small>'+(b.price?money(b.price)+' each':owner?'<a href="#/admin">Set a price in Admin</a>':'No price set yet')+'</small></label><div class="quantity-stepper"><button type="button" data-quantity-step="-1" aria-label="One less '+esc(b.name)+'">−</button><input id="finance-qty-'+esc(b.id)+'" aria-label="'+esc(b.name)+' count" data-finance-quantity="'+esc(b.id)+'" type="number" min="0" max="'+MAX_QTY+'" step="1" inputmode="numeric" autocomplete="off" value="'+esc(rawQty(b))+'" '+(b.price?'':'disabled')+'><button type="button" data-quantity-step="1" aria-label="One more '+esc(b.name)+'">+</button></div><span class="calc-line-total" data-calc-line="'+esc(b.id)+'">'+money(b.price*q)+'</span></div>';}).join('');
    const saveButton=signedIn?'<button class="button primary calc-save-button" data-calc-save '+(total?'':'disabled')+'>Save count</button>':standalone?'':'<button type="button" class="button secondary calc-save-button" data-action="register">Create account to save</button>';
    const status=hasDraft()?draftNote():signedIn?'Saving adds this count to today, this week, and all time.':standalone?'Everything stays on this device.':'Nothing leaves this device until you make an account.';
    const hint=signedIn?'Enter moves to the next band · Ctrl+Enter saves':'Enter moves to the next band';
    const clear='<button type="button" class="text-button" data-discard '+(hasDraft()?'':'disabled')+'>Clear</button>';
    return '<section class="panel calc-count"><div class="calc-head"><h2>Count bands</h2><p>'+hint+'</p></div><form id="finance-deposit-form"><div class="calc-tiles">'+(tiles||'<p class="calc-empty"><strong>No bands set up yet.</strong>'+(owner?'Add them in Admin and they show up here.':'Check back soon.')+'</p>')+'</div>'
      +(signedIn?'<div class="calc-note" data-calc-note'+(showNote?'':' hidden')+'><label for="finance-note">Note</label><textarea id="finance-note" maxlength="500" rows="1" placeholder="Where these came from…">'+esc(draft.notes)+'</textarea></div>':'')
      +'<div class="calc-save"><div class="calc-save-total">'+(signedIn?'<p class="eyebrow">This count</p>':'')+'<strong data-finance-total data-cents="'+total+'">'+money(total)+'</strong></div><div class="calc-save-actions">'+(signedIn?'<button type="button" class="text-button" data-note-toggle'+(showNote?' hidden':'')+'>Add a note</button>':'')+clear+saveButton+'</div></div><p class="calc-status" data-draft-status>'+status+'</p>'
      +'<div class="calc-sticky"><div class="calc-sticky-total"><span>This count</span><strong data-finance-total data-cents="'+total+'">'+money(total)+'</strong></div><div class="calc-sticky-actions">'+clear+saveButton+'</div></div></form></section>';
  }
  function scanHtml(){
    return '<aside class="panel calc-scan" data-scan-panel><div class="calc-head"><h2>Scan a screenshot</h2></div><p class="calc-scan-copy">Snip your inventory and paste it. It\'s read on this device and nothing is uploaded.</p><label class="scan-zone" data-scan-zone><input type="file" accept="image/*" multiple data-scan-input hidden><span class="scan-zone-title">Drop or paste a screenshot</span><span class="scan-keys"><kbd>Ctrl</kbd><kbd>V</kbd><span>anywhere</span></span></label><div class="scan-tools"><button type="button" class="text-button" data-scan-paste>Paste from clipboard</button>'+(hasLearned()?'<button type="button" class="text-button" data-scan-forget>Forget what the scanner learned</button>':'')+'</div><div class="scan-preview" data-scan-preview hidden><div class="scan-head"><p class="scan-status" data-scan-status></p><button type="button" class="text-button" data-scan-clear>Remove all</button></div><div class="scan-shots" data-scan-shots></div><div class="scan-result" data-scan-result hidden></div></div></aside>';
  }
  function mathHtml(){
    return '<details class="panel calc-math" data-calc-math'+(mathOpen?' open':'')+'><summary><h2>Quick math</h2><span class="calc-math-meta">Nothing here is saved<span class="calc-math-chevron" aria-hidden="true"><i></i></span></span></summary>'+quickMath.html(mathChips())+'</details>';
  }
  function recentHtml(){
    if(standalone)return '';
    if(!signedIn)return '<section class="panel calc-recent calc-guest-perks"><div class="calc-head"><h2>A free account adds</h2></div><ul><li><strong>A running total</strong><span>Every count you save adds up until you cash out.</span></li><li><strong>History</strong><span>Daily totals, a chart, and every cash-out, exportable to a spreadsheet.</span></li><li><strong>Any device</strong><span>Sign in on your phone and pick up where you left off.</span></li></ul></section>';
    const rows=state.counts;
    return '<section class="panel calc-recent"><div class="calc-head"><h2>Recent counts</h2>'+(rows.length?'<a class="text-button" href="#/history">Open history</a>':'')+'</div><div class="calc-rows" data-transaction-results>'+(rows.length?rows.slice(0,limit).map(countRow).join(''):'<div class="calc-empty-card"><p class="calc-empty-title">Nothing counted yet</p><p>Save your first count and it shows up here. Your running total starts with it.</p><div><button type="button" class="button primary" data-start-counting>Start counting</button><button type="button" class="button secondary" data-empty-paste>Paste screenshot</button></div></div>')+'</div>'+(rows.length>limit?'<div class="calc-recent-foot"><button type="button" class="button secondary" data-more>Show '+Math.min(12,rows.length-limit)+' more</button></div>':'')+'</section>';
  }
  const noticeHtml=()=>esc(message)+(undoRemove?' <button type="button" class="text-button" data-restore="'+esc(undoRemove)+'">Undo</button>':'');
  // Server data changed while the user is typing in the form: redraw everything except the form.
  function patchAroundForm(){
    const hero=root.querySelector('[data-calc-hero]'),recent=root.querySelector('.calc-recent');
    if(hero)hero.outerHTML=heroHtml();if(recent)recent.outerHTML=recentHtml();
    bindEntries();layout.apply(root);
  }
  // The arrange controls describe the mode they will switch to, so the label changes with the mode.
  function syncArrangeBar(){
    const bar=root.querySelector('[data-arrange-bar]');if(!bar)return;
    const on=layout.arranging();
    bar.classList.toggle('is-arranging',on);
    const toggle=bar.querySelector('[data-arrange]');
    if(toggle)toggle.textContent=on?'Done arranging':'Arrange panels';
    const reset=bar.querySelector('[data-arrange-reset]');
    if(reset)reset.hidden=!on&&!layout.customised();
    const hint=bar.querySelector('[data-arrange-hint]');
    if(hint)hint.hidden=!on;
  }
  function ownPage(){
    const enter=entered?'':' calc-enter';entered=true;
    const arrangeBar='<div class="calc-arrange-bar" data-arrange-bar><button type="button" class="text-button" data-arrange>Arrange panels</button><button type="button" class="text-button" data-arrange-reset hidden>Reset layout</button><small data-arrange-hint hidden>Drag a panel by its name. Pull the right or bottom edge to resize it.</small></div>';
    // Signed in, Recent counts sits under the count; for guests the side column carries the account pitch instead.
    return '<div class="calc-page'+enter+'"><h1 class="sr-only">Band calculator</h1>'+(standalone?'':arrangeBar)+heroHtml()+'<div class="calc-workspace"><div class="calc-main">'+countHtml()+(signedIn?recentHtml():'')+'</div><div class="calc-side">'+scanHtml()+mathHtml()+(signedIn?'':recentHtml())+'</div></div></div>';
  }
  function skeletonHtml(){
    const block=(i,style)=>'<span class="skel" style="--i:'+i+';'+style+'"></span>';
    return '<div class="calc-page calc-skeleton" aria-busy="true"><section class="calc-hero"><div class="calc-readout">'+block(0,'width:120px;height:11px')+block(1,'width:min(460px,80%);height:96px;margin-top:14px;border-radius:14px')+block(2,'height:3px;margin-top:32px')+'<p class="calc-loading">'+(signedIn?'Loading your counts…':'Loading band prices…')+'</p></div><div class="calc-hero-side">'+[3,4,5].map(i=>block(i,'height:44px')).join('')+'</div></section><div class="calc-workspace"><div class="calc-main"><section class="calc-count">'+block(6,'width:110px;height:15px;margin-bottom:18px')+Array.from({length:6},(_,i)=>block(7+i,'height:44px;margin-top:16px')).join('')+'</section></div><div class="calc-side">'+block(8,'width:150px;height:15px')+block(9,'height:132px;margin-top:16px;border-radius:12px')+'</div></div></div>';
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
      input.addEventListener('blur',()=>{const clean=String(Math.min(MAX_QTY,Math.max(0,Math.floor(Number(input.value)||0))));if(input.value!==clean){input.value=clean;input.dispatchEvent(new Event('input',{bubbles:true}));}});
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
  function confirmation(){
    if(!confirm)return '';const c=confirm;
    return '<div class="calc-confirm" data-confirm-backdrop><section class="finance-confirm" role="dialog" aria-modal="true" aria-labelledby="finance-confirm-title"><p class="eyebrow">Review this change</p><h2 id="finance-confirm-title">'+esc(c.title)+'</h2><p class="finance-confirm-desc">'+esc(c.description)+'</p><form id="finance-confirm-form"><p class="finance-confirm-note">'+esc(c.note)+'</p><div class="finance-confirm-actions"><button class="button primary">'+esc(c.verb)+'</button><button type="button" class="button secondary" data-cancel>Cancel</button></div></form></section></div>';
  }
  function showConfirm(c){confirm=c;root.querySelector('[data-finance-confirm]').innerHTML=confirmation();bindConfirm();root.querySelector('#finance-confirm-form button')?.focus();}
  function bindConfirm(){
    const cancel=()=>{if(root.busy)return;const kind=confirm?.kind;confirm=null;onClean();render();root.querySelector(kind==='undone'?'[data-undo-cashout]':'[data-cashout]')?.focus({preventScroll:true});};
    root.querySelector('[data-cancel]')?.addEventListener('click',cancel);
    const backdrop=root.querySelector('[data-confirm-backdrop]');
    backdrop?.addEventListener('click',e=>{if(e.target===backdrop)cancel();});
    backdrop?.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();cancel();}});
    root.querySelector('#finance-confirm-form')?.addEventListener('submit',e=>{e.preventDefault();save(confirm.path,confirm.body,confirm.kind);});
  }
  function render(){if(!root.isConnected)return;root.innerHTML='<div class="notice" data-finance-message role="status" '+(message?'':'hidden')+'>'+noticeHtml()+'</div><div data-finance-confirm>'+confirmation()+'</div>'+ownPage();bind();bindConfirm();}
  function bindEntries(){
    root.querySelectorAll('[data-more]').forEach(b=>b.onclick=()=>{limit+=12;render();});
    root.querySelectorAll('[data-cashout]').forEach(b=>b.onclick=()=>{const v=heroView();if(!v.saved)return;showConfirm({title:'Cash out '+money(v.saved),description:v.rows.length+(v.rows.length===1?' saved count':' saved counts')+' since your last cash-out.',path:'/api/cashouts',body:{requestId:crypto.randomUUID(),expectedIds:v.rows.map(e=>e.id)},kind:'cashed',verb:'Cash out',note:'The running total starts over from $0. Today, this week, all time, and your history keep every count.'});});
    root.querySelectorAll('[data-undo-cashout]').forEach(b=>b.onclick=()=>{const p=state.cashouts.find(x=>x.id===b.dataset.undoCashout);if(!p)return;showConfirm({title:'Undo this cash-out',description:money(p.amount)+' · '+whenLabel(p),path:'/api/cashouts/'+p.id+'/undo',body:{},kind:'undone',verb:'Undo cash-out',note:'Its counts go back into the running total, as if you never cashed out.'});});
    root.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>save('/api/counts/'+b.dataset.remove+'/remove',{},'removed'));
    root.querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>save('/api/counts/'+b.dataset.restore+'/restore',{},'restored'));
    root.querySelectorAll('[data-start-counting]').forEach(b=>b.onclick=()=>root.querySelector('[data-finance-quantity]:not(:disabled)')?.focus());
    root.querySelectorAll('[data-empty-paste]').forEach(b=>b.onclick=()=>root.querySelector('[data-scan-paste]')?.click());
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
    const MAX_SHOTS=10,result=root.querySelector('[data-scan-result]'),panel=root.querySelector('[data-scan-panel]'),tools=root.querySelector('.scan-tools');
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
      const chips=rows.map(r=>'<li style="--band:'+esc(r.color)+'"'+(r.unknown?' class="is-unknown"':r.unsure?' class="is-unsure"':'')+'><i></i><div><span>'+esc(r.name)+'</span>'+(r.unknown?'<small>'+plural(r.unknown,'count')+' not readable</small>':r.unsure?'<small>double-check this one</small>':r.shots.size>1?'<small>from '+plural(r.shots.size,'screenshot')+'</small>':'')+'</div><strong>'+(r.unknown&&!r.qty?'?':'×'+r.qty.toLocaleString())+'</strong></li>').join('');
      const errors=done.filter(s=>s.scan.error).map(s=>'Screenshot '+(shots.indexOf(s)+1)+': '+s.scan.error);
      const summary=(rows.length?'Found '+plural(rows.length,'band')+' in '+plural(done.length,'screenshot'):'No bands spotted'+(busy?' yet':'')+' in '+plural(done.length,'screenshot'))+(busy?', still reading '+busy+' more':'')+'.';
      return '<p class="scan-summary">'+esc(summary)+'</p>'+(errors.length?'<p class="scan-status is-warn">'+esc(errors.join(' '))+'</p>':'')
        +(rows.length?'<ul class="scan-found">'+chips+'</ul><div class="scan-actions"><button type="button" class="button primary" data-scan-fill'+(rows.some(r=>r.qty&&r.priced)?'':' disabled')+'>'+(scanFilled?'Filled in ✓':'Fill in counts')+'</button><small>Each screenshot adds up, so paste each pocket once.</small></div>':'')
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
        const tile=input.closest('.calc-tile');if(tile){tile.classList.remove('is-filled');void tile.offsetWidth;tile.classList.add('is-filled');setTimeout(()=>tile.classList.remove('is-filled'),900);}
      }
      form.dispatchEvent(new Event('input',{bubbles:true}));
      if(filled){scanFilled=true;const fill=result.querySelector('[data-scan-fill]');if(fill)fill.textContent='Filled in ✓';}
      const st=root.querySelector('[data-draft-status]');if(st)st.textContent=filled?'Counts filled in from your screenshots. Check them'+(signedIn?', then save.':'.')+(skipped.length?' Skipped '+skipped.join(', ')+': no price set.':''):'Nothing to fill in yet.';
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
      preview.hidden=!shots.length;zone.hidden=tools.hidden=!!shots.length;status.classList.remove('is-warn');
      const kb=Math.round(shots.reduce((n,s)=>n+s.size,0)/1024),busy=shots.some(s=>s.scan?.busy);
      status.textContent=shots.length?(busy?scanProgress||'Reading…':plural(shots.length,'screenshot')+' · '+(kb>1024?(kb/1024).toFixed(1)+' MB':kb+' KB')):'';
      status.classList.toggle('is-busy',busy);
      strip.innerHTML=shots.map((s,i)=>'<figure class="scan-shot'+(s.id===fresh?' is-new':'')+(s.scan?.busy?' is-reading':'')+'" data-shot="'+s.id+'"><img src="'+s.src+'" alt="Screenshot '+(i+1)+'" decoding="async"><figcaption>'+(i+1)+'</figcaption><button type="button" data-shot-remove="'+s.id+'" aria-label="Remove screenshot '+(i+1)+'">×</button></figure>').join('')+(shots.length<MAX_SHOTS?'<button type="button" class="scan-add" data-scan-add>+ Add</button>':'');
      strip.querySelectorAll('[data-shot-remove]').forEach(b=>b.addEventListener('click',()=>{shots=shots.filter(s=>s.id!==b.dataset.shotRemove);scanFilled=false;renderShots();}));
      strip.querySelector('[data-scan-add]')?.addEventListener('click',()=>input.click());
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
            if(shots.includes(s))s.scan=r;
          }catch(e){if(shots.includes(s))s.scan={error:e?.message||'Could not read this screenshot.'};}
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
        thumbnail(file).then(src=>{const id=crypto.randomUUID();scanFilled=false;shots.push({id,src,file,name:file.name||'pasted.png',size:file.size,at:Date.now()});renderShots(id);queueScan();}).catch(()=>say('That image could not be read. Try a PNG or JPG screenshot.'));
      }
    };
    renderShots();
    // Load the reader while nothing else is going on so the first screenshot is read right away.
    if(window.requestIdleCallback)requestIdleCallback(warmReader,{timeout:4000});else setTimeout(warmReader,1500);
    input.addEventListener('change',()=>{load(input.files);input.value='';});
    // The whole panel takes a drop, so screenshots can still be added once the drop zone gives way to thumbnails.
    for(const type of ['dragenter','dragover'])panel.addEventListener(type,e=>{e.preventDefault();panel.classList.add('is-over');});
    panel.addEventListener('dragleave',e=>{if(!panel.contains(e.relatedTarget))panel.classList.remove('is-over');});
    panel.addEventListener('drop',e=>{e.preventDefault();panel.classList.remove('is-over');load(e.dataTransfer.files);});
    root.querySelector('[data-scan-clear]')?.addEventListener('click',()=>{shots=[];scanFilled=false;renderShots();});
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
    root.querySelector('[data-scan-forget]')?.addEventListener('click',()=>{forgetLearned();message='The scanner forgot the band names and stack sizes it had picked up. The next screenshot starts fresh.';render();});
    if(root.pasteHandler)document.removeEventListener('paste',root.pasteHandler);
    root.pasteHandler=e=>{if(!root.isConnected){document.removeEventListener('paste',root.pasteHandler);return;}const files=[...(e.clipboardData?.items||[])].filter(i=>i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);if(files.length){e.preventDefault();load(files);panel.scrollIntoView({block:'nearest',behavior:reduceMotion?'auto':'smooth'});}};
    document.addEventListener('paste',root.pasteHandler);
  }
  function shake(el,name){if(!el||reduceMotion)return;el.classList.remove(name);void el.offsetWidth;el.classList.add(name);el.addEventListener('animationend',()=>el.classList.remove(name),{once:true});}
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
      const up=Number(button.dataset.quantityStep)>0;
      if(!up&&Number(input.value)<=Number(input.min)){shake(input.closest('.quantity-stepper'),'is-shake-sm');return;}
      up?input.stepUp():input.stepDown();
      if(!reduceMotion){input.classList.remove('is-up','is-down');void input.offsetWidth;input.classList.add(up?'is-up':'is-down');}
      input.dispatchEvent(new Event('input',{bubbles:true}));
    };button.addEventListener('click',step);button.addEventListener('calc:step',step);});
    if(form)bindQuantityFields(form);
    form?.addEventListener('input',()=>{draft.quantities=Object.fromEntries([...form.querySelectorAll('[data-finance-quantity]')].map(i=>[i.dataset.financeQuantity,i.value]));draft.notes=form.querySelector('#finance-note')?.value||'';draftStored=saveDraft(draftKey,draft);const status=root.querySelector('[data-draft-status]');status.classList.remove('is-saved');status.textContent=!draftStored?'This count lives in this tab only; device storage is unavailable.':draftNote();refreshTotals();onClean();});
    form?.addEventListener('submit',e=>{e.preventDefault();if(!signedIn){form.querySelector('[data-action="register"]')?.click();return;}const lines=state.bands.filter(b=>qty(b)>0).map(b=>({id:b.id,quantity:qty(b)}));if(!lines.length){shake(e.submitter||form.querySelector('[data-calc-save]'),'is-shake');error(Error('Count at least one band first.'));return;}save('/api/counts',{requestId:draft.requestId,pricesRevision:state.pricesRevision,lines,notes:draft.notes},'saved');});
    root.querySelectorAll('[data-discard]').forEach(b=>b.addEventListener('click',()=>{clearDraft(draftKey);draft=blank();noteOpen=false;onClean();message='';undoRemove=null;render();}));
    const note=form?.querySelector('#finance-note');if(note){growNote(note);note.addEventListener('input',()=>growNote(note));}
    root.querySelector('[data-note-toggle]')?.addEventListener('click',e=>{noteOpen=true;e.currentTarget.hidden=true;const box=root.querySelector('[data-calc-note]');box.hidden=false;growNote(note);note.focus();});
    bindScan();
    const math=root.querySelector('[data-calc-math]');if(math){quickMath.bind(math);math.addEventListener('toggle',()=>{if(math.open===mathOpen)return;mathOpen=math.open;saveUiPreference(sectionKey('quick-math'),mathOpen?'open':'closed');if(math.open)math.querySelector('[data-quick-math]')?.focus({preventScroll:true});});}
    bindEntries();
    layout.apply(root);layout.bind(root);
    root.querySelector('[data-arrange]')?.addEventListener('click',()=>layout.setArranging(!layout.arranging()));
    root.querySelector('[data-arrange-reset]')?.addEventListener('click',()=>layout.reset());
    syncArrangeBar();
  }
  if(!root.querySelector('.calc-page'))root.innerHTML=skeletonHtml();
  try{state=await load();if(!root.isConnected)return;seen();render();}catch(e){root.innerHTML='<p class="notice error">'+esc(e.message)+'</p>';}
}
