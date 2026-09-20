import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {scryptSync} from 'node:crypto';
import {createDevApi} from '../dev-api.mjs';
import {clientFiles} from '../client-files.mjs';
import {sampleData} from '../test-fixtures.js';
const port=Number(process.argv.find(a=>a.startsWith('--port='))?.slice(7)||4174);
if(!Number.isInteger(port)||port<4174||port>4199)throw Error('Sample port must be between 4174 and 4199.');
const data=sampleData();data.contacts=[];data.purchases=[];data.gangNotes='';
data.members=[{id:'qa-legacy',name:'QA Existing Character',callsign:'OLD',rank:'Enforcer',status:'active',joined:'2026-08-01',notes:'Preserved linking notes.'}];
const api=createDevApi({seed:data,cookieName:`pto_dev_session_${port}`}),salt='cd'.repeat(16),password=salt+':'+scryptSync('Local-QA-password-123',salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024}).toString('hex');
for(const [id,name,owner,approval,stateId] of [['qa.admin','QA Administrator',1,'approved','00001'],['qa.existing','Rocco Moretti',0,'approved','00002'],['qa.applicant','QA Applicant',0,'pending','00003'],['qa.treasurer','QA Treasurer',0,'approved','00004']])api.db.prepare('INSERT INTO users(id,name,email,username,password,owner,roles,approval,stateId,phone,requested_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,name,id+'@pto.invalid',id,password,owner,owner?'[]':id==='qa.treasurer'?'["treasurer"]':'["member"]',approval,stateId,'555-000'+stateId.at(-1),new Date().toISOString());
const qaWorkspace=JSON.parse(api.db.prepare('SELECT document FROM workspace WHERE id=1').get().document);
qaWorkspace.finance={version:1,startDate:'2026-09-03',deposits:[{id:'qa-layout-deposit-1',userId:'qa.existing',name:'Rocco Moretti',at:new Date().toISOString(),lines:qaWorkspace.bands.map(b=>({...b,quantity:2000})),notes:'A long receipt note to make sure details stay inside their card. '+('Receipt details '.repeat(20)),status:'pending'}],payouts:[],bills:[]};
qaWorkspace.hub={events:[{id:'qa-event',title:'Thursday gang meeting and treasury collection',at:'2026-09-10T23:00:00Z',location:'The main gang house and treasury office',notes:'Bring your recorded stash for verification.',responses:{},by:'qa.admin'}],availability:[],notes:{},reads:{}};
api.db.prepare('UPDATE workspace SET document=?,revision=revision+1 WHERE id=1').run(JSON.stringify(qaWorkspace));
const types={html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',gif:'image/gif',gz:'application/gzip'};
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
}).listen(port,'127.0.0.1',()=>console.log('Sample PTO preview: http://127.0.0.1:'+port+'/ — fabricated records, memory only.'));
