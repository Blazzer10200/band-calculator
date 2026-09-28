// The parts of the Cloudflare backend that do not need the Workers runtime, so Node tests can cover them.
export const SITE_ORIGIN='https://blazzer10200.github.io';
export const SESSION_COOKIE='__Host-band_session';
// Workers Free allows about 10 ms of CPU per request, so passwords get lighter scrypt settings than the local server.
export const WORKER_HASH={N:4096,r:8,p:1};
// A Durable Object's SQLite, shaped like the slice of node:sqlite that api.mjs uses. It has no BEGIN/COMMIT: transactionSync instead.
export function durableStorage(storage){
  const {sql}=storage;
  const db={
    exec:query=>{sql.exec(query).toArray();},
    prepare:query=>({
      get:(...args)=>sql.exec(query,...args).toArray()[0],
      all:(...args)=>sql.exec(query,...args).toArray(),
      run:(...args)=>{sql.exec(query,...args).toArray();return {changes:sql.exec('SELECT changes() AS n').one().n};},
    }),
    close:()=>{},
  };
  return {db,transaction:work=>storage.transactionSync(work)};
}
function cors(response,site){
  if(site){
    response.headers.set('Access-Control-Allow-Origin',site);
    response.headers.set('Access-Control-Allow-Credentials','true');
    response.headers.set('Access-Control-Allow-Methods','GET, POST, PUT, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers','Content-Type, X-Bandbook-Request, Authorization');
    response.headers.set('Access-Control-Expose-Headers','X-PTO-Session, X-PTO-Remember');
    response.headers.set('Access-Control-Max-Age','600');
  }
  response.headers.append('Vary','Origin');
  return response;
}
// forward(request) runs api.mjs. The site lives on another origin, so this adapts the request and response around it.
// site is the one origin allowed to call; wrangler dev points it at the local Pages preview.
export async function edge(request,forward,site=SITE_ORIGIN){
  const url=new URL(request.url),trusted=request.headers.get('origin')===site;
  if(!url.pathname.startsWith('/api/'))return Response.redirect(SITE_ORIGIN+'/band-calculator/',302);
  if(request.method==='OPTIONS')return cors(new Response(null,{status:trusted?204:403}),trusted&&site);
  const headers=new Headers(request.headers);
  // api.mjs only takes changes from its own origin; the Pages site is the one other origin let through.
  if(trusted)headers.set('origin',url.origin);
  // Browsers that block cross-site cookies send the session token as a bearer header instead.
  // A cookie the browser kept wins: every tab shares it, so it is never older than a token one tab held on to.
  const bearer=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(headers.get('authorization')||'')?.[1];
  headers.delete('authorization');
  const hasCookie=(headers.get('cookie')||'').split(';').some(part=>part.trim().startsWith(SESSION_COOKIE+'=')&&part.trim().length>SESSION_COOKIE.length+1);
  if(bearer&&!hasCookie)headers.set('cookie',SESSION_COOKIE+'='+bearer);
  const response=await forward(new Request(request,{headers}));
  const result=new Response(response.body,response),cookie=response.headers.get('set-cookie');
  if(cookie){
    result.headers.set('Set-Cookie',cookie.replace('SameSite=Strict','SameSite=None; Secure; Partitioned'));
    result.headers.set('X-PTO-Session',/^[^=]+=([^;]*)/.exec(cookie)[1]||'signed-out');
    // "Keep me signed in" gave the cookie a lifetime; the page then keeps the token for this browser, not just this tab.
    if(Number(/;\s*Max-Age=(\d+)/i.exec(cookie)?.[1])>0)result.headers.set('X-PTO-Remember','1');
  }
  return cors(result,trusted&&site);
}
