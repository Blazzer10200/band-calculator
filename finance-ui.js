import {depositTotal,financeMoney as money,nextThursday,financeDay} from './finance-model.js';
import {readDraft,saveDraft,clearDraft} from './draft-store.js';
import {escapeHtml as esc,downloadCsv,readUiPreference,saveUiPreference} from './ui-utils.js';
import {createQuickMath} from './quick-math.js';
import {scanImage,saveAlias,warmReader} from './band-scan.js';
export async function mountFinance(root,session,{request,onSaved,onClean,canRefresh}){
  let state,confirm=null,message='',limit=20;
  const memberId=session.user.id;
  const sectionKey=name=>`finance-section:${session.user.id}:${name}`;
  const quickMath=createQuickMath();let mathOpen=readUiPreference(sectionKey('math'))==='open';
  let draft=readDraft(memberId)||{quantities:{},notes:'',requestId:crypto.randomUUID()},draftStored=true,savedFlash=false,entered=false,shots=[],scanQueue=null,scanProgress='',scanOthersOpen=false,renderScan=null;
  const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const own=()=>state.deposits.filter(e=>e.userId===memberId);
  const hasDraft=()=>Object.values(draft.quantities).some(v=>Number(v)>0)||!!draft.notes;
  const notice=()=>root.querySelector('[data-finance-message]');
  function error(e){message=e.message;const n=notice();if(n){n.hidden=false;n.textContent=message;n.scrollIntoView({block:'nearest'});}}
  const canLoad=()=>root.isConnected&&!root.busy&&!confirm&&canRefresh();
  root.seenAccounts=session.versions?.accounts;
  root.openReceipt=id=>{root.querySelector('[data-receipt-id="'+CSS.escape(id)+'"]')?.scrollIntoView({block:'nearest'});};
  function seen(){root.seenRevision=state.revision;root.seenDay=state.day;}
  root.refreshFromServer=async()=>{if(!canLoad())return false;const fresh=await request('/api/finance');if(!canLoad())return false;const focus=document.activeElement?.id,selection=document.activeElement?.selectionStart;
    if(fresh.ratesVersion===state.ratesVersion&&root.querySelector('#finance-deposit-form')?.contains(document.activeElement)){state=fresh;seen();patchAroundForm();return true;}
    if(hasDraft()&&fresh.ratesVersion!==state.ratesVersion)message='Band values were updated. Your counts are kept and the total now uses the new values.';state=fresh;seen();render();if(focus){const el=root.querySelector('#'+CSS.escape(focus));el?.focus();if(el&&selection!==null&&['text','search'].includes(el.type))el.setSelectionRange(selection,selection);}return true;};
  async function save(path,body){
    if(root.busy)return;root.busy=true;root.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=true);message='';
    try{state=await request(path,{method:'POST',body});seen();confirm=null;
      if(path==='/api/finance/deposits'){clearDraft(memberId);draft={quantities:{},notes:'',requestId:crypto.randomUUID()};savedFlash=true;shots=[];}
      onClean();await onSaved(path==='/api/finance/payouts'?'paid':body?.decision==='withdraw'?'removed':'saved');render();
      if(savedFlash){savedFlash=false;root.querySelector('[data-calc-hero]')?.classList.add('is-saved');root.querySelector('.calc-row')?.classList.add('is-new');const status=root.querySelector('[data-draft-status]');if(status){status.textContent='Count saved. Your totals are updated.';status.classList.add('is-saved');}}
    }catch(e){error(e);}finally{root.busy=false;root.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=false);root.querySelectorAll('[data-finance-quantity]').forEach(i=>i.disabled=!state.bands.find(b=>b.id===i.dataset.financeQuantity)?.price);syncQuantityButtons();const total=draftTotal();root.querySelectorAll('[data-calc-save]').forEach(b=>b.disabled=!total);root.querySelectorAll('[data-discard]').forEach(b=>b.disabled=!hasDraft());}
  }
  const counted=()=>own().filter(e=>['pending','paid'].includes(e.status));
  const entryDay=e=>financeDay(Date.parse(e.at));
  const weekStart=()=>{const next=nextThursday(state.day);if(next===state.day)return next;const d=new Date(next+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-7);return d.toISOString().slice(0,10);};
  const sumOf=rows=>rows.reduce((n,e)=>n+depositTotal(e),0);
  const qty=b=>Math.min(1000000,Math.max(0,Math.floor(Number(draft.quantities[b.id])||0)));
  const rawQty=b=>{const v=draft.quantities[b.id];return typeof v==='string'&&/^\d*$/.test(v)?v:String(qty(b));};
  const draftLines=()=>state.bands.filter(b=>b.price&&qty(b)>0).map(b=>({...b,quantity:qty(b),amount:b.price*qty(b)}));
  const draftTotal=()=>draftLines().reduce((n,l)=>n+l.amount,0);
  const whenLabel=e=>{const when=new Date(e.at);return (financeDay(when.getTime())===state.day?'Today':when.toLocaleDateString('en-US',{month:'short',day:'numeric'}))+' · '+when.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});};
  const unpaid=()=>own().filter(e=>e.status==='pending');
  // The hero is a running tally: every saved count not paid out yet, plus whatever is being counted right now. A payout starts it over.
  const heroView=()=>{
    const rows=unpaid(),saved=rows.reduce((n,e)=>n+(e.remaining??depositTotal(e)),0),counting=draftTotal(),byBand=new Map();
    const add=l=>{const t=byBand.get(l.id)||{id:l.id,quantity:0,amount:0};t.quantity+=l.quantity;t.amount+=l.quantity*l.price;byBand.set(l.id,t);};
    for(const e of rows)for(const l of e.lines)add(l);
    for(const l of draftLines())add(l);
    const lines=state.bands.filter(b=>byBand.has(b.id)).map(b=>({...byBand.get(b.id),name:b.name,color:b.color}));
    const note=counting?money(counting)+' of this is the count you have not saved yet.':saved?'Saved counts since your last payout.':'';
    return {rows,saved,counting,total:saved+counting,lines,note};
  };
  const widthOf=(b,view)=>{const l=view.lines.find(x=>x.id===b.id);return view.total&&l?Math.min(100,l.amount/view.total*100).toFixed(2):0;};
  const barHtml=view=>state.bands.map(b=>'<i style="--band:'+esc(b.color)+';--w:'+widthOf(b,view)+'%"></i>').join('');
  const breakdownHtml=view=>view.lines.length?view.lines.map(l=>'<span style="--band:'+esc(l.color)+'"><i></i>'+esc(l.name)+' <strong>'+l.quantity.toLocaleString()+'</strong></span>').join('')+(view.note?'<span class="calc-hint">'+esc(view.note)+'</span>':''):'<span class="calc-hint">Step a band up or drop a screenshot to start counting.</span>';
  function animateMoney(el,from,to){
    if(el.calcFrame)cancelAnimationFrame(el.calcFrame);
    if(reduceMotion||from===to||Math.abs(to-from)>5000000000){el.textContent=money(to);return;}
    const start=performance.now(),duration=320;
    const step=t=>{const p=Math.min(1,(t-start)/duration),eased=1-Math.pow(1-p,3);el.textContent=money(p<1?Math.round((from+(to-from)*eased)/100)*100:to);if(p<1)el.calcFrame=requestAnimationFrame(step);};
    el.calcFrame=requestAnimationFrame(step);
  }
  function refreshTotals(){
    const total=draftTotal(),view=heroView();
    root.querySelectorAll('[data-finance-total]').forEach(el=>{const hero=el.classList.contains('calc-total'),next=hero?view.total:total,from=Number(el.dataset.cents);el.dataset.cents=next;if(hero)el.classList.toggle('is-zero',!next);animateMoney(el,Number.isFinite(from)?from:next,next);});
    root.querySelectorAll('[data-calc-bar] i').forEach((seg,i)=>{const b=state.bands[i];if(b)seg.style.setProperty('--w',widthOf(b,view)+'%');});
    const breakdown=root.querySelector('[data-calc-breakdown]');if(breakdown)breakdown.innerHTML=breakdownHtml(view);
    for(const b of state.bands){const tile=root.querySelector('[data-calc-tile="'+CSS.escape(b.id)+'"]');if(!tile)continue;const q=qty(b),line=tile.querySelector('[data-calc-line]'),next=money(b.price*q);tile.classList.toggle('is-active',!!(b.price&&q));if(line.textContent!==next){line.textContent=next;if(!reduceMotion){line.classList.remove('is-bump');void line.offsetWidth;line.classList.add('is-bump');}}}
    root.querySelectorAll('[data-calc-save]').forEach(b=>b.disabled=!total||!!root.busy);
    root.querySelectorAll('[data-discard]').forEach(b=>b.disabled=!hasDraft()||!!root.busy);
    root.querySelector('[data-calc-hero]')?.classList.remove('is-saved');
  }
  function countRow(e){
    return '<article class="calc-row" data-receipt-id="'+esc(e.id)+'"><div><time datetime="'+esc(e.at)+'">'+esc(whenLabel(e))+'</time>'+(e.notes?'<span class="calc-row-note">'+esc(e.notes)+'</span>':'')+'<span class="calc-chips">'+e.lines.map(l=>'<span style="--band:'+esc(l.color)+'"><i></i>'+esc(l.name.replace(/ band$/i,''))+' <strong>'+l.quantity.toLocaleString()+'</strong></span>').join('')+'</span></div><div class="calc-row-amount"><strong>'+money(depositTotal(e))+'</strong>'+(e.status==='pending'&&!e.paidAmount?'<button type="button" class="text-button" data-remove="'+esc(e.id)+'">Remove</button>':'<small>Paid out</small>')+'</div></article>';
  }
  function heroHtml(){
    const rows=counted(),view=heroView(),start=weekStart();
    const today=sumOf(rows.filter(e=>entryDay(e)===state.day)),week=sumOf(rows.filter(e=>entryDay(e)>=start)),all=sumOf(rows);
    const payout=view.saved&&state.canManage&&state.owner?'<div class="calc-hero-actions"><button type="button" class="button secondary" data-payout>Mark as paid out</button><small>Got paid for these? This starts the running total over.</small></div>':'';
    return '<section class="calc-hero" data-calc-hero aria-label="Running total"><div class="calc-readout"><span class="calc-label">Not paid out yet</span><strong class="calc-total'+(view.total?'':' is-zero')+'" data-finance-total data-cents="'+view.total+'">'+money(view.total)+'</strong><div class="calc-bar" data-calc-bar aria-hidden="true">'+barHtml(view)+'</div><p class="calc-breakdown" data-calc-breakdown>'+breakdownHtml(view)+'</p>'+payout+'</div><dl class="calc-totals"><div><dt>Today</dt><dd>'+money(today)+'</dd></div><div><dt>This week</dt><dd>'+money(week)+'</dd></div><div><dt>All time</dt><dd>'+money(all)+'</dd></div></dl></section>';
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
  function confirmation(){
    if(!confirm)return '';const c=confirm;
    return '<section class="finance-confirm panel" aria-label="Review this change"><h2>'+esc(c.title)+'</h2><p>'+esc(c.description)+'</p><form id="finance-confirm-form"><p>'+esc(c.note)+'</p><div class="finance-confirm-actions"><button class="button primary">Confirm '+esc(c.verb)+'</button><button type="button" class="button secondary" data-cancel>Cancel</button></div></form></section>';
  }
  function showConfirm(c){confirm=c;root.querySelector('[data-finance-confirm]').innerHTML=confirmation();bindConfirm();root.querySelector('[data-finance-confirm]').scrollIntoView({block:'nearest'});root.querySelector('#finance-confirm-form input,#finance-confirm-form textarea,#finance-confirm-form button')?.focus();}
  function bindConfirm(){
    root.querySelector('[data-cancel]')?.addEventListener('click',()=>{confirm=null;onClean();render();});
    root.querySelector('#finance-confirm-form')?.addEventListener('submit',e=>{e.preventDefault();save(confirm.path,confirm.body);});
  }
  function render(){if(!root.isConnected)return;root.innerHTML='<div class="notice" data-finance-message role="status" '+(message?'':'hidden')+'>'+esc(message)+'</div><div data-finance-confirm>'+confirmation()+'</div>'+ownPage();bind();bindConfirm();}
  function bindEntries(){
    root.querySelectorAll('[data-more]').forEach(b=>b.onclick=()=>{limit+=20;render();});
    root.querySelectorAll('[data-payout]').forEach(b=>b.onclick=()=>{const v=heroView();if(!v.saved)return;showConfirm({title:'Mark as paid out',description:money(v.saved)+' across '+v.rows.length+(v.rows.length===1?' count':' counts'),path:'/api/finance/payouts',body:{requestId:crypto.randomUUID(),userId:memberId,expectedOutstanding:v.saved,expectedEntryIds:v.rows.map(e=>e.id)},verb:'payout',note:'These counts move to Paid out and the running total starts over from $0. Today, this week and all time keep their numbers.'});});
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
    // Load the reader while nothing else is going on so the first screenshot is read right away.
    if(window.requestIdleCallback)requestIdleCallback(warmReader,{timeout:4000});else setTimeout(warmReader,1500);
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
  function exportCsv(){const rows=counted();downloadCsv('pto-transactions-'+state.day+'.csv',[['Reference','Member','State ID','Submitted','Status','Original value','Paid','Remaining','Note','Review reason'],...rows.map(e=>[e.id,e.name,e.identity?.stateId,e.at,e.status,depositTotal(e)/100,e.paidAmount/100,e.remaining/100,e.notes,e.reason])]);}
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
    if(form)bindQuantityFields(form);
    form?.addEventListener('input',()=>{draft.quantities=Object.fromEntries([...form.querySelectorAll('[data-finance-quantity]')].map(i=>[i.dataset.financeQuantity,i.value]));draft.notes=form.querySelector('#finance-note').value;draftStored=saveDraft(memberId,draft);const status=root.querySelector('[data-draft-status]');status.classList.remove('is-saved');status.textContent=draftStored?'Not saved yet. This count stays on this device for 24 hours.':'Not saved yet. This count lives in this tab only; device storage is unavailable.';refreshTotals();onClean();});
    form?.addEventListener('submit',e=>{e.preventDefault();const lines=state.bands.filter(b=>qty(b)>0).map(b=>({id:b.id,quantity:qty(b)}));if(!lines.length){error(Error('Count at least one band first.'));return;}save('/api/finance/deposits',{requestId:draft.requestId,ratesVersion:state.ratesVersion,lines,notes:draft.notes});});
    root.querySelectorAll('[data-discard]').forEach(b=>b.addEventListener('click',()=>{clearDraft(memberId);draft={quantities:{},notes:'',requestId:crypto.randomUUID()};onClean();message='';render();}));
    const note=form?.querySelector('#finance-note');if(note){growNote(note);note.addEventListener('input',()=>growNote(note));}
    bindScan();
    const math=root.querySelector('[data-calc-math]');if(math){quickMath.bind(math);math.addEventListener('toggle',()=>{mathOpen=math.open;saveUiPreference(sectionKey('math'),mathOpen?'open':'closed');if(math.open)math.querySelector('[data-quick-math]')?.focus({preventScroll:true});});}
    root.querySelector('[data-export]')?.addEventListener('click',exportCsv);
    bindEntries();
  }
  try{state=await request('/api/finance');if(!root.isConnected)return;seen();render();}catch(e){root.innerHTML='<p class="notice error">'+esc(e.message)+'</p>';}
}
