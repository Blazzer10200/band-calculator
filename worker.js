import {handleCloudApi,allowedOrigin,githubOrigin} from './cloud-api.mjs';
export const handleApi=handleCloudApi;
function cors(request,response){
  if(request.headers.get('origin')===githubOrigin){
    response.headers.set('Access-Control-Allow-Origin',githubOrigin);
    response.headers.set('Access-Control-Allow-Credentials','true');
    response.headers.set('Vary','Origin');
    response.headers.set('Access-Control-Allow-Methods','GET, POST, PUT, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers','Content-Type, X-Bandbook-Request, Authorization');
    response.headers.set('Access-Control-Expose-Headers','X-PTO-Session');
  }
  return response;
}
export default {async fetch(request,env){
  if(new URL(request.url).pathname.startsWith('/api/')){
    if(request.method==='OPTIONS')return cors(request,new Response(null,{status:allowedOrigin(request)?204:403}));
    return cors(request,await handleCloudApi(request,env));
  }
  const response=await env.ASSETS.fetch(request),secured=new Response(response.body,response);
  secured.headers.set('X-Content-Type-Options','nosniff');
  secured.headers.set('Referrer-Policy','no-referrer');
  secured.headers.set('X-Frame-Options','DENY');
  secured.headers.set('Cache-Control','no-cache');
  secured.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
  return secured;
}};
