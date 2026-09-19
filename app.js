import {uiIcon,revealContent} from './ui-utils.js';
import {installSelectMenus} from './select-ui.js';
import {clearAllDrafts} from './draft-store.js';
import {mountReleaseNotice} from './release-ui.js';
import {mountFinance} from './finance-ui.js';
import {financeDay} from './finance-model.js';
import {authRequest,loginScreen,approvalScreen,mountAccess,mountRequests,accountDialog} from './auth-ui.js';
import {securityGate,securityNudge,dismissSecurityNudge} from './security-ui.js';
import {permits} from './access-model.js';
import {accountMenu,dismissAccountMenu} from './ui-shell.js';
import { CloudLedger } from './cloud.js';
import { cents, validateBackup, freshData } from './model.js';

const $ = selector => document.querySelector(selector);
installSelectMenus();
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => crypto.randomUUID();
const icon = (name, size=20) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({plus:'<path d="M12 5v14M5 12h14"/>',settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--panel)"/><circle cx="15" cy="17" r="3" fill="var(--panel)"/>',calculator:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01"/>',check:'<path d="m5 12 4 4L19 6"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>'})[name] || ''}</svg>`;
let data=freshData(), loadError = '', cloud=null, saving=false, authSession=null;
let pageDirty=false,syncBusy=false,pendingAccessTab='',renderedPage='',pendingSettingsSection='';
const hasOpenModal=()=>!!$('#modal')?.open;
const canApplyRemote=()=>!pageDirty&&!saving&&!hasOpenModal()&&!$('#finance-panel')?.busy&&!$('.select-menu.is-open');
function syncMessage(message=''){const note=$('#live-sync-note');if(note){note.hidden=!message;note.textContent=message;}}
document.addEventListener('input',event=>{if(event.target.closest('#app main form')&&!event.target.closest('#requests-panel,#finance-deposit-form'))pageDirty=true;});
document.addEventListener('change',event=>{if(event.target.closest('#app main form')&&!event.target.closest('#requests-panel,#finance-deposit-form'))pageDirty=true;});
const permissionPage=id=>({overview:'bands'}[id]||id);
const can=(id,level='view')=>permits(authSession?.permissions,permissionPage(id),level);
const adminPages=['access','requests','settings'];
const landingPage=()=>['overview',...adminPages].find(id=>can(id))||'none';
const adminPage=()=>adminPages.find(id=>can(id));
const storageLabel=()=>authSession?.development?'Saved locally':'Saved online';
let page='overview';
async function commit(next) {
  if (saving) return false;
  if (loadError) { toast(loadError); return false; }
  saving=true;
  document.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=true);
  if ($('#connection-status')) $('#connection-status').textContent='Saving…';
  try {
    next=validateBackup(next);
    if(cloud) data=validateBackup(await cloud.save(next));
    else throw Error('Sign in before saving records.');
    pageDirty=false;
    if ($('#connection-status')) $('#connection-status').textContent=cloud?storageLabel():'Saved in this browser';
    return true;
  } catch(error) {
    if(cloud) loadError=error.conflict?error.message:'Save could not be confirmed. Reload to check the latest settings before trying again.';
    if ($('#connection-status')) $('#connection-status').textContent=cloud?'Save not confirmed · reload required':'Save failed';
    toast(loadError || 'Could not save: '+error.message);
    return false;
  } finally {
    saving=false;
    document.querySelectorAll('button,input,textarea').forEach(el=>el.disabled=false);
  }
}
function toast(message) { $('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('visible'),4000); }
document.addEventListener('click',dismissAccountMenu);
document.addEventListener('keydown',dismissAccountMenu);
document.addEventListener('focusin',dismissAccountMenu);
const routeNames={overview:'stash',access:'admin',settings:'settings',requests:'requests'};
const legacyRoutes=['#/home','#/calendar','#/updates','#/roster','#/treasury','#/contacts'];
const routePage=()=>{const route=location.hash.split('?')[0];return route==='#/people'?'access':route==='#/admin'?adminPage():legacyRoutes.includes(route)?landingPage():Object.keys(routeNames).find(k=>route==='#/'+routeNames[k]);};
function go(next,replace=false,receipt='') {const target=['home','events','notifications','roster','history','contacts','purchase'].includes(next)?landingPage():next;if(!can(target)){toast('Your role does not have access to this page.');return;}if(saving||$('#finance-panel')?.busy){toast('Please wait for the current save to finish.');return;}if(pageDirty&&!window.confirm('Leave this page and discard its unsaved form changes?'))return;page=target;window.history[replace?'replaceState':'pushState']({},'', '#/'+(routeNames[page]||page)+(receipt?'?receipt='+encodeURIComponent(receipt):''));render();window.scrollTo({top:0});}
function followRoute(){if(!authSession?.authenticated)return;const target=routePage();if(!target)return;if(target!==page){go(target,true,new URLSearchParams(location.hash.split('?')[1]||'').get('receipt')||'');if(target!==page)window.history.replaceState({},'','#/'+(routeNames[page]||page));}else if(location.hash.split('?')[0]!=='#/'+(routeNames[page]||page))window.history.replaceState({},'','#/'+(routeNames[page]||page));}
window.addEventListener('popstate',followRoute);
window.addEventListener('hashchange',followRoute);
window.addEventListener('beforeunload',e=>{if(pageDirty||saving||$('#finance-panel')?.busy){e.preventDefault();e.returnValue='';}});
document.addEventListener('pto:navigate',e=>typeof e.detail==='string'?go(e.detail):go(e.detail.page,false,e.detail.receipt));
document.addEventListener('pto:access-tab',e=>{pendingAccessTab=e.detail;if($('#access-panel')?.openTab){$('#access-panel').openTab(pendingAccessTab);pendingAccessTab='';}});
function render() {
  pageDirty=false;
  if(!authSession?.authenticated||authSession.user.approval!=='approved'||authSession.security?.enrollmentRequired)return;
  const pages={overview:overview,settings:settingsPage,access:()=>'<div id="access-panel"><p>Loading accounts…</p></div>',requests:()=>'<div id="requests-panel"><p>Loading join requests…</p></div>'};
  if(!pages[page]||!can(page)){page=landingPage();window.history.replaceState({},'','#/'+(routeNames[page]||page));}
  const pageChanged=page!==renderedPage;renderedPage=page;
  const inAdmin=adminPages.includes(page),admin=adminPage();
  const requestCount=()=>`<span class="request-nav-count" aria-label="Pending join requests" ${authSession.pendingRequests?'':'hidden'}>${authSession.pendingRequests||0}</span>`;
  const navigation=[['overview','calculator','Calculator']].filter(([id])=>can(id));
  const adminNavigation=inAdmin?`<nav class="admin-nav" aria-label="Admin sections">${[['access','Accounts & access'],['requests','Join requests'],['settings','Settings & backups']].filter(([id])=>can(id)).map(([id,label])=>`<button class="simple-nav ${page===id?'active':''}" data-page="${id}" ${page===id?'aria-current="page"':''}>${label}${id==='requests'?requestCount():''}</button>`).join('')}</nav>`:'';
  $('#app').innerHTML=`<button type="button" class="skip-link" data-action="skip-content">Skip to content</button><header class="simple-header finance-header"><div class="header-top"><a class="brand" href="#/${routeNames[landingPage()]||'none'}" data-page="${landingPage()}"><img class="finance-logo" src="./pto-still.png" alt="" width="40" height="40"><span>${esc(data.name)}<small>Band calculator</small></span></a>${accountMenu(authSession)}</div><nav class="finance-main-nav" aria-label="Main navigation">${navigation.map(([id,ic,label])=>`<button data-page="${id}" class="simple-nav ${page===id?'active':''}" ${page===id?'aria-current="page"':''}>${icon(ic,16)}<span>${label}</span></button>`).join('')}${admin?`<button data-page="${admin}" class="simple-nav admin-entry ${inAdmin?'active':''}" ${inAdmin?'aria-current="page"':''}>${icon('settings',16)}<span>Admin</span>${can('requests')?requestCount():''}</button>`:''}</nav></header><div class="simple-shell"><div class="workspace-content"><main id="main-content" tabindex="-1">${adminNavigation}${inAdmin?securityNudge(authSession):''}<div id="live-sync-note" class="notice" role="status" hidden></div>${loadError?`<div class="notice error">${esc(loadError)}</div>`:''}${!['none','overview'].includes(page)&&!can(page,'manage')?'<div class="readonly-notice">View access · Your role cannot save changes on this page.</div>':''}${pages[page]?pages[page]():'<div class="empty"><h1>Access pending</h1><p>Your account is ready. Ask an Owner or access manager to assign a role.</p></div>'}</main></div><footer><span id="connection-status">${storageLabel()}</span><div class="footer-links"><button class="text-button" data-action="reload">Reload latest</button><span id="release-status"></span></div></footer></div>`;
  bindForms();applyPagePermissions();mountReleaseNotice($('#release-status'),()=>!pageDirty&&!saving&&!$('#finance-panel')?.busy);
  const pageContent=$('main'),finishPage=()=>{if(!pageContent.isConnected)return;if(pageChanged){revealContent(pageContent);pageContent.focus({preventScroll:true});}if(page==='settings'&&pendingSettingsSection){openSettingsSection(pendingSettingsSection);pendingSettingsSection='';}};
  if(!$('#finance-panel')&&!['access','requests'].includes(page))finishPage();
  if($('#finance-panel'))mountFinance($('#finance-panel'),authSession,{request:authRequest,canRefresh:canApplyRemote,onClean:()=>{pageDirty=false;},onSaved:(kind)=>{pageDirty=false;toast(kind==='removed'?'Count removed.':'Count saved.');}}).then(()=>{const receipt=new URLSearchParams(location.hash.split('?')[1]||'').get('receipt');if(receipt)$('#finance-panel')?.openReceipt?.(receipt);finishPage();});
  if(page==='access')mountAccess($('#access-panel'),authSession,async()=>{await refreshSession();toast('Website access saved.');},async()=>{authSession=await authRequest('/api/session');data=validateBackup(await cloud.load());pageDirty=false;}).then(()=>{if(pendingAccessTab&&$('#access-panel')?.openTab){$('#access-panel').openTab(pendingAccessTab);pendingAccessTab='';}finishPage();});
  if(page==='requests')mountRequests($('#requests-panel'),authSession,async message=>{data=validateBackup(await cloud.load());await pollSession();if(message)toast(message);}).then(finishPage);
}
function applyPagePermissions(){
  document.querySelectorAll('main [data-page]').forEach(button=>{if(!can(button.dataset.page))button.hidden=true;});
  if(page==='settings'&&!can('settings','manage'))document.querySelectorAll('#settings-form input,#settings-form button').forEach(input=>input.disabled=true);
}
async function refreshSession(){
  authSession=await authRequest('/api/session');
  if(!authSession.authenticated){cloud=null;loginScreen(authSession,openWorkspace);return;}
  if(authSession.user.approval!=='approved'||authSession.security?.enrollmentRequired){await openWorkspace(authSession);return;}
  // Load a fresh, filtered snapshot whenever your permissions change.
  data=validateBackup(await cloud.load());render();
}
function title(eyebrow,heading,description,actions='') {
  return `<div class="page-heading"><div><h1>${heading}</h1><p>${description}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function overview() {
  return '<div id="finance-panel" data-finance-mode="bands"><p>Loading your bands…</p></div>';
}
function bandSetting(b){return `<div class="setting-band" data-setting-band="${esc(b.id)}"><input type="color" name="color" value="${b.color}" aria-label="Band color"><input name="bandname" aria-label="Band name" value="${esc(b.name)}" maxlength="40" required><label class="money-input"><span>$</span><input name="price" aria-label="Default unit price" value="${b.price/100}" type="number" min="0" max="1000000000" step="0.01" required></label><label class="toggle-label"><input type="checkbox" name="active" ${b.active?'checked':''}> Active</label><button type="button" class="icon-button" data-move="up" aria-label="Move band up">${uiIcon('up')}</button><button type="button" class="icon-button" data-move="down" aria-label="Move band down">${uiIcon('down')}</button><button type="button" class="text-button" data-remove-band="${esc(b.id)}">Remove</button></div>`;}
function settingsPage() {
  return title('','Settings & backups','Manage band prices, the website name, and encrypted backups.')+`<nav class="settings-shortcuts" aria-label="Settings sections"><button class="text-button" data-settings-section="bands">Bands & prices</button><button class="text-button" data-settings-section="backups">Backups</button></nav><form id="settings-form" class="simple-settings"><section id="settings-bands" class="panel settings-panel"><div class="panel-header"><div><h2>Bands & prices</h2><p>Changes apply to new counts only. Saved counts keep the prices they were entered at.</p></div><button type="button" class="button secondary" data-action="add-band">${icon('plus',16)} Add band</button></div><div class="settings-band-head"><span>COLOR & NAME</span><span>PRICE EACH</span><span>VISIBLE / ORDER</span></div><div id="band-settings">${data.bands.map(bandSetting).join('')}</div><label class="settings-name" for="site-name">Website name</label><input id="site-name" name="sitename" maxlength="40" required value="${esc(data.name)}"><div class="form-error" id="settings-error" role="alert"></div><button class="button primary" type="submit">${icon('check',17)} Save settings</button></section></form><section id="settings-backups" class="panel settings-panel backup-panel"><div><h2>Backups</h2><p>${authSession.user.owner?'Full encrypted backups cover every account, saved count, and setting. They live under Admin → Accounts & access → Backups.':'Full encrypted backups are managed by the Owner under Admin → Accounts & access → Backups.'}</p></div>${authSession.user.owner?'<div class="backup-actions"><button class="button secondary" data-action="full-backup">Open encrypted backups</button></div>':''}</section>`;
}
function openSettingsSection(name){
  if(!['bands','backups'].includes(name))return;
  const section=$('#settings-'+name);if(!section)return;
  const target=section.querySelector('summary,h2')||section;target.tabIndex=-1;target.focus({preventScroll:true});
  section.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}
function bindForms(){
  $('#settings-form')?.addEventListener('submit',async e=>{e.preventDefault();const bands=[...document.querySelectorAll('[data-setting-band]')].map(row=>({id:row.dataset.settingBand,name:row.querySelector('[name=bandname]').value.trim(),color:row.querySelector('[name=color]').value,price:cents(row.querySelector('[name=price]').value),active:row.querySelector('[name=active]').checked}));const next={...data,name:$('#site-name').value.trim(),bands};try{validateBackup(next);if(await commit(next)){render();toast('Settings saved. Your new prices are ready.');}}catch(error){$('#settings-error').textContent=error.message;}});
}
function openModal(html){$('#modal').innerHTML=`<button class="modal-close icon-button" data-action="close" aria-label="Close dialog">${icon('close')}</button>${html}`;if(!$('#modal').open)$('#modal').showModal();}
document.addEventListener('click',async e=>{
  if(saving){e.preventDefault();return;}
  const button=e.target.closest('button,a');if(!button)return;
  if(button.dataset.settingsSection){e.preventDefault();if(page==='settings')openSettingsSection(button.dataset.settingsSection);else{pendingSettingsSection=button.dataset.settingsSection;go('settings');if(page!=='settings')pendingSettingsSection='';}return;}
  if(button.dataset.page){e.preventDefault();go(button.dataset.page);return;}
  if(button.dataset.move){pageDirty=true;const row=button.closest('[data-setting-band]');if(button.dataset.move==='up'&&row.previousElementSibling)row.before(row.previousElementSibling);else if(button.dataset.move==='down'&&row.nextElementSibling)row.after(row.nextElementSibling);return;}
  if(button.dataset.removeBand){if(window.confirm('Remove this unused band type? If it has saved counts, keep it and turn Active off instead.')){button.closest('[data-setting-band]').remove();pageDirty=true;}return;}
  switch(button.dataset.action){
    case 'dismiss-security-reminder':dismissSecurityNudge(authSession);button.closest('.security-nudge')?.remove();{const heading=$('main h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}}break;
    case 'account':accountDialog(authSession.user,openModal,refreshSession);break;
    case 'logout':clearAllDrafts();await authRequest('/api/auth/logout',{method:'POST',body:{}});$('#modal').close();authSession=null;cloud=null;await start();break;
    case 'close':$('#modal').close();break;
    case 'full-backup':pendingAccessTab='backups';go('access');break;
    case 'add-band':pageDirty=true;$('#band-settings').insertAdjacentHTML('beforeend',bandSetting({id:uid(),name:'New band',color:'#b9d984',price:0,active:true}));break;
    case 'skip-content':$('#main-content')?.focus({preventScroll:false});break;
    case 'reload':if(!pageDirty||window.confirm('Discard unsaved changes and reload?'))location.reload();break;
  }
});
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=$('#modal').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('#modal').close();}});

async function openWorkspace(session){
  authSession=session;
  if(!session.authenticated){cloud=null;loginScreen(session,openWorkspace);return;}
  if(session.user.approval!=='approved'){cloud=null;approvalScreen(session,openWorkspace);return;}
  if(session.security?.enrollmentRequired){cloud=null;securityGate(session,openWorkspace,authRequest);return;}
  cloud=new CloudLedger();loadError='';
  data=validateBackup(await cloud.load());page=routePage()||landingPage();window.history.replaceState({},'','#/'+(routeNames[page]||page)+(location.hash.includes('?')?'?'+location.hash.split('?')[1]:''));render();
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')pollSession();});
async function pollSession(){
  if(syncBusy||!authSession?.authenticated||saving||document.visibilityState!=='visible'||document.querySelector('[data-security-sensitive]'))return;
  syncBusy=true;
  try{
    const previous=authSession,updated=await authRequest('/api/session');
    if(!updated.authenticated)clearAllDrafts();
    if(!updated.authenticated||updated.user.approval!==previous.user.approval||JSON.stringify(updated.permissions)!==JSON.stringify(previous.permissions)||JSON.stringify(updated.categories)!==JSON.stringify(previous.categories)||JSON.stringify(updated.roles)!==JSON.stringify(previous.roles)||JSON.stringify(updated.security)!==JSON.stringify(previous.security)){
      $('#modal').close();await openWorkspace(updated);return;
    }
    authSession=updated;
    if(updated.user.approval!=='approved'){
      if(updated.user.profileRevision!==previous.user.profileRevision)approvalScreen(updated,openWorkspace);
      return;
    }
    if(updated.user.profileRevision!==previous.user.profileRevision){const menu=document.querySelector('.account-menu');if(menu)menu.outerHTML=accountMenu(updated);}
    document.querySelectorAll('.request-nav-count').forEach(badge=>{badge.textContent=updated.pendingRequests||0;badge.hidden=!updated.pendingRequests;});
    const versions=updated.versions||{};let waiting=false;
    if(page==='settings'&&cloud&&Number.isSafeInteger(versions.workspace)&&versions.workspace!==cloud.revision){
      if(!canApplyRemote())waiting=true;
      else{
        const currentCloud=cloud,snapshot=await currentCloud.request('/api/ledger');
        if(currentCloud===cloud&&canApplyRemote()&&snapshot.revision>=currentCloud.revision){
          data=validateBackup(snapshot.data);currentCloud.revision=snapshot.revision;loadError='';render();
        }else waiting=true;
      }
    }
    const finance=$('#finance-panel');
    if(finance?.refreshFromServer&&(finance.seenRevision!==versions.workspace||finance.seenAccounts!==versions.accounts||finance.seenDay!==financeDay())){
      if(!canApplyRemote()||!await finance.refreshFromServer())waiting=true;
      else finance.seenAccounts=versions.accounts;
    }
    const requests=$('#requests-panel');
    if(requests?.refreshFromServer&&versions.requests!==requests.seenVersion){
      if(await requests.refreshFromServer())requests.seenVersion=versions.requests;
    }
    const access=$('#access-panel'),seen=access?.seenVersions||{};
    if(access?.refreshFromServer&&(seen.accounts!==versions.accounts||seen.access!==versions.access||(access.currentTab==='activity'&&seen.audit!==versions.audit))){
      if(!canApplyRemote())waiting=true;
      else if(await access.refreshFromServer(canApplyRemote))access.seenVersions={...versions};
      else waiting=true;
    }
    pollFailures=0;
    syncMessage(waiting?'New updates are available. Your edits are preserved. Finish or cancel editing to load the latest records.':'');
    mountReleaseNotice($('#release-status'),()=>!pageDirty&&!saving&&!$('#finance-panel')?.busy);
    if($('#connection-status')&&!loadError)$('#connection-status').textContent=storageLabel()+' · Updates connected';
  }catch{
    pollFailures=Math.min(pollFailures+1,4);
    syncMessage('Connection interrupted. Checking for updates again automatically.');
    if($('#connection-status'))$('#connection-status').textContent='Updates disconnected · retrying';
  }finally{syncBusy=false;}
}
let pollFailures=0;
async function schedulePoll(){await pollSession();setTimeout(schedulePoll,Math.min(30000,3000*2**pollFailures)+Math.floor(Math.random()*500));}
setTimeout(schedulePoll,3000);
window.addEventListener('focus',pollSession);
$('#modal').addEventListener('close',pollSession);
async function start() {
  $('#app').innerHTML='<div class="startup"><h1>PTO Band calculator</h1><p>Opening your workspace…</p></div>';
  try {
    const session=await authRequest('/api/session');
    if(!session.authenticated){loginScreen(session,openWorkspace);return;}
    await openWorkspace(session);
  }catch {
    $('#app').innerHTML='<div class="startup"><h1>Unable to open the workspace</h1><p>Check your connection, then try again.</p><button class="button primary" data-action="reload">Try again</button></div>';
  }
}
start();
