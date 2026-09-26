import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {createApi} from './api.mjs';
import {clientFiles} from './client-files.mjs';
import {loadLocalKey,dailyBackup} from './local-security.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
await mkdir(path.join(root,'.local'),{recursive:true});
const key=await loadLocalKey(path.join(root,'.local'));
let backupHealth={enabled:true,savedAt:null,error:null};
const api=createApi({file:path.join(root,'.local','pto-dev.sqlite'),key,backupStatus:()=>backupHealth,cookieName:'pto_dev_session_4173'});
const saveBackup=()=>dailyBackup(api,key,path.join(root,'.local','backups')).then(result=>{backupHealth={enabled:true,...result,error:null};}).catch(()=>{backupHealth={...backupHealth,error:'Automatic backup failed. Contact the site operator and download a backup below.'};console.error('Automatic backup failed. Check the private backup directory.');});
await saveBackup();setInterval(saveBackup,60*60*1000).unref();
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.gif': 'image/gif', '.png': 'image/png', '.svg': 'image/svg+xml', '.gz': 'application/gzip' };
http.createServer(async (req, res) => {
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
  res.setHeader('X-Frame-Options','DENY');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  try {
    if(!['127.0.0.1:4173','localhost:4173'].includes(req.headers.host)){res.writeHead(403).end('Local development only.');return;}
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if(pathname.startsWith('/api/')){
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>950000){res.writeHead(413,{'Content-Type':'application/json'}).end('{"error":"Request too large."}');return;}chunks.push(chunk);}
      const request=new Request('http://'+req.headers.host+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
      const response=await api.handle(request,{remoteAddress:req.socket.remoteAddress});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    if(!clientFiles.includes(pathname==='/'?'index.html':pathname.slice(1))){res.writeHead(404).end();return;}
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root) || !types[path.extname(file)]) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('Not found'); }
}).listen(4173, '127.0.0.1', () => console.log('Band Calculator dev server ready at http://127.0.0.1:4173'));
