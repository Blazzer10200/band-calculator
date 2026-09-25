let installed='',available='',lastCheck=0;
export async function mountReleaseNotice(root,canReload){
  if(!root)return;
  if(['localhost','127.0.0.1'].includes(location.hostname)){root.textContent='Development preview';return;}
  const show=()=>{if(!root.isConnected)return;root.textContent='Release '+(installed||'development');if(available&&available!==installed){const b=document.createElement('button');b.className='button secondary';b.textContent='Update available · reload';b.onclick=()=>{if(canReload()||window.confirm('Reload the update and discard other unsaved forms? Saved band drafts will remain.'))location.reload();};root.append(b);}};
  show();
  if(Date.now()-lastCheck<30000)return;lastCheck=Date.now();
  try{const r=await fetch('./release.json?t='+Date.now(),{cache:'no-store'});if(!r.ok)return;const v=await r.json();if(typeof v.version!=='string')return;if(!installed)installed=document.querySelector('meta[name="pto-release"]')?.content||v.version;available=v.version;show();}catch{}
}
