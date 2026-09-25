import {uiIcon} from './ui-utils.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function accountMenu(session){
  const user=session.user,initials=user.name.trim().split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase();
  const role=user.owner?'Owner':'Member',first=user.name.trim().split(/\s+/)[0];
  return `<details class="account-menu"><summary aria-label="Account menu for ${esc(user.name)}"><span class="account-avatar" aria-hidden="true">${esc(initials)}</span><span class="account-identity" aria-hidden="true">${esc(first)}</span></summary><div class="account-popover"><div class="account-meta"><strong>${esc(user.name)}</strong><span>@${esc(user.username)}</span><small>${role}</small></div><button type="button" data-action="account">${uiIcon('settings')}<span>Account settings</span></button><button type="button" data-action="logout">${uiIcon('logout')}<span>Sign out</span></button></div></details>`;
}
// Native disclosure behavior supports keyboard activation; dismiss without trapping focus.
export function dismissAccountMenu(event){
  const menu=document.querySelector('.account-menu[open]');if(!menu)return;
  if(event.type==='keydown'&&event.key==='Escape'){menu.open=false;menu.querySelector('summary').focus();}
  if(event.type==='click'&&(!menu.contains(event.target)||event.target.closest('[data-action]')))menu.open=false;
  if(event.type==='focusin'&&!menu.contains(event.target))menu.open=false;
}
