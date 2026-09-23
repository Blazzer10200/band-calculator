import {revealContent} from './ui-utils.js';
import {installSelectMenus} from './select-ui.js';
import {clearAllDrafts} from './draft-store.js';
import {mountReleaseNotice} from './release-ui.js';
import {dayOf} from './calc-model.js';
import {mountCalculator} from './calculator-ui.js';
import {mountHistory} from './history-ui.js';
import {mountAdmin} from './admin-ui.js';
import {authRequest,loginScreen,accountDialog} from './auth-ui.js';
import {securityGate,securityNudge,dismissSecurityNudge} from './security-ui.js';
import {accountMenu,dismissAccountMenu} from './ui-shell.js';

const $=selector=>document.querySelector(selector);
installSelectMenus();
const icon=(name,size=20)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({calculator:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01"/>',history:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--panel)"/><circle cx="15" cy="17" r="3" fill="var(--panel)"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>'})[name]||''}</svg>`;
// One page per route. Guests only ever see the calculator; History needs an account, Admin needs the Owner.
const pages={calculator:{route:'#/',label:'Calculator',icon:'calculator',panel:'calc-panel'},history:{route:'#/history',label:'History',icon:'history',panel:'history-panel',signedIn:true},admin:{route:'#/admin',label:'Admin',icon:'settings',panel:'admin-panel',owner:true}};
let session=null,page='calculator',renderedPage='',pageDirty=false,syncBusy=false,pollFailures=0;
const signedIn=()=>!!session?.authenticated;
const allowed=id=>!!pages[id]&&(!pages[id].signedIn||signedIn())&&(!pages[id].owner||!!session?.user?.owner);
const routePage=()=>{const route=location.hash.split('?')[0]||'#/';const id=Object.keys(pages).find(k=>pages[k].route===route);return id&&allowed(id)?id:'calculator';};
const panel=()=>$('#'+pages[page].panel);
const hasOpenModal=()=>!!$('#modal')?.open;
const canApplyRemote=()=>!pageDirty&&!hasOpenModal()&&!panel()?.busy&&!$('.select-menu.is-open');
function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('visible'),4000);}
function syncMessage(message=''){const note=$('#live-sync-note');if(note){note.hidden=!message;note.textContent=message;}}
const storageLabel=()=>signedIn()?'Counts save to your account':'Calculator only · sign in to save counts';
document.addEventListener('click',dismissAccountMenu);
document.addEventListener('keydown',dismissAccountMenu);
document.addEventListener('focusin',dismissAccountMenu);
function go(next,replace=false){
  if(!allowed(next))next='calculator';
  if(panel()?.busy){toast('Hang on, still saving.');return;}
  if(next!==page&&pageDirty&&!window.confirm('Leave this page and discard your unsaved changes?')){history.replaceState({},'',pages[page].route);return;}
  page=next;history[replace?'replaceState':'pushState']({},'',pages[page].route);render();window.scrollTo({top:0});
}
function followRoute(){if(!session||session.security?.enrollmentRequired||!$('#main-content'))return;const target=routePage();if(target!==page)go(target,true);else if((location.hash.split('?')[0]||'#/')!==pages[page].route)history.replaceState({},'',pages[page].route);}
window.addEventListener('popstate',followRoute);
window.addEventListener('hashchange',followRoute);
window.addEventListener('beforeunload',e=>{if(pageDirty||panel()?.busy){e.preventDefault();e.returnValue='';}});
function header(){
  const nav=Object.keys(pages).filter(allowed);
  const right=signedIn()?accountMenu(session):'<div class="guest-actions"><button type="button" class="text-button" data-action="login">Sign in</button><button type="button" class="button primary" data-action="register">Create account</button></div>';
  return `<header class="simple-header finance-header"><div class="header-top"><a class="brand" href="#/" data-page="calculator"><img class="finance-logo" src="./pto-still.png" alt="" width="40" height="40"><span>PTO<small>Band calculator</small></span></a>${right}</div>${nav.length>1?`<nav class="finance-main-nav" aria-label="Main navigation">${nav.map(id=>`<a href="${pages[id].route}" data-page="${id}" class="simple-nav ${page===id?'active':''}" ${page===id?'aria-current="page"':''}>${icon(pages[id].icon,16)}<span>${pages[id].label}</span></a>`).join('')}</nav>`:''}</header>`;
}
function render(){
  if(!session||session.security?.enrollmentRequired)return;
  if(!allowed(page))page='calculator';
  pageDirty=false;
  const pageChanged=page!==renderedPage;renderedPage=page;
  $('#app').innerHTML=`<button type="button" class="skip-link" data-action="skip-content">Skip to content</button>${header()}<div class="simple-shell"><div class="workspace-content"><main id="main-content" tabindex="-1">${page==='admin'?securityNudge(session):''}<div id="live-sync-note" class="notice" role="status" hidden></div><div id="${pages[page].panel}"><p class="page-loading">Loading…</p></div></main></div><footer><span id="connection-status">${storageLabel()}</span><div class="footer-links"><button class="text-button" data-action="reload">Reload latest</button><span id="release-status"></span></div></footer></div>`;
  mountReleaseNotice($('#release-status'),()=>!pageDirty&&!panel()?.busy);
  const root=panel(),finish=()=>{if(pageChanged&&root.isConnected){revealContent($('main'));$('main').focus({preventScroll:true});}};
  const mounted=page==='calculator'?mountCalculator(root,session,{request:authRequest,canRefresh:canApplyRemote,onClean:()=>{},onSaved:kind=>toast({saved:'Count saved.',removed:'Count removed.',restored:'Count restored.',cashed:'Cashed out. The running total starts over.',undone:'Cash-out undone.'}[kind]||'Saved.')})
    :page==='history'?mountHistory(root,session,{request:authRequest})
    :mountAdmin(root,session,{request:authRequest,toast,onDirty:value=>{pageDirty=value;}});
  mounted.then(finish);
}
function openModal(html){$('#modal').innerHTML=`<button class="modal-close icon-button" data-action="close" aria-label="Close dialog">${icon('close')}</button>${html}`;if(!$('#modal').open)$('#modal').showModal();}
function showAuth(mode){if(pageDirty&&!window.confirm('Leave this page and discard your unsaved changes?'))return;loginScreen(session,openWorkspace,mode,()=>{renderedPage='';render();});}
document.addEventListener('click',async e=>{
  const button=e.target.closest('button,a');if(!button||!button.closest('#app,#modal'))return;
  if(button.dataset.page){e.preventDefault();go(button.dataset.page);return;}
  switch(button.dataset.action){
    case 'login':case 'register':e.preventDefault();showAuth(button.dataset.action);break;
    case 'dismiss-security-reminder':dismissSecurityNudge(session);button.closest('.security-nudge')?.remove();break;
    case 'account':accountDialog(session.user,openModal,refreshSession);break;
    case 'logout':
      if(pageDirty&&!window.confirm('Sign out and discard your unsaved changes?'))return;
      clearAllDrafts();try{await authRequest('/api/auth/logout',{method:'POST',body:{}});}catch(error){toast('Sign-out could not be confirmed: '+error.message);return;}
      $('#modal').close();await start();break;
    case 'close':$('#modal').close();break;
    case 'skip-content':$('#main-content')?.focus({preventScroll:false});break;
    case 'reload':if(!pageDirty||window.confirm('Discard unsaved changes and reload?'))location.reload();break;
  }
});
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=$('#modal').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('#modal').close();}});
async function refreshSession(){await openWorkspace(await authRequest('/api/session'));}
// Every sign-in path ends here with whatever the server said; ask again so the page always works from a full session.
async function openWorkspace(result){
  session=result?.versions?result:await authRequest('/api/session');
  if(!session.authenticated&&session.setupRequired){loginScreen(session,openWorkspace,'setup');return;}
  if(session.security?.enrollmentRequired){securityGate(session,openWorkspace,authRequest);return;}
  page=routePage();history.replaceState({},'',pages[page].route);renderedPage='';render();
}
async function pollSession(){
  if(syncBusy||!session||document.visibilityState!=='visible'||!$('#main-content')||document.querySelector('[data-security-sensitive]'))return;
  syncBusy=true;
  try{
    const previous=session,updated=await authRequest('/api/session');
    // Signed out elsewhere, disabled by the Owner, or a new security requirement: rebuild the page from scratch.
    if(updated.authenticated!==previous.authenticated||updated.user?.id!==previous.user?.id||updated.user?.owner!==previous.user?.owner||JSON.stringify(updated.security)!==JSON.stringify(previous.security)){
      if(previous.authenticated&&!updated.authenticated){clearAllDrafts();toast('You were signed out.');}
      $('#modal').close();await openWorkspace(updated);return;
    }
    session=updated;
    if(updated.user&&updated.user.name!==previous.user.name){const menu=$('.account-menu');if(menu&&!menu.open)menu.outerHTML=accountMenu(updated);}
    const root=panel(),v=updated.versions||{};let waiting=false;
    if(root?.refreshFromServer&&(root.seenPrices!==v.prices||(v.counts!==undefined&&root.seenCounts!==undefined&&root.seenCounts!==v.counts)||(root.seenDay!==undefined&&root.seenDay!==dayOf()))){
      if(!canApplyRemote()||!await root.refreshFromServer())waiting=true;
    }
    pollFailures=0;
    syncMessage(waiting?'New prices or counts are waiting. Your edits are kept; finish or cancel to load them.':'');
    mountReleaseNotice($('#release-status'),()=>!pageDirty&&!panel()?.busy);
    if($('#connection-status'))$('#connection-status').textContent=storageLabel();
  }catch{
    pollFailures=Math.min(pollFailures+1,4);
    syncMessage('Connection interrupted. Trying again automatically.');
    if($('#connection-status'))$('#connection-status').textContent='Offline · retrying';
  }finally{syncBusy=false;}
}
// A hidden tab only idles; coming back to it checks right away.
async function schedulePoll(){
  const awake=document.visibilityState==='visible';
  if(awake)await pollSession();
  setTimeout(schedulePoll,awake?Math.min(30000,(signedIn()?4000:10000)*2**pollFailures)+Math.floor(Math.random()*500):30000);
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')pollSession();});
window.addEventListener('focus',pollSession);
$('#modal').addEventListener('close',pollSession);
setTimeout(schedulePoll,4000);
async function start(){
  $('#app').innerHTML='<div class="startup"><h1>PTO Band calculator</h1><p>Loading…</p></div>';
  try{await openWorkspace(await authRequest('/api/session'));}
  catch{$('#app').innerHTML='<div class="startup"><h1>Unable to load the calculator</h1><p>Check your connection, then try again.</p><button class="button primary" data-action="reload">Try again</button></div>';}
}
start();
