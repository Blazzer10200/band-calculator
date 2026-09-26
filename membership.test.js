import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash,scryptSync} from 'node:crypto';
import {createDevApi} from './dev-api.mjs';
import {freshData,validateBackup} from './model.js';
import {restoreSnapshot} from './backup-restore.mjs';
import {identityInputs} from './profile-ui.js';

const password='Profile-test-password-98765',salt='ab'.repeat(16),passwordHash=salt+':'+scryptSync(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024}).toString('hex');
const digest=value=>createHash('sha256').update(value).digest('hex');
function fixture(t){
  const data=freshData();data.members=[{id:'legacy',name:'Old Character',callsign:'OLD-01',rank:'Leader',status:'inactive',joined:'2025-04-05',notes:'Keep these notes.'}];
  const api=createDevApi({seed:data}),tokens={};
  const config=JSON.parse(api.db.prepare('SELECT document FROM config').get().document);
  config.roles.push({id:'roster-manager',name:'Roster manager',color:'#4499ff',categories:{},pages:{roster:'manage',requests:'manage'}});
  api.db.prepare('UPDATE config SET document=?').run(JSON.stringify(config));
  for(const [id,owner,roles] of [['owner',1,[]],['admin',0,['admin']],['roster',0,['roster-manager']]]){
    api.db.prepare("INSERT INTO users(id,name,email,username,password,owner,roles,approval) VALUES(?,?,?,?,?,?,?,'approved')").run(id,id,id+'@pto.invalid',id,passwordHash,owner,JSON.stringify(roles));
    tokens[id]=randomBytes(32).toString('base64url');api.db.prepare('INSERT INTO sessions(hash,user_id,expires,mfa_verified) VALUES(?,?,?,0)').run(digest(tokens[id]),id,Date.now()+3600000);
  }
  const handle=req=>api.handle(req),origin='http://127.0.0.1:4173',snapshot=()=>api.snapshot();
  t.after(()=>api.close());
  const call=async(path,{body,method=body?'POST':'GET',as='admin'}={})=>{
    const token=tokens[as]||as;
    const req=new Request(origin+path,{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json','X-Bandbook-Request':'1'}:{}),...(token?{Cookie:'pto_session='+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const response=await handle(req),payload=await response.json();return {status:response.status,payload,token:response.headers.get('set-cookie')?.split(';')[0].slice(12)};
  };
  return {call,snapshot};
}
test(`membership contract: approval, identity sync, linking, permissions and stale edits`,async t=>{
  const {call,snapshot}=fixture(t);
  const fields={name:'New Character',username:'new.member',stateId:'01234',phone:'555-1234',password};
  for(const patch of [{stateId:'1234'},{stateId:12345},{stateId:'123456'},{phone:''}])assert.equal((await call('/api/auth/register',{body:{...fields,...patch},as:''})).status,400);
  const registered=await call('/api/auth/register',{body:fields,as:''});assert.equal(registered.status,200);const user=registered.payload.user;
  assert.equal(user.stateId,'01234');assert.equal(user.phone,'555-1234');assert.equal(user.password,undefined);
  assert.equal((await call('/api/profiles',{as:registered.token})).status,403);
  assert.equal((await call('/api/auth/register',{body:{...fields,username:'another'},as:''})).status,409);
  let roster=(await call('/api/ledger')).payload;
  const approval={decision:'approved',roleIds:['member'],profile:user,rank:'Prospect',revision:roster.revision};
  assert.equal((await call('/api/requests/'+user.id,{body:{...approval,rank:'Invented'}})).status,400);
  assert.equal((await call('/api/requests')).payload.requests[0].approval,'pending');
  assert.equal((await call('/api/ledger')).payload.revision,roster.revision);
  assert.equal((await call('/api/requests/'+user.id,{body:approval})).status,200);
  assert.equal((await call('/api/requests/'+user.id,{body:approval})).status,409);
  roster=(await call('/api/ledger')).payload;let linked=roster.data.members.find(m=>m.userId===user.id);
  assert.equal(linked.stateId,'01234');assert.equal(linked.rank,'Prospect');assert.equal(linked.profileRevision,1);
  assert.equal((await call('/api/profiles',{as:registered.token})).status,403);
  const edited={name:'Changed Character',username:'renamed.member',stateId:'00123',phone:'555-4321',profileRevision:1};
  assert.equal((await call('/api/profiles/'+user.id,{method:'PUT',body:{...edited,username:'ADMIN'}})).status,409);
  assert.equal((await call('/api/profiles/'+user.id,{method:'PUT',body:edited,as:'roster'})).status,403);
  assert.equal((await call('/api/profiles/owner',{method:'PUT',body:{...edited,profileRevision:0}})).status,403);
  assert.equal((await call('/api/profiles/'+user.id,{method:'PUT',body:edited})).status,200);
  assert.equal((await call('/api/profiles/'+user.id,{method:'PUT',body:edited})).status,409);
  assert.equal((await call('/api/auth/login',{body:{username:'new.member',password},as:''})).status,401);
  assert.equal((await call('/api/auth/login',{body:{username:'renamed.member',password},as:''})).status,200);
  roster=(await call('/api/ledger')).payload;linked=roster.data.members.find(m=>m.userId===user.id);
  assert.equal(linked.id,roster.data.members[1].id);assert.equal(linked.name,edited.name);assert.equal(linked.phone,edited.phone);assert.equal(linked.stateId,'00123');
  const changed={revision:roster.revision,rank:'Enforcer',status:'active',joined:linked.joined,notes:'New notes',profile:{...edited,name:'Roster Edit',profileRevision:2}};
  assert.equal((await call('/api/members/'+linked.id,{method:'PUT',body:changed,as:'roster'})).status,403);
  assert.equal((await call('/api/members/'+linked.id,{method:'PUT',body:changed})).status,200);
  assert.equal((await call('/api/members/'+linked.id,{method:'PUT',body:changed})).status,409);
  assert.equal((await call('/api/profiles')).payload.users.find(u=>u.id===user.id).name,'Roster Edit');
  roster=(await call('/api/ledger')).payload;
  const forged=structuredClone(roster);forged.data.members.find(m=>m.userId===user.id).username='forged.name';
  assert.equal((await call('/api/ledger',{method:'PUT',body:forged})).status,403);
  const removed=structuredClone(roster);removed.data.members=removed.data.members.filter(m=>m.userId!==user.id);
  assert.equal((await call('/api/ledger',{method:'PUT',body:removed})).status,403);
  assert.equal((await call('/api/members',{body:{userId:user.id,rank:'Member',revision:roster.revision,profileRevision:3}})).status,409);
  const existing=(await call('/api/profiles')).payload.users.find(u=>u.id==='roster');
  const link={userId:existing.id,profileRevision:0,memberId:'legacy',revision:roster.revision};
  assert.equal((await call('/api/members',{body:link})).status,200);
  const after=(await call('/api/ledger')).payload,legacy=after.data.members.find(m=>m.id==='legacy');
  assert.equal(legacy.userId,'roster');assert.equal(legacy.rank,'Leader');assert.equal(legacy.status,'inactive');assert.equal(legacy.notes,'Keep these notes.');assert.equal(legacy.joined,'2025-04-05');assert.equal(legacy.callsign,'OLD-01');
  assert.equal((await call('/api/members',{body:{...link,revision:after.revision}})).status,409);
  const applicant=await call('/api/auth/register',{body:{...fields,username:'reconsider',stateId:'00999'},as:''});assert.equal(applicant.status,200);
  assert.equal((await call('/api/profiles/'+user.id,{method:'PUT',body:{...edited,stateId:'00999',profileRevision:3}})).status,409);
  const requestPath='/api/requests/'+applicant.payload.user.id;
  assert.equal((await call(requestPath,{body:{decision:'denied'}})).status,200);
  assert.equal((await call(requestPath,{body:{decision:'reopen'},as:registered.token})).status,403);
  assert.equal((await call(requestPath,{body:{decision:'reopen'}})).status,200);
  assert.equal((await call('/api/ledger',{as:applicant.token})).status,403);
  assert.equal((await call(requestPath,{body:{decision:'reopen'}})).status,409);
  assert.equal((await call('/api/requests')).payload.requests.find(u=>u.id===applicant.payload.user.id).approval,'pending');
  const restored=restoreSnapshot(snapshot());t.after(()=>restored.close());
  assert.equal(restored.snapshot().tables.users.find(u=>u.id===user.id).stateId,'00123');
  assert.equal(JSON.parse(restored.snapshot().tables.workspace[0].document).members.find(m=>m.userId===user.id).name,'Roster Edit');
});

test(`live change markers follow requests, profiles, roster and audit`,async t=>{
  const {call}=fixture(t),versions=async()=>(await call('/api/session')).payload.versions;
  const initial=await versions();assert.deepEqual(await versions(),initial);
  const joined=await call('/api/auth/register',{as:'',body:{name:'Live Member',username:'live.member',stateId:'00007',phone:'555-0007',password}});
  const pending=await versions();assert.notEqual(pending.requests,initial.requests);assert.notEqual(pending.accounts,initial.accounts);assert.ok(pending.audit>initial.audit);assert.equal(pending.workspace,initial.workspace);
  assert.deepEqual((await call('/api/session',{as:joined.token})).payload.versions,{});
  assert.equal((await call('/api/requests/'+joined.payload.user.id,{body:{decision:'approved',roleIds:['member'],profile:joined.payload.user,rank:'Member',revision:initial.workspace}})).status,200);
  const approved=await versions();assert.notEqual(approved.requests,pending.requests);assert.equal(approved.workspace,pending.workspace+1);assert.ok(approved.audit>pending.audit);
  assert.equal((await call('/api/requests')).payload.requests.length,0);
  const memberSession=(await call('/api/session',{as:joined.token})).payload;assert.equal(memberSession.user.approval,'approved');assert.equal(memberSession.versions.accounts,null);assert.equal(memberSession.versions.audit,null);
  assert.equal((await call('/api/profiles/'+joined.payload.user.id,{method:'PUT',body:{...joined.payload.user,profileRevision:1,phone:'555-9999'}})).status,200);
  const edited=await versions();assert.notEqual(edited.accounts,approved.accounts);assert.equal(edited.workspace,approved.workspace+1);assert.ok(edited.audit>approved.audit);
  const activity=(await call('/api/audit')).payload;assert.match(JSON.stringify(activity),/phone/i);assert.doesNotMatch(JSON.stringify(activity),new RegExp(password));
});
test('profile UI preserves five-digit text IDs and escapes values; backups reject duplicate account links',()=>{
  const html=identityInputs('test',{name:'<script>',username:'abc',stateId:'00123',phone:'555-1234'});
  assert.match(html,/type="text" inputmode="numeric" pattern="\[0-9\]\{5\}"/);assert.match(html,/value="00123"/);assert.match(html,/&lt;script&gt;/);
  const data=freshData(),member={id:'one',name:'Member',username:'member',stateId:'00123',phone:'555-1234',userId:'account',profileRevision:0,rank:'Member',status:'active',joined:'2026-09-05',notes:''};
  data.members=[member,{...member,id:'two'}];assert.throws(()=>validateBackup(data),/duplicate linked account/);
});
