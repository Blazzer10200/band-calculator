import {DurableObject} from 'cloudflare:workers';
import {Buffer} from 'node:buffer';
import {createApi} from './api.mjs';
import {edge,durableStorage,SESSION_COOKIE,WORKER_HASH} from './cloudflare-edge.mjs';
// Accounts for the GitHub Pages site. Every request goes to one Durable Object that owns the SQLite database.
export class BandStore extends DurableObject{
  constructor(ctx,env){
    super(ctx,env);
    const key=Buffer.from(env.BAND_KEY||'','base64');
    if(key.length!==32)throw Error('The BAND_KEY secret must be 32 bytes, base64.');
    if(!env.SETUP_CODE)throw Error('The SETUP_CODE secret is missing.');
    this.api=createApi({storage:durableStorage(ctx.storage),key,local:false,cookieName:SESSION_COOKIE,hash:WORKER_HASH,setupCode:env.SETUP_CODE});
  }
  fetch(request){return this.api.handle(request,{remoteAddress:request.headers.get('cf-connecting-ip')||'unknown'});}
}
export default {fetch:(request,env)=>edge(request,forwarded=>env.BANDS.get(env.BANDS.idFromName('main')).fetch(forwarded),env.SITE_ORIGIN||undefined)};
