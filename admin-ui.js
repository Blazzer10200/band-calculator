import {money,cents,MAX_PRICE} from './calc-model.js';
import {escapeHtml as esc,timestamp,readUiPreference,saveUiPreference} from './ui-utils.js';
import {mountAudit,mountBackups} from './security-ui.js';
const tabs=[['prices','Prices'],['accounts','Accounts'],['activity','Activity'],['backups','Backups']];
// Owner only. Prices is the one screen anybody else's totals depend on, so it saves as a whole and refuses a stale copy.
export async function mountAdmin(root,session,{request,toast,onDirty}){
  let tab=readUiPreference('admin-tab')||'prices',prices=null,users=null,saved='';
  if(!tabs.some(([id])=>id===tab))tab='prices';
  root.dirty=false;
  const setDirty=value=>{root.dirty=value;onDirty(value);const bar=root.querySelector('[data-prices-bar]');if(bar)bar.classList.toggle('is-dirty',value);};
  root.refreshFromServer=async()=>{if(!root.isConnected||root.dirty||root.busy)return false;if(tab==='prices'){prices=await request('/api/admin/bands');root.seenPrices=prices.pricesRevision;renderTab();}return true;};
  const rowHtml=(b,i=0)=>'<div class="price-row'+(b.active?'':' is-hidden')+'" data-band-row="'+esc(b.id)+'" data-used="'+(b.used?1:0)+'" style="--i:'+i+'"><input type="color" name="color" value="'+esc(b.color)+'" aria-label="'+esc(b.name)+' color"><input name="name" value="'+esc(b.name)+'" maxlength="40" required aria-label="Band name"><label class="money-input"><span>$</span><input name="price" type="number" min="0" max="'+MAX_PRICE/100+'" step="0.01" inputmode="decimal" required value="'+b.price/100+'" aria-label="'+esc(b.name)+' price"><small class="price-was" data-price-was></small></label><label class="price-visible"><input type="checkbox" role="switch" name="active" '+(b.active?'checked':'')+'><span class="sr-only">Visible</span></label><span class="price-order"><button type="button" data-move="-1" aria-label="Move '+esc(b.name)+' up">↑</button><button type="button" data-move="1" aria-label="Move '+esc(b.name)+' down">↓</button></span>'+(b.used?'<small class="price-used" title="Saved counts use this band. Turn off Visible to hide it instead.">In use</small>':'<button type="button" class="text-button price-delete" data-delete-band>Delete</button>')+'</div>';
  const readRows=()=>[...root.querySelectorAll('[data-band-row]')].map(row=>({id:row.dataset.bandRow,name:row.querySelector('[name=name]').value.trim(),color:row.querySelector('[name=color]').value,price:cents(row.querySelector('[name=price]').value||0),active:row.querySelector('[name=active]').checked}));
  function pricesHtml(){
    return '<section class="admin-section admin-prices"><div class="admin-head"><div><h2>Band prices</h2><p>What everyone\'s calculator uses. Changes apply to new counts right away; saved counts keep the price they were entered at.</p></div><button type="button" class="button secondary" data-add-band>+ Add band</button></div><div class="price-head" aria-hidden="true"><span></span><span>Name</span><span>Price each</span><span>Visible</span><span>Order</span><span></span></div><form id="prices-form"><div class="price-rows" data-price-rows>'+prices.bands.map(rowHtml).join('')+'</div><p class="form-error" data-prices-error role="alert"></p><div class="prices-bar" data-prices-bar><span data-prices-status>'+(saved?esc(saved):'No changes. Hidden bands stay in history but drop off the calculator.')+'</span><button type="button" class="text-button" data-prices-reset>Undo changes</button><button class="button primary">Save prices</button></div></form></section>';
  }
  const initials=name=>(name.trim().split(/\s+/).map(w=>w[0]).join('').slice(0,2)||'?').toUpperCase();
  function accountsHtml(){
    const active=users.filter(u=>!u.disabled).length;
    return '<section class="admin-section admin-accounts"><div class="admin-head is-end"><div><h2>Accounts</h2><p>'+users.length+(users.length===1?' account':' accounts')+', '+active+' active. Anyone can sign up. Disabling an account signs it out everywhere and blocks sign-in; its counts are kept.</p></div><label class="admin-search"><span class="sr-only">Search accounts</span><input type="search" data-account-search placeholder="Search accounts" autocomplete="off"></label></div><div class="account-rows">'+users.map((u,i)=>'<article class="account-row'+(u.disabled?' is-disabled':'')+'" style="--i:'+i+'" data-account-text="'+esc((u.name+' '+u.username).toLowerCase())+'"><span class="account-avatar" aria-hidden="true">'+esc(initials(u.name||u.username))+'</span><div><strong>'+esc(u.name)+'</strong><span>@'+esc(u.username)+(u.owner?' · Owner':'')+(u.mfaEnabled?' · 2FA on':'')+(u.disabled?' · Disabled':'')+'</span></div><div class="account-row-stats"><span>'+u.counts.toLocaleString()+(u.counts===1?' count':' counts')+'</span><small>'+(u.lastCount?'Last '+esc(timestamp(u.lastCount)):'No counts yet')+(u.createdAt?' · joined '+esc(new Date(u.createdAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})):'')+'</small></div>'+(u.owner?'<span class="account-row-lock">Protected</span>':'<button type="button" class="button secondary'+(u.disabled?' is-enable':'')+'" data-toggle-user="'+esc(u.id)+'" data-disabled="'+(u.disabled?1:0)+'">'+(u.disabled?'Enable':'Disable')+'</button>')+'</article>').join('')+'</div><p class="admin-empty" data-account-none hidden>No accounts match.</p></section>';
  }
  async function renderTab(){
    const body=root.querySelector('[data-admin-body]');if(!body)return;
    root.querySelectorAll('[data-admin-tab]').forEach(b=>{const on=b.dataset.adminTab===tab;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on));});
    try{
      if(tab==='prices'){prices??=await request('/api/admin/bands');root.seenPrices=prices.pricesRevision;body.innerHTML=pricesHtml();bindPrices(body);}
      if(tab==='accounts'){users=(await request('/api/admin/users')).users;body.innerHTML=accountsHtml();bindAccounts(body);}
      if(tab==='activity'){body.innerHTML='<div id="audit-panel"></div>';await mountAudit(body.querySelector('#audit-panel'),request);}
      if(tab==='backups'){body.innerHTML='<div id="backup-panel"></div>';await mountBackups(body.querySelector('#backup-panel'),request);}
    }catch(e){body.innerHTML='<p class="notice error">'+esc(e.message)+'</p>';}
  }
  function bindPrices(body){
    const form=body.querySelector('#prices-form'),rows=body.querySelector('[data-price-rows]'),error=body.querySelector('[data-prices-error]');
    const changed=()=>JSON.stringify(readRows())!==JSON.stringify(prices.bands.map(({id,name,color,price,active})=>({id,name,color,price,active})));
    const sync=()=>{
      setDirty(changed());error.textContent='';saved='';
      // One change per band that differs (added, edited, moved) plus each band deleted.
      const now=readRows(),before=prices.bands.map(({id,name,color,price,active})=>({id,name,color,price,active}));
      const edits=now.filter((b,i)=>JSON.stringify(b)!==JSON.stringify(before[i])).length+before.filter(b=>!now.some(x=>x.id===b.id)).length;
      const status=body.querySelector('[data-prices-status]');if(status)status.textContent=root.dirty?Math.max(1,edits)+(Math.max(1,edits)===1?' unsaved change':' unsaved changes')+'. Nobody sees new prices until you save.':'No changes. Hidden bands stay in history but drop off the calculator.';
      rows.querySelectorAll('[data-band-row]').forEach(row=>{const was=prices.bands.find(b=>b.id===row.dataset.bandRow),price=cents(row.querySelector('[name=price]').value||0),moved=!!was&&was.price!==price;row.classList.toggle('is-hidden',!row.querySelector('[name=active]').checked);row.classList.toggle('is-new',!was);row.classList.toggle('is-changed',moved);row.querySelector('[data-price-was]').textContent=moved?'was '+(was.price/100).toLocaleString('en-US'):'';row.querySelector('[name=price]').title=moved?'Was '+money(was.price):'';});
    };
    form.addEventListener('input',sync);form.addEventListener('change',sync);
    body.querySelector('[data-add-band]').onclick=()=>{rows.insertAdjacentHTML('beforeend',rowHtml({id:'band-'+crypto.randomUUID().slice(0,8),name:'New band',color:'#b9d984',price:0,active:true,used:false}));const input=rows.lastElementChild.querySelector('[name=name]');input.focus();input.select();sync();};
    rows.addEventListener('click',e=>{
      const move=e.target.closest('[data-move]'),del=e.target.closest('[data-delete-band]');
      if(move){const row=move.closest('[data-band-row]'),other=Number(move.dataset.move)<0?row.previousElementSibling:row.nextElementSibling;if(other){Number(move.dataset.move)<0?other.before(row):other.after(row);move.focus();sync();}}
      if(del){const row=del.closest('[data-band-row]');row.remove();sync();}
    });
    body.querySelector('[data-prices-reset]').onclick=()=>{setDirty(false);saved='';renderTab();};
    form.onsubmit=async e=>{
      e.preventDefault();if(root.busy)return;
      const next=readRows(),dupe=next.find((b,i)=>next.findIndex(x=>x.name.toLowerCase()===b.name.toLowerCase())!==i);
      if(dupe){error.textContent='Two bands are both called '+dupe.name+'.';return;}
      if(!next.some(b=>b.active)){error.textContent='Keep at least one band visible.';return;}
      root.busy=true;form.querySelectorAll('button,input').forEach(el=>el.disabled=true);
      try{
        const result=await request('/api/admin/bands',{method:'PUT',body:{pricesRevision:prices.pricesRevision,bands:next}});
        const used=new Set(prices.bands.filter(b=>b.used).map(b=>b.id));
        prices={pricesRevision:result.pricesRevision,bands:result.bands.map(b=>({...b,used:used.has(b.id)}))};
        setDirty(false);saved=result.unchanged?'Nothing changed.':'Saved. Everyone\'s calculator uses the new prices now.';
        toast(result.unchanged?'Nothing to save.':'Prices saved.');
      }catch(err){
        if(err.status===409){prices=null;saved='';setDirty(false);toast(err.message);}
        else{root.busy=false;form.querySelectorAll('button,input').forEach(el=>el.disabled=false);error.textContent=err.message;return;}
      }
      root.busy=false;renderTab();
    };
  }
  function bindAccounts(body){
    const search=body.querySelector('[data-account-search]'),none=body.querySelector('[data-account-none]');
    search.oninput=()=>{const q=search.value.trim().toLowerCase();let shown=0;body.querySelectorAll('[data-account-text]').forEach(row=>{const hit=!q||row.dataset.accountText.includes(q);row.hidden=!hit;if(hit)shown++;});none.hidden=!!shown;};
    body.querySelectorAll('[data-toggle-user]').forEach(button=>button.onclick=async()=>{
      const disable=button.dataset.disabled!=='1',u=users.find(x=>x.id===button.dataset.toggleUser);
      if(disable&&!window.confirm('Disable @'+u.username+'? They are signed out right away and cannot sign back in until you enable the account. Their counts are kept.'))return;
      button.disabled=true;
      try{await request('/api/admin/users/'+encodeURIComponent(u.id),{method:'POST',body:{disabled:disable}});toast((disable?'Disabled @':'Enabled @')+u.username+'.');await renderTab();}
      catch(e){button.disabled=false;toast(e.message);}
    });
  }
  root.innerHTML='<div class="admin-page"><div class="page-heading admin-heading"><h1>Admin</h1></div><nav class="admin-nav" role="tablist" aria-label="Admin sections">'+tabs.map(([id,label])=>'<button type="button" role="tab" class="simple-nav" data-admin-tab="'+id+'">'+label+'</button>').join('')+'</nav><div data-admin-body></div></div>';
  root.querySelectorAll('[data-admin-tab]').forEach(b=>b.onclick=()=>{if(b.dataset.adminTab===tab)return;if(root.dirty&&!window.confirm('Discard your unsaved price changes?'))return;setDirty(false);prices=null;saved='';tab=b.dataset.adminTab;saveUiPreference('admin-tab',tab);renderTab();});
  await renderTab();
}
