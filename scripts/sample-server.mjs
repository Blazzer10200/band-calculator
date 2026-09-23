import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {scryptSync} from 'node:crypto';
import {createApi} from '../api.mjs';
import {clientFiles} from '../client-files.mjs';
const port=Number(process.argv.find(a=>a.startsWith('--port='))?.slice(7)||4174);
if(!Number.isInteger(port)||port<4174||port>4199)throw Error('Sample port must be between 4174 and 4199.');
// In memory only: fabricated accounts and two weeks of fabricated counts.
const api=createApi({cookieName:`pto_dev_session_${port}`}),salt='cd'.repeat(16),password=salt+':'+scryptSync('Local-QA-password-123',salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024}).toString('hex');
const joined=new Date(Date.now()-20*86400000).toISOString();
for(const [id,name,owner] of [['qa.admin','QA Owner',1],['qa.existing','Rocco Moretti',0],['qa.fresh','QA Newcomer',0]])api.db.prepare("INSERT INTO users(id,name,email,username,password,owner,roles,approval,requested_at) VALUES(?,?,?,?,?,?,'[]','approved',?)").run(id,name,id+'@pto.invalid',id,password,owner,joined);
const bands=api.db.prepare('SELECT * FROM bands ORDER BY position').all();
let seed=7;const rand=n=>(seed=(seed*16807)%2147483647)%n;
for(const user of ['qa.admin','qa.existing']){
  let cashout=null,open=[];
  for(let day=14;day>=0;day--){
    for(let k=rand(3);k>0;k--){
      const lines=bands.filter(()=>rand(3)===0).map(b=>({id:b.id,name:b.name,color:b.color,price:b.price,quantity:1+rand(b.price>500000?4:40)}));if(!lines.length)continue;
      const at=new Date(Date.now()-day*86400000-rand(36000000)).toISOString(),id=crypto.randomUUID();
      api.db.prepare('INSERT INTO counts VALUES(?,?,?,?,?,?,NULL,NULL)').run(id,user,at,JSON.stringify(lines),lines.reduce((n,l)=>n+l.quantity*l.price,0),rand(4)===0?'Run with the crew':'');open.push(id);
    }
    if(day%6===3&&open.length){cashout=crypto.randomUUID();const at=new Date(Date.now()-day*86400000+3600000).toISOString();
      api.db.prepare('INSERT INTO cashouts VALUES(?,?,?,(SELECT sum(total) FROM counts WHERE id IN ('+open.map(()=>'?').join(',')+')),NULL)').run(cashout,user,at,...open);
      api.db.prepare('UPDATE counts SET cashout_id=? WHERE id IN ('+open.map(()=>'?').join(',')+')').run(cashout,...open);open=[];}
  }
}
const types={html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',svg:'image/svg+xml',gif:'image/gif',gz:'application/gzip'};
http.createServer(async(req,res)=>{
  try{
    if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)){res.writeHead(403).end('Loopback preview only.');return;}
    const url=new URL(req.url,'http://'+req.headers.host);
    if(url.pathname.startsWith('/api/')){
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>950000){res.writeHead(413).end('Request too large.');return;}chunks.push(chunk);}
      const response=await api.handle(new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})}));
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    const name=url.pathname==='/'?'index.html':url.pathname.slice(1);if(!clientFiles.includes(name)){res.writeHead(404).end();return;}
    res.writeHead(200,{'Content-Type':types[name.split('.').at(-1)]||'application/octet-stream','Cache-Control':'no-store'});res.end(await readFile(new URL('../'+name,import.meta.url)));
  }catch(error){res.writeHead(500).end('QA preview error');}
}).listen(port,'127.0.0.1',()=>console.log('Band Calculator sample preview: http://127.0.0.1:'+port+'/ — fabricated records, memory only.'));
