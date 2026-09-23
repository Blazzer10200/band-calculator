import {sampleData} from './test-fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDevApi} from './dev-api.mjs';
import {base32,totp,matchingStep,encryptBackup,decryptBackup} from './security-crypto.mjs';
import {restoreSnapshot} from './backup-restore.mjs';
const origin='http://127.0.0.1:4173',password='Security-Test-Password-123',replacement='Replacement-Test-Password-456';
const request=(path,body,cookie='',method=body?'POST':'GET')=>new Request(origin+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{Origin:origin,'X-Bandbook-Request':'1','Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
const cookie=response=>response.headers.get('set-cookie')?.split(';')[0]||'';
async function fixture(t){let time=Date.now();const api=createDevApi({seed:sampleData(),now:()=>time});t.after(()=>api.close());const response=await api.handle(request('/api/auth/setup',{username:'owner',name:'Test Owner',password}));assert.equal(response.status,200);return {api,owner:cookie(response),tick:()=>time+=30000,now:()=>time};}
async function enroll(f,c=f.owner){const setup=await f.api.handle(request('/api/security/setup',{currentPassword:password},c));assert.equal(setup.status,200);const {secret,qr}=await setup.json();assert.match(qr,/^data:image\/svg\+xml;base64,/);const response=await f.api.handle(request('/api/security/confirm',{code:totp(secret,f.now())},c));assert.equal(response.status,200);return {secret,cookie:cookie(response),...(await response.json())};}
async function login(api,username='owner',pass=password){return api.handle(request('/api/auth/login',{username,password:pass}));}
test('TOTP matches RFC 6238 SHA-1 vectors and rejects invalid or replayed codes',()=>{
  const secret=base32(Buffer.from('12345678901234567890'));
  for(const [seconds,expected] of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']])assert.equal(totp(secret,seconds*1000,8),expected);
  const code=totp(secret,1234567890000),step=Math.floor(1234567890000/30000);assert.equal(matchingStep(secret,code,step,1234567890000),null);assert.equal(matchingStep(secret,'bad',-1,1234567890000),null);
});
test('concurrent login attempts are reserved and one username cannot lock out a different account',async t=>{
  const f=await fixture(t);
  await f.api.handle(request('/api/users',{name:'Member',username:'member',stateId:'10001',phone:'555-1001',password,roleIds:['member']},f.owner));
  const attempts=await Promise.all(Array.from({length:12},()=>login(f.api,'member','bad-password')));
  assert.ok(attempts.filter(r=>r.status===429).length>=4);
  assert.equal((await login(f.api,'member')).status,429);
  assert.equal((await login(f.api,'owner')).status,200);
  assert.ok(f.api.db.prepare('SELECT count(*) AS count FROM rate_limits').get().count>0);
  f.tick(); // limits remain active after one authenticator period
  assert.equal((await login(f.api,'member')).status,429);
});
test('enrollment encrypts the secret, revokes old sessions and requires a one-time MFA challenge',async t=>{
  const f=await fixture(t),enrolled=await enroll(f);
  const stored=f.api.db.prepare('SELECT secret FROM account_security').get().secret;assert.ok(!stored.includes(enrolled.secret));
  assert.equal((await f.api.handle(request('/api/ledger',undefined,f.owner))).status,401);
  const response=await login(f.api);assert.equal(cookie(response),'');const challenge=await response.json();assert.equal(challenge.mfaRequired,true);
  assert.equal((await f.api.handle(request('/api/auth/mfa',{challenge:challenge.challenge,code:totp(enrolled.secret,f.now())}))).status,401);
  f.tick();const signed=await f.api.handle(request('/api/auth/mfa',{challenge:challenge.challenge,code:totp(enrolled.secret,f.now())}));assert.equal(signed.status,200);
  assert.equal((await f.api.handle(request('/api/ledger',undefined,cookie(signed)))).status,200);
  f.tick();assert.equal((await f.api.handle(request('/api/auth/mfa',{challenge:challenge.challenge,code:totp(enrolled.secret,f.now())}))).status,401);
});
test('admin policy gates unenrolled administrators without blocking ordinary members or logout',async t=>{
  const f=await fixture(t);
  await f.api.handle(request('/api/users',{name:'Other Admin',username:'admin',stateId:'10002',phone:'555-1002',password,roleIds:['admin']},f.owner));
  await f.api.handle(request('/api/users',{name:'Member',username:'member',stateId:'10001',phone:'555-1001',password,roleIds:['member']},f.owner));
  assert.equal((await f.api.handle(request('/api/security/policy',{currentPassword:password,requireAdminMfa:true},f.owner))).status,400);
  const enrolled=await enroll(f);f.tick();
  assert.equal((await f.api.handle(request('/api/security/policy',{currentPassword:password,code:totp(enrolled.secret,f.now()),requireAdminMfa:true},enrolled.cookie))).status,200);
  const admin=await login(f.api,'admin'),adminCookie=cookie(admin),adminSession=await admin.json();assert.equal(adminSession.security.enrollmentRequired,true);
  for(const path of ['/api/ledger','/api/access','/api/requests','/api/audit'])assert.equal((await f.api.handle(request(path,undefined,adminCookie))).status,403);
  assert.equal((await f.api.handle(request('/api/security',undefined,adminCookie))).status,200);
  assert.equal((await f.api.handle(request('/api/auth/logout',{},adminCookie))).status,200);
  const member=await login(f.api,'member');assert.equal((await f.api.handle(request('/api/ledger',undefined,cookie(member)))).status,200);
});
test('recovery codes are hashed, reset credentials once, and revoke MFA and all sessions',async t=>{
  const f=await fixture(t),enrolled=await enroll(f);
  assert.equal(enrolled.recoveryCodes.length,8);assert.ok(!JSON.stringify(f.api.db.prepare('SELECT * FROM recovery_codes').all()).includes(enrolled.recoveryCodes[0]));
  const body={username:'owner',recoveryCode:enrolled.recoveryCodes[0],password:replacement};
  assert.equal((await f.api.handle(request('/api/auth/recover',{...body,recoveryCode:'not-a-code'}))).status,401);
  const simultaneous=await Promise.all([f.api.handle(request('/api/auth/recover',body)),f.api.handle(request('/api/auth/recover',body))]);assert.deepEqual(simultaneous.map(r=>r.status).sort(),[200,401]);
  assert.equal((await f.api.handle(request('/api/ledger',undefined,enrolled.cookie))).status,401);
  assert.equal((await f.api.handle(request('/api/auth/recover',{...body,recoveryCode:enrolled.recoveryCodes[1]}))).status,401);
  const fresh=await login(f.api,'owner',replacement);assert.equal(fresh.status,200);assert.equal((await fresh.json()).security.mfaEnabled,false);
});
test('remembered local login survives cookie-only reload and MFA, then expires or revokes',async t=>{
  const f=await fixture(t);
  const remembered=await f.api.handle(request('/api/auth/login',{username:'owner',password,remember:true}));assert.match(remembered.headers.get('set-cookie'),/HttpOnly; SameSite=Strict; Path=\/; Max-Age=2592000/);
  const c=cookie(remembered);assert.equal((await (await f.api.handle(request('/api/session',undefined,c))).json()).user.remembered,true);
  const enrolled=await enroll(f,c);assert.equal(enrolled.session.user.remembered,true);
  const response=await f.api.handle(request('/api/auth/login',{username:'owner',password,remember:true})),challenge=await response.json();f.tick();
  const signed=await f.api.handle(request('/api/auth/mfa',{challenge:challenge.challenge,code:totp(enrolled.secret,f.now())}));assert.equal(signed.status,200);assert.match(signed.headers.get('set-cookie'),/Max-Age=2592000/);
  assert.equal((await (await f.api.handle(request('/api/session',undefined,cookie(signed)))).json()).user.remembered,true);
  await f.api.handle(request('/api/auth/logout',{},cookie(signed)));assert.equal((await f.api.handle(request('/api/ledger',undefined,cookie(signed)))).status,401);
  f.api.db.prepare('UPDATE sessions SET expires=?').run(f.now()-1);assert.equal((await (await f.api.handle(request('/api/session',undefined,enrolled.cookie))).json()).authenticated,false);
});
test('expired MFA challenges cannot create sessions',async t=>{
  const f=await fixture(t),enrolled=await enroll(f),challenge=await (await login(f.api)).json();for(let i=0;i<11;i++)f.tick();
  assert.equal((await f.api.handle(request('/api/auth/mfa',{challenge:challenge.challenge,code:totp(enrolled.secret,f.now())}))).status,401);
});
test('complete encrypted backups restore users, MFA, policy, data and audit but never live sessions',async t=>{
  const f=await fixture(t),enrolled=await enroll(f);f.tick();
  await f.api.handle(request('/api/security/policy',{currentPassword:password,code:totp(enrolled.secret,f.now()),requireAdminMfa:true},enrolled.cookie));
  const snapshot=f.api.snapshot(),passphrase='Independent backup passphrase 123';
  const encrypted=await encryptBackup(snapshot,passphrase);assert.ok(!JSON.stringify(encrypted).includes('Test Owner'));assert.ok(!JSON.stringify(encrypted).includes(snapshot.key));
  await assert.rejects(decryptBackup(encrypted,'wrong passphrase'));
  const tampered={...encrypted,data:Buffer.from('bad ciphertext').toString('base64')};await assert.rejects(decryptBackup(tampered,passphrase));
  const restored=restoreSnapshot(await decryptBackup(encrypted,passphrase));t.after(()=>restored.close());
  assert.deepEqual(restored.snapshot().tables,snapshot.tables);
  assert.equal(restored.db.prepare('SELECT count(*) AS count FROM sessions').get().count,0);
  assert.equal((await (await login(restored)).json()).mfaRequired,true);
});
test('activity and full backups enforce permissions and never expose stored secrets in the activity feed',async t=>{
  const f=await fixture(t);
  await f.api.handle(request('/api/users',{name:'Member',username:'member',stateId:'10001',phone:'555-1001',password,roleIds:['member']},f.owner));
  const member=cookie(await login(f.api,'member'));
  assert.equal((await f.api.handle(request('/api/audit',undefined,member))).status,403);
  assert.equal((await f.api.handle(request('/api/security/backup',{currentPassword:password,passphrase:'long enough backup phrase'},member))).status,403);
  const audit=await (await f.api.handle(request('/api/audit',undefined,f.owner))).json();assert.ok(audit.events.length);assert.ok(audit.events.every(event=>!('document' in event)));
  const encrypted=await f.api.handle(request('/api/security/backup',{currentPassword:password,passphrase:'long enough backup phrase'},f.owner));assert.equal(encrypted.status,200);assert.equal((await encrypted.json()).format,'pto-encrypted-backup');
});
