// Built pages carry their settings in <meta> tags (build-client.mjs):
//   band-api        the accounts server on another origin (the Cloudflare Worker for GitHub Pages)
//   band-standalone no server at all; the app runs as a plain calculator
// With neither, the API is same-origin (the local dev server).
const meta=name=>globalThis.document?.querySelector(`meta[name="${name}"]`)?.content||'';
export const standalone=!!meta('band-standalone');
export const apiOrigin=meta('band-api');
// Browsers that block cross-site cookies still get a session: the Worker returns the token in X-PTO-Session and it is
// sent back as a bearer header. "Keep me signed in" (X-PTO-Remember) keeps it for this browser, otherwise this tab only.
const TOKEN_KEY='band-session';
const tab=()=>sessionStorage,browser=()=>localStorage;
const readToken=()=>{for(const store of [tab,browser])try{const token=store().getItem(TOKEN_KEY);if(token)return token;}catch{}return '';};
// A new token replaces whatever either store held.
const saveToken=(token,keep)=>{for(const store of [tab,browser])try{token&&store===(keep?browser:tab)?store().setItem(TOKEN_KEY,token):store().removeItem(TOKEN_KEY);}catch{}};
const forgetToken=token=>{for(const store of [tab,browser])try{if(store().getItem(TOKEN_KEY)===token)store().removeItem(TOKEN_KEY);}catch{}};
export async function apiFetch(path,options={}){
  const headers=new Headers(options.headers);
  if(!apiOrigin)return fetch(path,{credentials:'same-origin',cache:'no-store',...options,headers});
  const token=readToken();if(token)headers.set('Authorization','Bearer '+token);
  const response=await fetch(apiOrigin+path,{credentials:'include',cache:'no-store',...options,headers});
  const next=response.headers.get('X-PTO-Session');
  if(next)saveToken(next==='signed-out'?'':next,response.headers.get('X-PTO-Remember')==='1');
  else if(response.status===401&&token&&!path.startsWith('/api/auth/'))forgetToken(token);
  return response;
}
