import {sampleData} from './test-fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDevApi} from './dev-api.mjs';

test('new workspaces start empty with the live band rates and no notes',()=>{
  const api=createDevApi();try{const data=JSON.parse(api.snapshot().tables.workspace[0].document);
    assert.deepEqual(data.members,[]);assert.deepEqual(data.contacts,[]);assert.deepEqual(data.purchases,[]);
    assert.ok(data.bands.length===6&&data.bands.every(b=>b.price>0));assert.equal(data.gangNotes,'');assert.equal(data.rosterLimit,0);
  }finally{api.close();}
});
const origin='http://127.0.0.1:4173',password='Development-Test-Password-123';
const request=(path,method='GET',body,cookie='',otherOrigin=origin)=>new Request(origin+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json',Origin:otherOrigin,'X-Bandbook-Request':'1'}:{})},...(body?{body:JSON.stringify(body)}:{})});
const token=response=>response.headers.get('set-cookie').split(';')[0];
async function ownerFixture(t){const api=createDevApi({seed:sampleData()});t.after(()=>api.close());const setup=await api.handle(request('/api/auth/setup','POST',{name:'Test Owner',email:'owner@example.test',password}));assert.equal(setup.status,200);return {api,ownerCookie:token(setup)};}
async function addMember(api,ownerCookie){const response=await api.handle(request('/api/users','POST',{name:'Test Member',email:'member@example.test',stateId:'10001',phone:'555-1001',password,roleIds:['member']},ownerCookie));assert.equal(response.status,201);const login=await api.handle(request('/api/auth/login','POST',{email:'member@example.test',stateId:'10001',phone:'555-1001',password}));assert.equal(login.status,200);return token(login);}
test('first Owner setup is single-use, passwords are hashed, and sessions are HttpOnly',async t=>{
  const {api,ownerCookie}=await ownerFixture(t);
  assert.equal((await api.handle(request('/api/auth/setup','POST',{name:'Other',email:'other@example.test',password}))).status,409);
  const stored=api.db.prepare('SELECT password FROM users').get().password;assert.notEqual(stored,password);assert.match(stored,/^[0-9a-f]+:[0-9a-f]+$/);
  assert.notEqual(api.db.prepare('SELECT hash FROM sessions').get().hash,ownerCookie.slice(12));
  const session=await (await api.handle(request('/api/session','GET',undefined,ownerCookie))).json();assert.equal(session.user.owner,true);assert.equal(session.permissions.access,'manage');
  const login=await api.handle(request('/api/auth/login','POST',{email:'owner@example.test',password}));assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
});
test('anonymous requests, forged privileges, and cross-origin writes are rejected',async t=>{
  const {api,ownerCookie}=await ownerFixture(t);assert.equal((await api.handle(request('/api/ledger'))).status,401);
  assert.equal((await api.handle(request('/api/users','POST',{name:'Fake',email:'fake@example.test',password,roleIds:['admin']},ownerCookie,'https://evil.test'))).status,403);
  const cookie=await addMember(api,ownerCookie);
  assert.equal((await api.handle(request('/api/access','GET',undefined,cookie))).status,403);
  const response=await api.handle(request('/api/ledger','GET',undefined,cookie));const visible=await response.json();assert.equal(visible.data.purchases.length,0);assert.equal(visible.data.contacts.length,0);
  visible.data.members=[];assert.equal((await api.handle(request('/api/ledger','PUT',visible,cookie))).status,403);
  assert.equal((await api.handle(request('/api/users','POST',{name:'Fake',email:'fake@example.test',password,owner:true,roleIds:['admin']},cookie))).status,403);
});
test('role changes take effect on existing sessions; disabled accounts and logout lose access',async t=>{
  const {api,ownerCookie}=await ownerFixture(t),cookie=await addMember(api,ownerCookie);
  const config=await (await api.handle(request('/api/access','GET',undefined,ownerCookie))).json();const member=config.users.find(u=>!u.owner);
  config.roles.find(r=>r.id==='member').categories.gang='none';assert.equal((await api.handle(request('/api/access','PUT',config,ownerCookie))).status,200);
  const restricted=await (await api.handle(request('/api/session','GET',undefined,cookie))).json();assert.equal(restricted.permissions.roster,'none');
  assert.equal((await api.handle(request('/api/users/'+member.id,'PUT',{roleIds:['member'],disabled:true,accessRevision:0},ownerCookie))).status,200);
  assert.equal((await api.handle(request('/api/ledger','GET',undefined,cookie))).status,401);
  await api.handle(request('/api/auth/logout','POST',{},ownerCookie));assert.equal((await api.handle(request('/api/ledger','GET',undefined,ownerCookie))).status,401);
});
test('Owner cannot be disabled and assigned roles cannot be removed',async t=>{
  const {api,ownerCookie}=await ownerFixture(t);await addMember(api,ownerCookie);
  const config=await (await api.handle(request('/api/access','GET',undefined,ownerCookie))).json();const owner=config.users.find(u=>u.owner);
  assert.equal((await api.handle(request('/api/users/'+owner.id,'PUT',{roleIds:[],disabled:true},ownerCookie))).status,400);
  assert.equal((await api.handle(request('/api/access','PUT',{...config,roles:config.roles.filter(r=>r.id!=='member')},ownerCookie))).status,400);
});
test('authorized edits persist and stale revisions cannot overwrite later saves',async t=>{
  const {api,ownerCookie}=await ownerFixture(t);const before=await (await api.handle(request('/api/ledger','GET',undefined,ownerCookie))).json();before.data.gangNotes='Meeting at 8';
  const saved=await api.handle(request('/api/ledger','PUT',before,ownerCookie));assert.equal(saved.status,200);
  assert.equal((await api.handle(request('/api/ledger','PUT',before,ownerCookie))).status,409);
  const after=await (await api.handle(request('/api/ledger','GET',undefined,ownerCookie))).json();assert.equal(after.data.gangNotes,'Meeting at 8');assert.equal(after.data.purchases.length,before.data.purchases.length);
});
test('password changes invalidate previous sessions and failed logins are rate limited',async t=>{
  const {api,ownerCookie}=await ownerFixture(t);
  const changed=await api.handle(request('/api/auth/password','POST',{currentPassword:password,password:'Another-Development-Password-456'},ownerCookie));assert.equal(changed.status,200);
  assert.equal((await api.handle(request('/api/ledger','GET',undefined,ownerCookie))).status,401);
  assert.equal((await api.handle(request('/api/ledger','GET',undefined,token(changed)))).status,200);
  for(let i=0;i<8;i++)assert.equal((await api.handle(request('/api/auth/login','POST',{email:'owner@example.test',password:'incorrect-password'}))).status,401);
  assert.equal((await api.handle(request('/api/auth/login','POST',{email:'owner@example.test',password:'incorrect-password'}))).status,429);
});
async function register(api,username='newplayer',extra={}){
  const response=await api.handle(request('/api/auth/register','POST',{username,name:'New Character',stateId:'01234',phone:'555-1234',password,...extra}));
  assert.equal(response.status,200);return {cookie:token(response),session:await response.json()};
}
test('self-registration cannot bypass approval or assign its own privileges',async t=>{
  const {api,ownerCookie}=await ownerFixture(t);
  const {cookie,session}=await register(api,'NewPlayer',{owner:true,approval:'approved',roleIds:['admin']});
  assert.equal(session.user.username,'newplayer');assert.equal(session.user.name,'New Character');
  assert.equal(session.user.owner,false);assert.equal(session.user.approval,'pending');assert.deepEqual(session.user.roleIds,[]);
  assert.ok(Object.values(session.permissions).every(level=>level==='none'));assert.deepEqual(session.categories,[]);
  for(const path of ['/api/ledger','/api/access','/api/requests'])assert.equal((await api.handle(request(path,'GET',undefined,cookie))).status,403);
  for(const [path,method,body] of [['/api/ledger','PUT',{}],['/api/access','PUT',{}],['/api/users','POST',{}],['/api/requests/'+session.user.id,'POST',{decision:'approved',roleIds:['admin']}],['/api/users/'+session.user.id,'PUT',{disabled:false,roleIds:['admin']}]])assert.equal((await api.handle(request(path,method,body,cookie))).status,403);
  const pendingLogin=await api.handle(request('/api/auth/login','POST',{username:'NEWPLAYER',password}));assert.equal(pendingLogin.status,200);assert.equal((await pendingLogin.json()).user.approval,'pending');
  const queue=await (await api.handle(request('/api/requests','GET',undefined,ownerCookie))).json();assert.equal(queue.requests.length,1);assert.equal(queue.requests[0].id,session.user.id);assert.equal(queue.requests[0].password,undefined);
  assert.equal((await (await api.handle(request('/api/session','GET',undefined,ownerCookie))).json()).pendingRequests,1);
  assert.equal((await api.handle(request('/api/users/'+session.user.id,'PUT',{roleIds:['admin'],disabled:false},ownerCookie))).status,400);
});
test('approval grants only selected roles and unlocks an existing pending session',async t=>{
  const {api,ownerCookie}=await ownerFixture(t),{cookie,session}=await register(api);
  const path='/api/requests/'+session.user.id;
  assert.equal((await api.handle(request(path,'POST',{decision:'approved',roleIds:[]},ownerCookie))).status,400);
  assert.equal((await api.handle(request(path,'POST',{decision:'approved',roleIds:['missing']},ownerCookie))).status,400);
  assert.equal((await api.handle(request(path,'POST',{decision:'approved',roleIds:['member'],profile:session.user,rank:'Prospect',revision:0},ownerCookie))).status,200);
  const current=await (await api.handle(request('/api/session','GET',undefined,cookie))).json();
  assert.equal(current.user.approval,'approved');assert.deepEqual(current.user.roleIds,['member']);assert.equal(current.permissions.roster,'view');assert.equal(current.permissions.ledger,'none');
  assert.equal((await api.handle(request('/api/ledger','GET',undefined,cookie))).status,200);
  assert.equal((await api.handle(request('/api/access','GET',undefined,cookie))).status,403);
  assert.equal((await (await api.handle(request('/api/session','GET',undefined,ownerCookie))).json()).pendingRequests,0);
  assert.equal((await api.handle(request(path,'POST',{decision:'denied'},ownerCookie))).status,409);
});
test('declined accounts stay locked out and ordinary members cannot review requests',async t=>{
  const {api,ownerCookie}=await ownerFixture(t),memberCookie=await addMember(api,ownerCookie),{cookie,session}=await register(api);
  const path='/api/requests/'+session.user.id;
  assert.equal((await api.handle(request(path,'POST',{decision:'approved',roleIds:['member']},memberCookie))).status,403);
  assert.equal((await api.handle(request(path,'POST',{decision:'denied'},ownerCookie))).status,200);
  assert.equal((await api.handle(request('/api/ledger','GET',undefined,cookie))).status,403);
  const login=await api.handle(request('/api/auth/login','POST',{username:'newplayer',password}));assert.equal(login.status,200);assert.equal((await login.json()).user.approval,'denied');
  assert.equal((await api.handle(request(path,'POST',{decision:'approved',roleIds:['member'],profile:session.user,rank:'Prospect',revision:0},ownerCookie))).status,409);
});
test('delegated reviewers can approve members without global administration but cannot escalate access',async t=>{
  const {api,ownerCookie}=await ownerFixture(t);
  const config=await (await api.handle(request('/api/access','GET',undefined,ownerCookie))).json();
  config.roles.push({id:'reviewer',name:'Recruiter',color:'#4499ff',categories:{},pages:{roster:'manage',requests:'manage',bands:'view'}});
  assert.equal((await api.handle(request('/api/access','PUT',config,ownerCookie))).status,200);
  assert.equal((await api.handle(request('/api/users','POST',{name:'Recruiter Character',username:'recruiter',stateId:'10002',phone:'555-1002',password,roleIds:['reviewer']},ownerCookie))).status,201);
  const login=await api.handle(request('/api/auth/login','POST',{username:'recruiter',password})),reviewerCookie=token(login);
  assert.equal((await api.handle(request('/api/access','GET',undefined,reviewerCookie))).status,403);
  const {session}=await register(api),path='/api/requests/'+session.user.id;
  const queue=await (await api.handle(request('/api/requests','GET',undefined,reviewerCookie))).json();assert.ok(queue.roles.some(role=>role.id==='member'));assert.ok(!queue.roles.some(role=>role.id==='admin'));
  assert.equal((await api.handle(request(path,'POST',{decision:'approved',roleIds:['admin']},reviewerCookie))).status,403);
  assert.equal((await api.handle(request(path,'POST',{decision:'approved',roleIds:['member'],profile:session.user,rank:'Prospect',revision:0},reviewerCookie))).status,200);
});
test('registration validates credentials and rejects case-insensitive duplicate usernames',async t=>{
  const {api}=await ownerFixture(t);await register(api);
  assert.equal((await api.handle(request('/api/auth/register','POST',{username:'NEWPLAYER',name:'Another Character',stateId:'01235',phone:'555-1235',password}))).status,409);
  for(const fields of [{username:'a'}, {username:'has spaces'}, {name:' '}, {password:'short'}])assert.equal((await api.handle(request('/api/auth/register','POST',{username:'validplayer',name:'Valid Character',stateId:'01235',phone:'555-1235',password,...fields}))).status,400);
  assert.equal(api.db.prepare('SELECT count(*) AS count FROM users').get().count,2);
});
