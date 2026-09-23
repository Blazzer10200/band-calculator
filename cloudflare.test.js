import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,scryptSync} from 'node:crypto';
import {createApi,exportAccounts} from './api.mjs';
import {edge,durableStorage,SITE_ORIGIN,SESSION_COOKIE,WORKER_HASH} from './cloudflare-edge.mjs';
// Stands in for ctx.storage: exec(query,...bindings) returns a cursor, no BEGIN/COMMIT from callers.
function fakeStorage(){
  const d=new DatabaseSync(':memory:');
  const cursor=rows=>({toArray:()=>rows,one:()=>{assert.equal(rows.length,1);return rows[0];}});
  return {sql:{exec:(query,...args)=>{
    if(/^\s*BEGIN|^\s*COMMIT|^\s*ROLLBACK/i.test(query))throw Error('Durable Objects reject explicit transactions.');
    if(!args.length&&/;\s*\S/.test(query.trim())){d.exec(query);return cursor([]);}
    const statement=d.prepare(query);if(statement.columns().length)return cursor(statement.all(...args));statement.run(...args);return cursor([]);
  }},transactionSync:work=>{d.exec('BEGIN');try{const result=work();d.exec('COMMIT');return result;}catch(error){d.exec('ROLLBACK');throw error;}},raw:d};
}
function worker({seed=null,storage=fakeStorage()}={}){
  const api=createApi({storage:durableStorage(storage),key:randomBytes(32),local:false,cookieName:SESSION_COOKIE,hash:WORKER_HASH,setupCode:'open-sesame-42',seed});
  const call=(path,{method='GET',body,token,origin=SITE_ORIGIN}={})=>edge(new Request('https://band-calculator.example.workers.dev'+path,{method,headers:{...(origin?{origin}:{}),...(token?{authorization:'Bearer '+token}:{}),...(body?{'content-type':'application/json','x-bandbook-request':'1'}:{})},...(body?{body:JSON.stringify(body)}:{})}),request=>api.handle(request,{remoteAddress:'203.0.113.9'}));
  return {call,db:storage.raw,storage};
}
test('the Pages site can set up, sign in and save through the Worker',async()=>{
  const {call,db}=worker();
  const preflight=await call('/api/counts',{method:'OPTIONS'});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),SITE_ORIGIN);assert.equal(preflight.headers.get('access-control-allow-credentials'),'true');
  assert.equal((await call('/api/counts',{method:'OPTIONS',origin:'https://evil.example'})).status,403);
  const guest=await (await call('/api/session')).json();
  assert.equal(guest.setupRequired,true);assert.equal(guest.setupCode,true);assert.equal(guest.development,false);
  const owner={username:'blazzer',password:'correct horse battery',remember:true};
  const early=await call('/api/auth/register',{method:'POST',body:{username:'early.bird',password:'another long password'}});
  assert.equal(early.status,200);assert.equal((await early.json()).user.owner,false);
  assert.equal((await (await call('/api/session')).json()).setupRequired,true);
  assert.equal((await call('/api/auth/setup',{method:'POST',body:{...owner,setupCode:'wrong'}})).status,403);
  const setup=await call('/api/auth/setup',{method:'POST',body:{...owner,setupCode:'open-sesame-42'}});
  assert.equal(setup.status,200);
  assert.match(setup.headers.get('set-cookie'),new RegExp('^'+SESSION_COOKIE+'=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=None; Secure; Partitioned; Path=/; Max-Age=2592000$'));
  const token=setup.headers.get('x-pto-session');assert.match(token,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(setup.headers.get('access-control-expose-headers'),'X-PTO-Session');
  assert.match(db.prepare('SELECT password FROM users WHERE owner=1').get().password,/^s4096\.8\.1\$[0-9a-f]{32}:[0-9a-f]{128}$/);
  const me=await (await call('/api/me',{token})).json();
  assert.equal(me.bands.length,7);
  assert.equal((await call('/api/counts',{method:'POST',token,origin:'https://evil.example',body:{requestId:'count-0001',pricesRevision:me.pricesRevision,lines:[{id:'band-1',quantity:2}]}})).status,403);
  const saved=await call('/api/counts',{method:'POST',token,body:{requestId:'count-0001',pricesRevision:me.pricesRevision,lines:[{id:'band-1',quantity:2}]}});
  assert.equal(saved.status,201);assert.equal((await saved.json()).counts[0].total,20000);
  const cashout=await call('/api/cashouts',{method:'POST',token,body:{requestId:'cash-00001',expectedIds:['count-0001']}});
  assert.equal(cashout.status,201);assert.equal((await cashout.json()).cashouts[0].amount,20000);
  const logout=await call('/api/auth/logout',{method:'POST',token,body:{}});
  assert.equal(logout.headers.get('x-pto-session'),'signed-out');
  assert.equal((await call('/api/me',{token})).status,401);
  assert.equal((await call('/api/auth/login',{method:'POST',body:{...owner,password:'wrong password here'}})).status,401);
  const login=await call('/api/auth/login',{method:'POST',body:owner});
  assert.equal(login.status,200);assert.equal((await login.json()).user.owner,true);
  assert.equal((await call('/api/auth/setup',{method:'POST',body:{...owner,username:'second',setupCode:'open-sesame-42'}})).status,409);
});
test('passwords hashed with the original strong settings still sign in on the Worker',async()=>{
  const {call,db}=worker();
  await call('/api/auth/setup',{method:'POST',body:{username:'blazzer',password:'first password 1',setupCode:'open-sesame-42'}});
  const salt='ab'.repeat(16);db.prepare('UPDATE users SET password=?').run(salt+':'+scryptSync('older password 1',salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024}).toString('hex'));
  assert.equal((await call('/api/auth/login',{method:'POST',body:{username:'blazzer',password:'older password 1'}})).status,200);
});
test('accounts from a local server sign in on the Worker with their old passwords',async()=>{
  const local=createApi(),owner={username:'blazzer',password:'the old local password',remember:false};
  const post=(path,body,cookie='')=>local.handle(new Request('http://127.0.0.1'+path,{method:'POST',headers:{origin:'http://127.0.0.1','content-type':'application/json','x-bandbook-request':'1',cookie},body:JSON.stringify(body)}));
  const setup=await post('/api/auth/setup',owner),cookie=setup.headers.get('set-cookie').split(';')[0];
  assert.equal((await post('/api/counts',{requestId:'count-0001',pricesRevision:1,lines:[{id:'band-1',quantity:3}]},cookie)).status,201);
  const seed=exportAccounts(local.db);local.close();
  const {call,storage}=worker({seed});
  assert.equal((await (await call('/api/session')).json()).setupRequired,false);
  const login=await call('/api/auth/login',{method:'POST',body:owner});
  assert.equal(login.status,200);assert.equal((await login.json()).user.owner,true);
  const me=await (await call('/api/me',{token:login.headers.get('x-pto-session')})).json();
  assert.equal(me.counts[0].total,30000);assert.equal(me.bands.length,7);
  // A restart with the secret still set must not load it again over live accounts.
  worker({seed,storage});assert.equal(storage.raw.prepare('SELECT count(*) AS n FROM users').get().n,1);
  assert.throws(()=>worker({seed:{...seed,tables:{...seed.tables,users:[]}}}),/one Owner/);
});
test('adapter run() reports changed rows',()=>{
  const storage=fakeStorage(),{db}=durableStorage(storage);
  db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY); INSERT INTO t VALUES(1),(2);');
  assert.equal(db.prepare('DELETE FROM t WHERE id=?').run(1).changes,1);
  assert.equal(db.prepare('DELETE FROM t WHERE id=?').run(9).changes,0);
  assert.deepEqual(db.prepare('SELECT id FROM t').all().map(row=>row.id),[2]);
});
test('non-API paths send people to the site',async()=>{
  const response=await edge(new Request('https://band-calculator.example.workers.dev/'),()=>assert.fail('no API call'));
  assert.equal(response.status,302);assert.equal(response.headers.get('location'),SITE_ORIGIN+'/band-calculator/');
});
