// Built pages carry their settings in <meta> tags (build-client.mjs):
//   band-api        the accounts server on another origin (the Cloudflare Worker for GitHub Pages)
//   band-standalone no server at all; the app runs as a plain calculator
// With neither, the API is same-origin (the local dev server).
const meta=name=>globalThis.document?.querySelector(`meta[name="${name}"]`)?.content||'';
export const standalone=!!meta('band-standalone');
export const apiOrigin=meta('band-api');
// Browsers that block cross-site cookies still get a session: the Worker returns the token in X-PTO-Session,
// kept for this tab only and sent back as a bearer header.
const TOKEN_KEY='band-session';
const readToken=()=>{try{return sessionStorage.getItem(TOKEN_KEY)||'';}catch{return '';}};
const saveToken=token=>{try{token?sessionStorage.setItem(TOKEN_KEY,token):sessionStorage.removeItem(TOKEN_KEY);}catch{}};
export async function apiFetch(path,options={}){
  const headers=new Headers(options.headers);
  if(!apiOrigin)return fetch(path,{credentials:'same-origin',cache:'no-store',...options,headers});
  const token=readToken();if(token)headers.set('Authorization','Bearer '+token);
  const response=await fetch(apiOrigin+path,{credentials:'include',cache:'no-store',...options,headers});
  const next=response.headers.get('X-PTO-Session');
  if(next)saveToken(next==='signed-out'?'':next);
  else if(response.status===401&&token&&!path.startsWith('/api/auth/'))saveToken('');
  return response;
}
