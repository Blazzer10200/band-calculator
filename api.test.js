import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createApi,restoreSnapshot} from './api.mjs';
import {createDevApi} from './dev-api.mjs';

const origin='http://127.0.0.1:4173',password='Development-Test-Password-123';
const request=(route,method='GET',body,cookie='')=>new Request(origin+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json',Origin:origin,'X-Bandbook-Request':'1'}:{})},...(body?{body:JSON.stringify(body)}:{})});
const token=response=>response.headers.get('set-cookie').split(';')[0];
const id=()=>crypto.randomUUID();
async function call(api,route,method,body,cookie){const response=await api.handle(request(route,method,body,cookie));return {status:response.status,body:await response.json(),response};}
async function fixture(t){
  const api=createApi({cookieName:'pto_test'});t.after(()=>api.close());
  const owner=await api.handle(request('/api/auth/setup','POST',{username:'boss',password}));assert.equal(owner.status,200);
  const member=await api.handle(request('/api/auth/register','POST',{username:'Runner.One',password}));assert.equal(member.status,200);
  return {api,ownerCookie:token(owner),memberCookie:token(member)};
}
const countBody=(me,quantities,extra={})=>({requestId:id(),pricesRevision:me.pricesRevision,lines:me.bands.map((b,i)=>({id:b.id,quantity:quantities[i]||0})),notes:'',...extra});

test('guests can read prices and the session but nothing personal',async t=>{
  const {api}=await fixture(t);
  const session=await call(api,'/api/session');assert.equal(session.body.authenticated,false);assert.equal(session.body.setupRequired,false);assert.equal(session.body.versions.prices,1);
  const bands=await call(api,'/api/bands');assert.equal(bands.status,200);assert.equal(bands.body.bands.length,7);assert.ok(bands.body.bands.every(b=>b.price>0&&b.active));
  for(const [route,method,body] of [['/api/me','GET'],['/api/counts','POST',{requestId:id()}],['/api/admin/bands','GET'],['/api/admin/users','GET']])assert.equal((await call(api,route,method,body)).status,401);
});

test('sign-up is instant, usernames are unique, and members are not admins',async t=>{
  const {api,memberCookie}=await fixture(t);
  const session=await call(api,'/api/session','GET',undefined,memberCookie);
  assert.equal(session.body.user.username,'runner.one');assert.equal(session.body.user.owner,false);assert.equal(session.body.security.admin,false);
  assert.equal((await call(api,'/api/auth/register','POST',{username:'RUNNER.one',password})).status,409);
  assert.equal((await call(api,'/api/auth/register','POST',{username:'x',password})).status,400);
  assert.equal((await call(api,'/api/auth/register','POST',{username:'shorty',password:'short'})).status,400);
  assert.equal((await call(api,'/api/auth/setup','POST',{username:'second',password})).status,409);
});

test('only the Owner can change prices, and a stale count is refused after a change',async t=>{
  const {api,ownerCookie,memberCookie}=await fixture(t);
  const admin=await call(api,'/api/admin/bands','GET',undefined,ownerCookie);assert.equal(admin.status,200);
  const bands=admin.body.bands.map(({used,...b})=>b);bands[1]={...bands[1],price:12345};
  assert.equal((await call(api,'/api/admin/bands','PUT',{pricesRevision:1,bands},memberCookie)).status,403);
  const me=(await call(api,'/api/me','GET',undefined,memberCookie)).body;
  const saved=await call(api,'/api/admin/bands','PUT',{pricesRevision:1,bands},ownerCookie);assert.equal(saved.status,200);assert.equal(saved.body.pricesRevision,2);
  assert.equal((await call(api,'/api/admin/bands','PUT',{pricesRevision:1,bands},ownerCookie)).status,409);
  const stale=await call(api,'/api/counts','POST',countBody(me,[0,1]),memberCookie);assert.equal(stale.status,409);assert.equal(stale.body.pricesChanged,true);
  assert.equal((await call(api,'/api/bands')).body.bands[1].price,12345);
  assert.ok(api.db.prepare("SELECT action FROM audit WHERE action='Prices updated'").get());
});

test('bands in saved counts can be hidden but not deleted',async t=>{
  const {api,ownerCookie}=await fixture(t);
  const me=(await call(api,'/api/me','GET',undefined,ownerCookie)).body;
  assert.equal((await call(api,'/api/counts','POST',countBody(me,[4]),ownerCookie)).status,201);
  const bands=(await call(api,'/api/admin/bands','GET',undefined,ownerCookie)).body.bands.map(({used,...b})=>b);
  assert.equal((await call(api,'/api/admin/bands','PUT',{pricesRevision:1,bands:bands.slice(1)},ownerCookie)).status,400);
  const hidden=await call(api,'/api/admin/bands','PUT',{pricesRevision:1,bands:[{...bands[0],active:false},...bands.slice(1,5)]},ownerCookie);
  assert.equal(hidden.status,200);assert.equal(hidden.body.bands.length,5);
  assert.equal((await call(api,'/api/bands')).body.bands.length,4);
});

test('counts snapshot prices, are idempotent, private, and removable',async t=>{
  const {api,ownerCookie,memberCookie}=await fixture(t);
  const me=(await call(api,'/api/me','GET',undefined,memberCookie)).body,body=countBody(me,[2,3],{notes:' first run '});
  const first=await call(api,'/api/counts','POST',body,memberCookie);assert.equal(first.status,201);
  assert.equal(first.body.counts.length,1);assert.equal(first.body.counts[0].total,2*2500+3*10000);assert.equal(first.body.counts[0].notes,'first run');
  assert.deepEqual(first.body.counts[0].lines.map(l=>[l.id,l.quantity,l.price]),[['band-0',2,2500],['band-1',3,10000]]);
  assert.equal((await call(api,'/api/counts','POST',body,memberCookie)).body.counts.length,1);
  assert.equal((await call(api,'/api/counts','POST',body,ownerCookie)).status,400);
  assert.equal((await call(api,'/api/me','GET',undefined,ownerCookie)).body.counts.length,0);
  assert.equal((await call(api,'/api/counts','POST',countBody(me,[]),memberCookie)).status,400);
  assert.equal((await call(api,'/api/counts','POST',countBody(me,[1.5]),memberCookie)).status,400);
  const countId=first.body.counts[0].id;
  assert.equal((await call(api,`/api/counts/${countId}/remove`,'POST',{},ownerCookie)).status,404);
  assert.equal((await call(api,`/api/counts/${countId}/remove`,'POST',{},memberCookie)).body.counts.length,0);
  assert.equal((await call(api,`/api/counts/${countId}/restore`,'POST',{},memberCookie)).body.counts.length,1);
  const session=await call(api,'/api/session','GET',undefined,memberCookie);assert.equal(session.body.versions.counts,3);
});

test('cash-out closes open counts, checks what the screen saw, and only the latest can be undone',async t=>{
  const {api,memberCookie}=await fixture(t);
  let me=(await call(api,'/api/me','GET',undefined,memberCookie)).body;
  assert.equal((await call(api,'/api/cashouts','POST',{requestId:id(),expectedIds:[]},memberCookie)).status,409);
  me=(await call(api,'/api/counts','POST',countBody(me,[1]),memberCookie)).body;
  me=(await call(api,'/api/counts','POST',countBody(me,[0,1]),memberCookie)).body;
  assert.equal((await call(api,'/api/cashouts','POST',{requestId:id(),expectedIds:[me.counts[0].id]},memberCookie)).status,409);
  const first=await call(api,'/api/cashouts','POST',{requestId:id(),expectedIds:me.counts.map(c=>c.id)},memberCookie);
  assert.equal(first.status,201);assert.equal(first.body.cashouts[0].amount,12500);assert.ok(first.body.counts.every(c=>c.cashoutId===first.body.cashouts[0].id));
  assert.equal((await call(api,`/api/counts/${me.counts[0].id}/remove`,'POST',{},memberCookie)).status,409);
  me=(await call(api,'/api/counts','POST',countBody(first.body,[2]),memberCookie)).body;
  const second=await call(api,'/api/cashouts','POST',{requestId:id(),expectedIds:me.counts.filter(c=>!c.cashoutId).map(c=>c.id)},memberCookie);
  assert.equal(second.body.cashouts.length,2);
  assert.equal((await call(api,`/api/cashouts/${first.body.cashouts[0].id}/undo`,'POST',{},memberCookie)).status,409);
  const undone=await call(api,`/api/cashouts/${second.body.cashouts[0].id}/undo`,'POST',{},memberCookie);
  assert.equal(undone.status,200);assert.equal(undone.body.cashouts.length,1);assert.equal(undone.body.counts.filter(c=>!c.cashoutId).length,1);
});

test('the Owner can disable an account, which signs it out, and cannot disable itself',async t=>{
  const {api,ownerCookie,memberCookie}=await fixture(t);
  assert.equal((await call(api,'/api/admin/users','GET',undefined,memberCookie)).status,403);
  const users=(await call(api,'/api/admin/users','GET',undefined,ownerCookie)).body.users;assert.equal(users.length,2);
  const member=users.find(u=>!u.owner),owner=users.find(u=>u.owner);
  assert.equal((await call(api,'/api/admin/users/'+owner.id,'POST',{disabled:true},ownerCookie)).status,400);
  assert.equal((await call(api,'/api/admin/users/'+member.id,'POST',{disabled:true},ownerCookie)).status,200);
  assert.equal((await call(api,'/api/session','GET',undefined,memberCookie)).body.authenticated,false);
  assert.equal((await call(api,'/api/auth/login','POST',{username:'runner.one',password})).status,401);
  assert.equal((await call(api,'/api/admin/users/'+member.id,'POST',{disabled:false},ownerCookie)).status,200);
  assert.equal((await call(api,'/api/auth/login','POST',{username:'runner.one',password})).status,200);
});

test('cross-origin writes and non-local hosts are refused',async t=>{
  const {api,memberCookie}=await fixture(t);
  const forged=new Request(origin+'/api/counts',{method:'POST',headers:{Cookie:memberCookie,'Content-Type':'application/json',Origin:'http://evil.test','X-Bandbook-Request':'1'},body:'{}'});
  assert.equal((await api.handle(forged)).status,403);
  assert.equal((await api.handle(new Request('http://example.test/api/session'))).status,403);
});

test('an old roster database is imported once: prices, counts, cash-outs, and people',async t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'pto-import-')),open=[];
  t.after(()=>{for(const api of open)if(api.db.isOpen)api.close();rmSync(dir,{recursive:true,force:true});});
  const file=path.join(dir,'legacy.sqlite'),key=randomBytes(32);
  const legacy=createDevApi({file,key});
  const setup=await legacy.handle(request('/api/auth/setup','POST',{name:'Old Owner',username:'oldboss',password}));assert.equal(setup.status,200);
  const ownerId=legacy.db.prepare('SELECT id FROM users').get().id,stored=legacy.db.prepare('SELECT password FROM users').get().password;
  for(const [uid,name,approval] of [['u-pending','Waiting','pending'],['u-denied','Declined','denied']])legacy.db.prepare("INSERT INTO users(id,name,email,username,password,roles,approval) VALUES(?,?,?,?,?,'[]',?)").run(uid,name,uid+'@pto.invalid',uid,stored,approval);
  const doc=JSON.parse(legacy.db.prepare('SELECT document FROM workspace WHERE id=1').get().document);
  doc.bands[1].price=11111;doc.bands.push({id:'custom-band',name:'Green band',color:'#00ff00',price:5000,active:false});
  const line=(band,quantity)=>({id:band.id,name:band.name,color:band.color,price:band.price,quantity});
  doc.finance={version:1,startDate:'2026-09-03',deposits:[
    {id:'d-open',userId:ownerId,name:'Old Owner',at:'2026-09-10T10:00:00.000Z',lines:[line(doc.bands[0],4)],notes:'open',status:'pending'},
    {id:'d-paid',userId:ownerId,name:'Old Owner',at:'2026-09-09T10:00:00.000Z',lines:[line(doc.bands[1],2)],notes:'',status:'paid'},
    {id:'d-gone',userId:ownerId,name:'Old Owner',at:'2026-09-08T10:00:00.000Z',lines:[line(doc.bands[0],1)],notes:'',status:'withdrawn',reason:'oops',reviewedBy:ownerId,reviewedByName:'Old Owner',reviewedAt:'2026-09-08T11:00:00.000Z'},
    {id:'d-orphan',userId:'deleted-user',name:'Gone',at:'2026-09-08T10:00:00.000Z',lines:[line(doc.bands[0],1)],notes:'',status:'pending'}],
    payouts:[{id:'p-1',userId:ownerId,by:ownerId,byName:'Old Owner',at:'2026-09-09T12:00:00.000Z',amount:22222,entryIds:['d-paid']}],bills:[]};
  legacy.db.prepare('UPDATE workspace SET document=? WHERE id=1').run(JSON.stringify(doc));legacy.close();
  const api=createApi({file,key,cookieName:'pto_test'});open.push(api);
  const bands=(await call(api,'/api/bands')).body;assert.equal(bands.bands.length,6);assert.equal(bands.bands[1].price,11111);
  const login=await api.handle(request('/api/auth/login','POST',{username:'oldboss',password}));assert.equal(login.status,200);
  const me=(await call(api,'/api/me','GET',undefined,token(login))).body;
  assert.deepEqual(me.counts.map(c=>[c.id,c.cashoutId]),[['d-open',null],['d-paid','p-1']]);
  assert.deepEqual(me.cashouts.map(c=>[c.id,c.amount]),[['p-1',22222]]);
  assert.equal(api.db.prepare("SELECT removed_at FROM counts WHERE id='d-gone'").get().removed_at,'2026-09-08T11:00:00.000Z');
  assert.equal(api.db.prepare("SELECT id FROM counts WHERE id='d-orphan'").get(),undefined);
  assert.deepEqual(api.db.prepare("SELECT id,approval,disabled FROM users WHERE id LIKE 'u-%' ORDER BY id").all().map(u=>({...u})),[{id:'u-denied',approval:'approved',disabled:1},{id:'u-pending',approval:'approved',disabled:0}]);
  api.db.prepare("UPDATE bands SET price=1 WHERE id='band-0'").run();api.close();
  const reopened=createApi({file,key});open.push(reopened);
  assert.equal(reopened.db.prepare("SELECT price FROM bands WHERE id='band-0'").get().price,1,'import runs once');
});

test('a snapshot restores into a fresh database with logins and history intact',async t=>{
  const {api,memberCookie}=await fixture(t);
  const me=(await call(api,'/api/me','GET',undefined,memberCookie)).body;
  await call(api,'/api/counts','POST',countBody(me,[0,0,1]),memberCookie);
  const restored=restoreSnapshot(JSON.parse(JSON.stringify(api.snapshot())),{cookieName:'pto_test'});t.after(()=>restored.close());
  const login=await restored.handle(request('/api/auth/login','POST',{username:'runner.one',password}));assert.equal(login.status,200);
  const after=(await call(restored,'/api/me','GET',undefined,token(login))).body;assert.equal(after.counts.length,1);assert.equal(after.counts[0].total,150000);
  assert.throws(()=>restoreSnapshot({...api.snapshot(),format:'pto-full-backup'}),/Unsupported backup/);
});
