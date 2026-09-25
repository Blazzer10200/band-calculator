export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const timestamp=value=>new Date(value).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'});
export const dayLabel=value=>new Date(value+'T12:00:00').toLocaleDateString('en-US',{dateStyle:'medium'});
const uiPreferences=new Map();
export function readUiPreference(key){
  try{return localStorage.getItem('pto-ui:'+key)??uiPreferences.get(key)??null;}catch{return uiPreferences.get(key)??null;}
}
export function saveUiPreference(key,value){
  uiPreferences.set(key,String(value));
  try{localStorage.setItem('pto-ui:'+key,String(value));}catch{/* Preferences still work until this page closes. */}
}
export function uiIcon(name){
  const paths={chevron:'<path d="m6 9 6 6 6-6"/>',next:'<path d="m9 6 6 6-6 6"/>',settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',logout:'<path d="M10 5H5v14h5M10 12h11m-4-4 4 4-4 4"/>'};
  return `<svg class="ui-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]||paths.next}</svg>`;
}
export function revealContent(element){
  if(!element?.isConnected||!element.animate||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  element.getAnimations().filter(animation=>animation.id==='pto-content-reveal').forEach(animation=>animation.cancel());
  const animation=element.animate([{opacity:.55,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:180,easing:'cubic-bezier(.2,.7,.2,1)'});
  animation.id='pto-content-reveal';
}
export function downloadCsv(name,rows){
  const cell=v=>'"'+String(v??'').replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')+'"';
  const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
