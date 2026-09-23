import {auditDocument} from './audit-details.js';
import {randomBytes,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {Buffer} from 'node:buffer';
import {createSecurity,securitySchema,failure} from './security-store.mjs';
import {unseal} from './security-crypto.mjs';
import {DEFAULT_BANDS,cleanBands,dayOf,MAX_QTY,MAX_TOTAL} from './calc-model.js';
// Calculator backend: public prices, instant accounts, per-user counts and cash-outs, Owner-only prices.
// Runs on Node (node:sqlite) or inside a Cloudflare Durable Object, which passes its own db and transaction.
const scrypt=promisify(scryptCallback),digest=value=>createHash('sha256').update(value).digest('hex');
const json=(body,status=200,headers={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const publicUser=user=>({id:user.id,name:user.name,username:user.username,owner:!!user.owner,disabled:!!user.disabled,approval:user.approval,createdAt:user.requested_at||null,mfaVerified:!!user.mfa_verified,remembered:!!user.session_remember});
// Untagged hashes use the original strong settings. Lighter settings (Cloudflare's free CPU budget) are tagged "sN.r.p$" so either verifies.
const STRONG_HASH={N:32768,r:8,p:3},HASH_TAG=/^s(\d{1,5})\.(\d{1,2})\.(\d{1,2})\$/;
export const PASSWORD_HASH=/^(s\d{1,5}\.\d{1,2}\.\d{1,2}\$)?[0-9a-f]{32}:[0-9a-f]{128}$/;
function passwords({N,r,p}=STRONG_HASH){
  const prefix=N===STRONG_HASH.N&&r===STRONG_HASH.r&&p===STRONG_HASH.p?'':`s${N}.${r}.${p}$`;
  const derive=async(password,salt,params)=>Buffer.from(await scrypt(password,salt,64,{...params,maxmem:64*1024*1024}));
  const hashPassword=async(password,salt=randomBytes(16).toString('hex'))=>prefix+salt+':'+(await derive(password,salt,{N,r,p})).toString('hex');
  async function verifyPassword(password,stored){
    const tag=stored.match(HASH_TAG),[salt,hash]=stored.slice(tag?tag[0].length:0).split(':');
    if(tag&&Number(tag[1])>STRONG_HASH.N)return false;
    return timingSafeEqual(await derive(password,salt,tag?{N:Number(tag[1]),r:Number(tag[2]),p:Number(tag[3])}:STRONG_HASH),Buffer.from(hash,'hex'));
  }
  // Unknown usernames still pay for one hash at the current settings, so timing does not reveal which names exist.
  return {hashPassword,verifyPassword,decoy:prefix+'0'.repeat(32)+':'+'00'.repeat(64)};
}
const validatePassword=value=>{if(typeof value!=='string'||value.length<12||value.length>128)throw Error('Use a password between 12 and 128 characters.');};
const validUsername=body=>{const username=typeof body.username==='string'?body.username.trim().toLowerCase():'';if(!/^[a-z0-9_.-]{3,32}$/.test(username))throw Error('Pick a username of 3–32 letters, numbers, dots, underscores, or hyphens.');return username;};
const validName=value=>{const name=typeof value==='string'?value.trim():'';if(!name||name.length>60)throw Error('Use a display name of up to 60 characters.');return name;};
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{8,80}$/.test(value);
const USER_COLUMNS='id,name,email,password,owner,disabled,roles,username,approval,requested_at';
const TABLES=['users','audit','account_security','recovery_codes','security_policy','meta','bands','counts','cashouts','revisions'];
function schema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,owner INTEGER NOT NULL DEFAULT 0,disabled INTEGER NOT NULL DEFAULT 0,roles TEXT NOT NULL DEFAULT '[]');
    CREATE UNIQUE INDEX IF NOT EXISTS one_owner ON users(owner) WHERE owner=1;
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at TEXT NOT NULL,user_id TEXT NOT NULL,action TEXT NOT NULL,document TEXT);
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS bands(id TEXT PRIMARY KEY,name TEXT NOT NULL,color TEXT NOT NULL,price INTEGER NOT NULL,active INTEGER NOT NULL,position INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS counts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),at TEXT NOT NULL,lines TEXT NOT NULL,total INTEGER NOT NULL,notes TEXT NOT NULL DEFAULT '',cashout_id TEXT,removed_at TEXT);
    CREATE INDEX IF NOT EXISTS counts_user ON counts(user_id,at);
    CREATE TABLE IF NOT EXISTS cashouts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),at TEXT NOT NULL,amount INTEGER NOT NULL,undone_at TEXT);
    CREATE TABLE IF NOT EXISTS revisions(user_id TEXT PRIMARY KEY,n INTEGER NOT NULL);`);
  // Additive: databases made by the old roster backend already have these.
  const columns=new Set(db.prepare('PRAGMA table_info(users)').all().map(c=>c.name));
  for(const [name,type] of Object.entries({username:'TEXT',approval:"TEXT NOT NULL DEFAULT 'approved'",requested_at:'TEXT'}))if(!columns.has(name))db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS unique_username ON users(username COLLATE NOCASE)');
  securitySchema(db);
}
// One time: copy prices and deposits out of the old single-document workspace. Old tables stay untouched.
function importLegacy(db,seedBands,tx){
  if(db.prepare("SELECT value FROM meta WHERE key='import_v1'").get())return;
  const hasWorkspace=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workspace'").get();
  const doc=hasWorkspace?JSON.parse(db.prepare('SELECT document FROM workspace WHERE id=1').get()?.document||'null'):null;
  tx(()=>{
    const bands=Array.isArray(doc?.bands)&&doc.bands.length?doc.bands:seedBands;
    if(!db.prepare('SELECT id FROM bands LIMIT 1').get())bands.forEach((b,i)=>db.prepare('INSERT INTO bands VALUES(?,?,?,?,?,?)').run(b.id,b.name,b.color.toLowerCase(),b.price,Number(b.active!==false),i));
    const finance=doc?.finance,users=new Set(db.prepare('SELECT id FROM users').all().map(u=>u.id));
    if(finance){
      const reversed=new Set((finance.reversals||[]).map(r=>r.recordId)),payouts=(finance.payouts||[]).filter(p=>!reversed.has(p.id)&&users.has(p.userId));
      const paidBy=new Map();for(const p of [...payouts].sort((a,b)=>a.at.localeCompare(b.at)))for(const id of p.entryIds)paidBy.set(id,p.id);
      const linked=new Map();
      for(const e of finance.deposits||[]){
        if(!users.has(e.userId))continue;
        const lines=e.lines.map(({id,name,color,price,quantity})=>({id,name,color,price,quantity})),total=lines.reduce((n,l)=>n+l.quantity*l.price,0);
        const cashout=e.status==='paid'?paidBy.get(e.id)||null:null,removed=['withdrawn','rejected'].includes(e.status)?e.reviewedAt||e.at:null;
        db.prepare('INSERT OR IGNORE INTO counts VALUES(?,?,?,?,?,?,?,?)').run(e.id,e.userId,e.at,JSON.stringify(lines),total,e.notes||'',cashout,removed);
        if(cashout)linked.set(cashout,(linked.get(cashout)||0)+total);
      }
      for(const p of payouts)if(linked.get(p.id))db.prepare('INSERT OR IGNORE INTO cashouts VALUES(?,?,?,?,NULL)').run(p.id,p.userId,p.at,linked.get(p.id));
    }
    // Sign-ups are instant now: waiting requests open up, declined ones stay locked out.
    db.exec("UPDATE users SET disabled=1,approval='approved' WHERE approval='denied'");
    db.exec("UPDATE users SET approval='approved' WHERE approval<>'approved'");
    db.prepare("INSERT OR IGNORE INTO meta VALUES('prices_revision','1')").run();
    db.prepare("INSERT INTO meta VALUES('import_v1',?)").run(new Date().toISOString());
  });
}
function openSqlite(file){
  const db=new (process.getBuiltinModule('node:sqlite').DatabaseSync)(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  const transaction=work=>{db.exec('BEGIN IMMEDIATE');try{const result=work();db.exec('COMMIT');return result;}catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}};
  return {db,transaction};
}
// setupCode: when set, creating the Owner account also needs this code (a public server must not let a stranger claim it first).
export function createApi({file=':memory:',storage,bands=DEFAULT_BANDS,key,now=Date.now,backupStatus=()=>({enabled:false}),cookieName='pto_session',local=true,hash,setupCode=''}={}){
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(cookieName))throw Error('Invalid session cookie name.');
  if(!key&&(storage||file!==':memory:'))throw Error('A persistent encryption key is required for this database.');
  key=key||randomBytes(32);
  const {db,transaction:tx}=storage||openSqlite(file),{hashPassword,verifyPassword,decoy}=passwords(hash);
  schema(db);importLegacy(db,bands,tx);
  const pricesRevision=()=>Number(db.prepare("SELECT value FROM meta WHERE key='prices_revision'").get().value);
  const countsRevision=id=>db.prepare('SELECT n FROM revisions WHERE user_id=?').get(id)?.n||0;
  const bump=id=>db.prepare('INSERT INTO revisions VALUES(?,1) ON CONFLICT(user_id) DO UPDATE SET n=n+1').run(id);
  const bandRows=(all=false)=>db.prepare('SELECT * FROM bands'+(all?'':' WHERE active=1')+' ORDER BY position').all().map(b=>({id:b.id,name:b.name,color:b.color,price:b.price,active:!!b.active}));
  const audit=(id,action,document=null)=>db.prepare('INSERT INTO audit(at,user_id,action,document) VALUES(?,?,?,?)').run(new Date(now()).toISOString(),id,action,auditDocument(db.prepare('SELECT name FROM users WHERE id=?').get(id)?.name,document));
  const cookieToken=request=>(request.headers.get('cookie')||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
  const auth=request=>{
    const session=db.prepare('SELECT users.*,sessions.mfa_verified,sessions.remember AS session_remember FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.hash=? AND sessions.expires>? AND users.disabled=0').get(digest(cookieToken(request)),now());
    return session?publicUser(session):null;
  };
  const guestData=()=>({authenticated:false,setupRequired:!db.prepare('SELECT id FROM users LIMIT 1').get(),...(setupCode?{setupCode:true}:{}),versions:{prices:pricesRevision()},development:local});
  const sessionData=user=>({authenticated:true,user,security:security.state(user),versions:{prices:pricesRevision(),counts:countsRevision(user.id)},development:local});
  const newSession=(user,verified=false,remember=!!user.remembered)=>{
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(now());
    const token=randomBytes(32).toString('base64url');db.prepare('INSERT INTO sessions(hash,user_id,expires,mfa_verified,remember) VALUES(?,?,?,?,?)').run(digest(token),user.id,now()+(remember?2592000000:43200000),Number(verified),Number(remember));
    return json(sessionData({...user,mfaVerified:verified,remembered:remember}),200,{'Set-Cookie':`${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/${remember?'; Max-Age=2592000':''}`});
  };
  // Old roster columns (stateId, phone, ...) are left out so a backup restores into a fresh database.
  const snapshot=()=>({format:'pto-calc-backup',version:1,createdAt:new Date(now()).toISOString(),key:key.toString('base64'),tables:Object.fromEntries(TABLES.map(table=>[table,db.prepare('SELECT '+(table==='users'?USER_COLUMNS:'*')+' FROM '+table).all().map(row=>table==='account_security'?{...row,pending:null,pending_until:null}:{...row})]))});
  const security=createSecurity({db,key,auth,publicUser,newSession,config:()=>null,audit,digest,verifyPassword,hashPassword,validatePassword,json,snapshot,now,backupStatus,isAdmin:user=>!!user.owner});
  const countOf=row=>({id:row.id,at:row.at,lines:JSON.parse(row.lines),total:row.total,notes:row.notes,cashoutId:row.cashout_id});
  const me=user=>({day:dayOf(now()),pricesRevision:pricesRevision(),countsRevision:countsRevision(user.id),bands:bandRows(),
    counts:db.prepare('SELECT * FROM counts WHERE user_id=? AND removed_at IS NULL ORDER BY at DESC').all(user.id).map(countOf),
    cashouts:db.prepare('SELECT id,at,amount FROM cashouts WHERE user_id=? AND undone_at IS NULL ORDER BY at DESC').all(user.id)});
  async function handle(request,{remoteAddress='local'}={}){
    const url=new URL(request.url),route=url.pathname,method=request.method;
    if(local&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))return json({error:'Development API is local only.'},403);
    if(!['GET','HEAD'].includes(method)&&(request.headers.get('origin')!==url.origin||request.headers.get('x-bandbook-request')!=='1'))return json({error:'Use the website to make this change.'},403);
    let body={};
    if(!['GET','HEAD'].includes(method)){
      if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'Expected JSON.'},415);
      const raw=await request.text();if(Buffer.byteLength(raw)>950000)return json({error:'Request too large.'},413);
      try{body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{return json({error:'Invalid request.'},400);}
    }
    let user=auth(request);
    if(route==='/api/session'&&method==='GET')return json(user?sessionData(user):guestData());
    if(route==='/api/bands'&&method==='GET')return json({pricesRevision:pricesRevision(),bands:bandRows()});
    try{
      const securityResponse=await security.handle(request,body,user,remoteAddress);
      if(securityResponse)return securityResponse;
      user=auth(request);
      if((route==='/api/auth/setup'||route==='/api/auth/register')&&method==='POST'){
        const setup=route==='/api/auth/setup';
        if(setup&&db.prepare('SELECT id FROM users LIMIT 1').get())return json({error:'The Owner account is already set up.'},409);
        if(!setup&&!db.prepare('SELECT id FROM users WHERE owner=1').get())return json({error:'The Owner must finish website setup first.'},409);
        security.limit((setup?'setup:':'register:')+remoteAddress,setup?5:10);
        if(setup&&setupCode&&(typeof body.setupCode!=='string'||!timingSafeEqual(Buffer.from(digest(body.setupCode.trim()),'hex'),Buffer.from(digest(setupCode),'hex'))))return json({error:'That setup code is not right.'},403);
        const username=validUsername(body),name=body.name===undefined?username:validName(body.name);validatePassword(body.password);
        if(db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(username))return json({error:'That username is already taken.'},409);
        const password=await security.work(()=>hashPassword(body.password)),id=crypto.randomUUID();
        const created=tx(()=>{
          if(setup&&db.prepare('SELECT id FROM users LIMIT 1').get())throw failure('The Owner account is already set up.',409);
          if(db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(username))throw failure('That username is already taken.',409);
          db.prepare("INSERT INTO users(id,name,email,username,password,owner,roles,approval,requested_at) VALUES(?,?,?,?,?,?,'[]','approved',?)").run(id,name,id+'@pto.invalid',username,password,Number(setup),new Date(now()).toISOString());
          audit(id,setup?'Owner account created':'Account created');return db.prepare('SELECT * FROM users WHERE id=?').get(id);
        });
        return newSession(publicUser(created),false,body.remember===true);
      }
      if(route==='/api/auth/login'&&method==='POST'){
        const login=typeof body.username==='string'?body.username.trim().toLowerCase():'';
        const row=db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE OR email=?').get(login,login);
        const bucket='login:'+(row?.id||login);security.limit('ip:'+remoteAddress,120);security.limit(bucket);
        const valid=typeof body.password==='string'&&body.password.length<=128&&await security.work(()=>verifyPassword(body.password,row?.password||decoy));
        const current=row&&db.prepare('SELECT * FROM users WHERE id=?').get(row.id);
        if(!valid||!current||current.disabled||current.password!==row.password){if(current)audit(current.id,'Failed sign-in');return json({error:'Username or password is incorrect, or the account is disabled.'},401);}
        security.clear(bucket);if(security.enabled(current.id))return security.challenge(current,body.remember===true);
        audit(current.id,'Signed in');return newSession(publicUser(current),false,body.remember===true);
      }
      if(!user)return json({error:'Sign in to continue.'},401);
      if(route==='/api/auth/logout'&&method==='POST'){
        db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(cookieToken(request)));return json({ok:true},200,{'Set-Cookie':cookieName+'=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
      }
      if(route==='/api/auth/password'&&method==='POST'){
        validatePassword(body.password);await security.reauthenticate(request,body,user);const previous=db.prepare('SELECT password FROM users WHERE id=?').get(user.id).password;
        const password=await security.work(()=>hashPassword(body.password));if(!auth(request)||db.prepare('SELECT password FROM users WHERE id=?').get(user.id).password!==previous)return json({error:'Your session changed. Sign in again.'},401);
        db.prepare('UPDATE users SET password=? WHERE id=?').run(password,user.id);security.revoke(user.id);audit(user.id,'Password changed');return newSession(user,security.enabled(user.id));
      }
      if(route==='/api/account/name'&&method==='POST'){
        const name=validName(body.name);db.prepare('UPDATE users SET name=? WHERE id=?').run(name,user.id);audit(user.id,'Display name changed');return json(sessionData({...user,name}));
      }
      if(route==='/api/me'&&method==='GET')return json(me(user));
      if(route==='/api/counts'&&method==='POST'){
        if(!validId(body.requestId))throw Error('Invalid request.');
        security.limit('counts:'+user.id,120,60000);
        const saved=db.prepare('SELECT user_id FROM counts WHERE id=?').get(body.requestId);
        if(saved){if(saved.user_id!==user.id)throw Error('Invalid request.');return json(me(user));}
        if(body.pricesRevision!==pricesRevision())return json({error:'Prices were just updated. Check your count against the new prices, then save again.',pricesChanged:true,...me(user)},409);
        if(!Array.isArray(body.lines)||body.lines.length>100)throw Error('Invalid count.');
        const active=new Map(bandRows().map(b=>[b.id,b])),seen=new Set(),lines=[];
        for(const line of body.lines){
          if(!line||!active.has(line.id)||seen.has(line.id))throw Error('That band is no longer available. Reload and try again.');seen.add(line.id);
          if(!Number.isSafeInteger(line.quantity)||line.quantity<0||line.quantity>MAX_QTY)throw Error('Quantities must be whole numbers up to '+MAX_QTY.toLocaleString('en-US')+'.');
          if(line.quantity>0){const {id,name,color,price}=active.get(line.id);lines.push({id,name,color,price,quantity:line.quantity});}
        }
        if(!lines.length)throw Error('Count at least one band before saving.');
        const total=lines.reduce((n,l)=>n+l.quantity*l.price,0);if(total>MAX_TOTAL)throw Error('That count is larger than the calculator supports.');
        const notes=typeof body.notes==='string'?body.notes.trim():'';if(notes.length>500)throw Error('Keep notes under 500 characters.');
        tx(()=>{db.prepare('INSERT INTO counts VALUES(?,?,?,?,?,?,NULL,NULL)').run(body.requestId,user.id,new Date(now()).toISOString(),JSON.stringify(lines),total,notes);bump(user.id);});
        return json(me(user),201);
      }
      const countAction=route.match(/^\/api\/counts\/([A-Za-z0-9_-]{1,80})\/(remove|restore)$/);
      if(countAction&&method==='POST'){
        const row=db.prepare('SELECT * FROM counts WHERE id=? AND user_id=?').get(countAction[1],user.id);
        if(!row)return json({error:'Count not found.'},404);
        if(row.cashout_id)throw failure('That count is part of a cash-out. Undo the cash-out first.',409);
        if(countAction[2]==='remove'&&!row.removed_at)tx(()=>{db.prepare('UPDATE counts SET removed_at=? WHERE id=?').run(new Date(now()).toISOString(),row.id);bump(user.id);});
        if(countAction[2]==='restore'&&row.removed_at)tx(()=>{db.prepare('UPDATE counts SET removed_at=NULL WHERE id=?').run(row.id);bump(user.id);});
        return json(me(user));
      }
      if(route==='/api/cashouts'&&method==='POST'){
        if(!validId(body.requestId)||!Array.isArray(body.expectedIds))throw Error('Invalid request.');
        const existing=db.prepare('SELECT user_id FROM cashouts WHERE id=?').get(body.requestId);
        if(existing){if(existing.user_id!==user.id)throw Error('Invalid request.');return json(me(user));}
        tx(()=>{
          const open=db.prepare('SELECT id,total FROM counts WHERE user_id=? AND cashout_id IS NULL AND removed_at IS NULL').all(user.id);
          if(!open.length)throw failure('There is nothing to cash out yet.',409);
          const ids=open.map(c=>c.id).sort(),expected=[...body.expectedIds].sort();
          if(ids.length!==expected.length||ids.some((id,i)=>id!==expected[i]))throw failure('Your counts changed on another screen. Check the total and try again.',409);
          db.prepare('INSERT INTO cashouts VALUES(?,?,?,?,NULL)').run(body.requestId,user.id,new Date(now()).toISOString(),open.reduce((n,c)=>n+c.total,0));
          db.prepare('UPDATE counts SET cashout_id=? WHERE user_id=? AND cashout_id IS NULL AND removed_at IS NULL').run(body.requestId,user.id);bump(user.id);
        });
        return json(me(user),201);
      }
      const undo=route.match(/^\/api\/cashouts\/([A-Za-z0-9_-]{1,80})\/undo$/);
      if(undo&&method==='POST'){
        const latest=db.prepare('SELECT id FROM cashouts WHERE user_id=? AND undone_at IS NULL ORDER BY at DESC LIMIT 1').get(user.id);
        if(!latest||latest.id!==undo[1])throw failure('Only your latest cash-out can be undone.',409);
        tx(()=>{db.prepare('UPDATE cashouts SET undone_at=? WHERE id=?').run(new Date(now()).toISOString(),latest.id);db.prepare('UPDATE counts SET cashout_id=NULL WHERE cashout_id=?').run(latest.id);bump(user.id);});
        return json(me(user));
      }
      if(route.startsWith('/api/admin/')){
        if(!user.owner)return json({error:'Only the Owner can do that.'},403);
        if(route==='/api/admin/bands'&&method==='GET'){
          const used=new Set(db.prepare('SELECT lines FROM counts').all().flatMap(c=>JSON.parse(c.lines).map(l=>l.id)));
          return json({pricesRevision:pricesRevision(),bands:bandRows(true).map(b=>({...b,used:used.has(b.id)}))});
        }
        if(route==='/api/admin/bands'&&method==='PUT'){
          const next=cleanBands(body.bands);
          if(!next.some(b=>b.active))throw Error('Keep at least one band visible.');
          const result=tx(()=>{
            if(body.pricesRevision!==pricesRevision())throw failure('Prices changed in another tab. Reload before saving.',409);
            const before=bandRows(true),keep=new Set(next.map(b=>b.id));
            const used=new Set(db.prepare('SELECT lines FROM counts').all().flatMap(c=>JSON.parse(c.lines).map(l=>l.id)));
            for(const b of before)if(!keep.has(b.id)){if(used.has(b.id))throw Error(b.name+' is in saved counts. Hide it instead of deleting it.');db.prepare('DELETE FROM bands WHERE id=?').run(b.id);}
            next.forEach((b,i)=>db.prepare('INSERT INTO bands VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color,price=excluded.price,active=excluded.active,position=excluded.position').run(b.id,b.name,b.color,b.price,Number(b.active),i));
            if(JSON.stringify(before)===JSON.stringify(next))return {unchanged:true};
            db.prepare("UPDATE meta SET value=? WHERE key='prices_revision'").run(String(pricesRevision()+1));
            audit(user.id,'Prices updated',JSON.stringify({before,after:next}));return {};
          });
          return json({...result,pricesRevision:pricesRevision(),bands:bandRows(true)});
        }
        if(route==='/api/admin/users'&&method==='GET'){
          const stats=new Map(db.prepare('SELECT user_id,count(*) AS counts,MAX(at) AS last FROM counts WHERE removed_at IS NULL GROUP BY user_id').all().map(s=>[s.user_id,s]));
          return json({users:db.prepare('SELECT * FROM users ORDER BY owner DESC,requested_at').all().map(u=>({...publicUser(u),mfaEnabled:security.enabled(u.id),counts:stats.get(u.id)?.counts||0,lastCount:stats.get(u.id)?.last||null}))});
        }
        const target=route.match(/^\/api\/admin\/users\/([A-Za-z0-9_.@-]{1,80})$/);
        if(target&&method==='POST'){
          const row=db.prepare('SELECT * FROM users WHERE id=?').get(target[1]);
          if(!row)return json({error:'Account not found.'},404);
          if(row.owner)throw Error('The Owner account is protected.');
          if(typeof body.disabled!=='boolean')throw Error('Invalid account status.');
          tx(()=>{db.prepare('UPDATE users SET disabled=? WHERE id=?').run(Number(body.disabled),row.id);if(body.disabled)security.revoke(row.id);audit(user.id,(body.disabled?'Account disabled: ':'Account enabled: ')+row.username);});
          return json({ok:true});
        }
      }
      return json({error:'Not found.'},404);
    }catch(error){return json({error:error.message?.startsWith('UNIQUE constraint')?'That already exists.':error.message||'Could not complete the request.'},error.status||400);}
  }
  return {handle,close:()=>db.close(),db,snapshot};
}
// Restore only into a fresh database; never overwrite the running one.
export function restoreSnapshot(document,{file=':memory:',...options}={}){
  if(document?.format!=='pto-calc-backup'||document.version!==1)throw Error('Unsupported backup.');
  const {tables}=document,key=Buffer.from(document.key||'','base64');if(key.length!==32)throw Error('Invalid backup key.');
  if(!tables||TABLES.some(name=>!Array.isArray(tables[name])))throw Error('Incomplete backup.');
  if(tables.users.filter(u=>u.owner===1).length!==1)throw Error('Backup must contain one Owner.');
  if(tables.security_policy.length!==1||!tables.meta.some(m=>m.key==='prices_revision'))throw Error('Invalid backup state.');
  for(const user of tables.users)if(!PASSWORD_HASH.test(user.password))throw Error('Invalid account in backup.');
  cleanBands(tables.bands.map(b=>({id:b.id,name:b.name,color:b.color,price:b.price,active:!!b.active})));
  for(const record of tables.account_security)if(record.secret)unseal(JSON.parse(record.secret),key);
  const api=createApi({file,key,...options});
  try{
    if(api.db.prepare('SELECT count(*) AS count FROM users').get().count)throw Error('Restore requires a new empty database.');
    api.db.exec('BEGIN IMMEDIATE');
    // Fresh defaults (bands, meta, policy) are replaced wholesale by the backup's rows.
    for(const name of ['bands','meta','security_policy','revisions'])api.db.exec('DELETE FROM '+name);
    for(const name of TABLES){
      const columns=api.db.prepare('PRAGMA table_info('+name+')').all().map(c=>c.name);
      for(const record of tables[name]){
        if(Object.keys(record).some(field=>!columns.includes(field)))throw Error('Unsupported backup fields.');
        const fields=columns.filter(c=>Object.hasOwn(record,c));
        api.db.prepare('INSERT INTO '+name+'('+fields.join(',')+') VALUES('+fields.map(()=>'?').join(',')+')').run(...fields.map(c=>record[c]));
      }
    }
    api.db.exec('COMMIT');return api;
  }catch(error){if(api.db.isTransaction)api.db.exec('ROLLBACK');api.close();throw error;}
}
