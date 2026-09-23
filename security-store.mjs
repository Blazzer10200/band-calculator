import {auditDetails} from './audit-details.js';
import {randomBytes,createHash} from 'node:crypto';
import {newTotpSecret,matchingStep,seal,unseal,encryptBackup} from './security-crypto.mjs';
import {permits,permissionsFor} from './access-model.js';
import QRCode from 'qrcode';
export const failure=(message,status=400)=>Object.assign(Error(message),{status});
export function securitySchema(db){
  db.exec(`CREATE TABLE IF NOT EXISTS account_security(user_id TEXT PRIMARY KEY REFERENCES users(id),secret TEXT,pending TEXT,pending_until INTEGER,last_step INTEGER NOT NULL DEFAULT -1);
    CREATE TABLE IF NOT EXISTS recovery_codes(user_id TEXT NOT NULL REFERENCES users(id),hash TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS login_challenges(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL,password_version TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS security_policy(id INTEGER PRIMARY KEY,require_admin_mfa INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO security_policy VALUES(1,0);`);
  if(!db.prepare('PRAGMA table_info(sessions)').all().some(c=>c.name==='mfa_verified'))db.exec('ALTER TABLE sessions ADD COLUMN mfa_verified INTEGER NOT NULL DEFAULT 0');
  for(const table of ['sessions','login_challenges'])if(!db.prepare('PRAGMA table_info('+table+')').all().some(c=>c.name==='remember'))db.exec('ALTER TABLE '+table+' ADD COLUMN remember INTEGER NOT NULL DEFAULT 0');
}
export function createSecurity({db,key,auth,publicUser,newSession,config,audit,digest,verifyPassword,hashPassword,validatePassword,json,snapshot,now=Date.now,backupStatus,isAdmin=user=>user.owner||permits(permissionsFor(user,config()),'access','manage')}){
  let cryptoJobs=0;
  const row=id=>db.prepare('SELECT * FROM account_security WHERE user_id=?').get(id);
  const enabled=id=>!!row(id)?.secret;
  const required=user=>!!user&&user.approval==='approved'&&isAdmin(user);
  const policy=()=>!!db.prepare('SELECT require_admin_mfa FROM security_policy WHERE id=1').get().require_admin_mfa;
  function state(user){return {mfaEnabled:enabled(user.id),recoveryCodes:db.prepare('SELECT count(*) AS count FROM recovery_codes WHERE user_id=?').get(user.id).count,admin:required(user),requireAdminMfa:policy(),enrollmentRequired:policy()&&required(user)&&!enabled(user.id)};}
  function limit(bucket,max=8,window=600000){
    const id=digest(bucket);db.prepare('DELETE FROM rate_limits WHERE expires<=?').run(now());
    const current=db.prepare('SELECT * FROM rate_limits WHERE key=?').get(id);
    if(current&&current.count>=max)throw failure('Too many attempts. Wait a few minutes before trying again.',429);
    db.prepare('INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(id,now()+window);
  }
  const clear=bucket=>db.prepare('DELETE FROM rate_limits WHERE key=?').run(digest(bucket));
  async function work(action){if(cryptoJobs>=4)throw failure('Sign-in is busy. Try again in a moment.',429);cryptoJobs++;try{return await action();}finally{cryptoJobs--;}}
  const decrypt=value=>unseal(JSON.parse(value),key).toString();
  const encrypt=value=>JSON.stringify(seal(Buffer.from(value),key));
  function consumeTotp(id,code,pending=false){const record=row(id);if(!record||!(pending?record.pending:record.secret)||(pending&&record.pending_until<now()))return false;const step=matchingStep(decrypt(pending?record.pending:record.secret),code,pending?-1:record.last_step,now());if(step===null)return false;if(!pending)db.prepare('UPDATE account_security SET last_step=? WHERE user_id=?').run(step,id);return step;}
  const codeHash=(id,code)=>digest(id+':'+String(code||'').toUpperCase().replace(/[^A-Z0-9]/g,''));
  function codes(id){const values=Array.from({length:8},()=>randomBytes(12).toString('hex').toUpperCase().match(/.{1,6}/g).join('-'));db.prepare('DELETE FROM recovery_codes WHERE user_id=?').run(id);for(const value of values)db.prepare('INSERT INTO recovery_codes VALUES(?,?)').run(id,codeHash(id,value));return values;}
  const consumeRecovery=(id,code)=>db.prepare('DELETE FROM recovery_codes WHERE user_id=? AND hash=?').run(id,codeHash(id,code)).changes===1;
  function revoke(id){db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);db.prepare('DELETE FROM login_challenges WHERE user_id=?').run(id);}
  async function reauthenticate(request,body,user,{factor=true}={}){
    limit('confirm:'+user.id);const before=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    if(typeof body.currentPassword!=='string'||body.currentPassword.length>128||!await work(()=>verifyPassword(body.currentPassword,before.password)))throw failure('Current password is incorrect.');
    const fresh=auth(request),after=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
    if(!fresh||after.password!==before.password)throw failure('Your session changed. Sign in again.',401);
    if(factor&&enabled(user.id)&&consumeTotp(user.id,body.code)===false)throw failure('Enter a fresh six-digit authenticator code.');
    return fresh;
  }
  function challenge(user,remember=false){const token=randomBytes(32).toString('base64url');db.prepare('DELETE FROM login_challenges WHERE expires<=? OR user_id=?').run(now(),user.id);db.prepare('INSERT INTO login_challenges(hash,user_id,expires,password_version,remember) VALUES(?,?,?,?,?)').run(digest(token),user.id,now()+300000,db.prepare('SELECT password FROM users WHERE id=?').get(user.id).password,Number(remember));return json({mfaRequired:true,challenge:token});}
  async function handle(request,body,user,source){const {pathname:route,searchParams}=new URL(request.url),method=request.method;
    if(route==='/api/auth/mfa'&&method==='POST'){
      limit('ip:'+source,120);const record=db.prepare('SELECT * FROM login_challenges WHERE hash=? AND expires>?').get(digest(String(body.challenge||'')),now());
      if(!record)throw failure('This sign-in expired. Start again.',401);limit('factor:'+record.user_id);
      const target=db.prepare('SELECT * FROM users WHERE id=?').get(record.user_id);
      if(!target||target.disabled||target.password!==record.password_version)throw failure('This sign-in expired. Start again.',401);
      if(!enabled(target.id)||consumeTotp(target.id,body.code)===false)throw failure('That code is invalid or already used. Try a fresh code.',401);
      db.prepare('DELETE FROM login_challenges WHERE hash=?').run(record.hash);clear('factor:'+target.id);audit(target.id,'Signed in with two-factor');return newSession(publicUser(target),true,!!record.remember);
    }
    if(route==='/api/auth/recover'&&method==='POST'){
      limit('ip:'+source,120);const login=String(body.username||'').trim().toLowerCase();const target=db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE OR email=?').get(login,login);
      limit('recovery:'+(target?.id||login));validatePassword(body.password);
      if(!target||target.disabled||!db.prepare('SELECT hash FROM recovery_codes WHERE user_id=? AND hash=?').get(target.id,codeHash(target.id,body.recoveryCode)))throw failure('The username and recovery code could not be verified.',401);
      const password=await work(()=>hashPassword(body.password));
      const current=db.prepare('SELECT * FROM users WHERE id=?').get(target.id);
      if(current.disabled||current.password!==target.password||!consumeRecovery(target.id,body.recoveryCode))throw failure('This recovery code can no longer be used.',401);
      db.prepare('UPDATE users SET password=? WHERE id=?').run(password,target.id);
      db.prepare('DELETE FROM recovery_codes WHERE user_id=?').run(target.id);db.prepare('DELETE FROM account_security WHERE user_id=?').run(target.id);revoke(target.id);audit(target.id,'Account recovered; password reset and all sessions revoked');return json({ok:true});
    }
    if(!user)return null;
    if(route==='/api/security'&&method==='GET')return json({...state(user),sessions:db.prepare('SELECT count(*) AS count FROM sessions WHERE user_id=? AND expires>?').get(user.id,now()).count});
    if(route==='/api/security/setup'&&method==='POST'){
      await reauthenticate(request,body,user);if(enabled(user.id))throw failure('Two-factor is already enabled.');
      const secret=newTotpSecret();db.prepare('INSERT INTO account_security(user_id,pending,pending_until) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET pending=excluded.pending,pending_until=excluded.pending_until').run(user.id,encrypt(secret),now()+600000);
      const uri=`otpauth://totp/${encodeURIComponent('Band Calculator:'+user.username)}?secret=${secret}&issuer=Band%20Calculator&algorithm=SHA1&digits=6&period=30`;
      return json({secret,qr:await QRCode.toDataURL(uri,{width:220,margin:2,errorCorrectionLevel:'M'})});
    }
    if(route==='/api/security/confirm'&&method==='POST'){
      limit('factor:'+user.id);const step=consumeTotp(user.id,body.code,true);if(step===false)throw failure('That code did not match. Check your authenticator or restart setup.');
      db.prepare('UPDATE account_security SET secret=pending,pending=NULL,pending_until=NULL,last_step=? WHERE user_id=?').run(step,user.id);const recoveryCodes=codes(user.id);revoke(user.id);audit(user.id,'Two-factor enabled');
      const response=newSession(publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)),true,user.remembered);return json({session:await response.json(),recoveryCodes},200,{'Set-Cookie':response.headers.get('set-cookie')});
    }
    if(route==='/api/security/recovery-codes'&&method==='POST'){
      await reauthenticate(request,body,user);const recoveryCodes=codes(user.id);audit(user.id,'Recovery codes regenerated');return json({recoveryCodes});
    }
    if(route==='/api/security/revoke'&&method==='POST'){
      await reauthenticate(request,body,user);revoke(user.id);audit(user.id,'Other sessions signed out');return newSession(publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)),enabled(user.id),user.remembered);
    }
    if(route==='/api/security/policy'&&method==='POST'){
      if(!user.owner)throw failure('Only the Owner can change this requirement.',403);
      if(body.requireAdminMfa!==true)throw failure('The admin requirement cannot be turned off here.');
      await reauthenticate(request,body,user);if(!enabled(user.id)||!state(user).recoveryCodes)throw failure('Set up your authenticator and recovery codes first.');
      db.prepare('UPDATE security_policy SET require_admin_mfa=1 WHERE id=1').run();audit(user.id,'Two-factor now required for administrators');return json({ok:true});
    }
    if(['/api/auth/logout','/api/auth/password','/api/auth/login'].includes(route))return null;
    if(state(user).enrollmentRequired)return json({error:'Set up two-factor authentication to continue.',enrollmentRequired:true},403);
    if(enabled(user.id)&&!user.mfaVerified)return json({error:'Sign in again with your authenticator.',reauthenticate:true},401);
    if(route==='/api/security/backup-status'&&method==='GET'){
      if(!user.owner)throw failure('Only the Owner can view full backup status.',403);
      return json(backupStatus());
    }
    if(route==='/api/audit'&&method==='GET'){
      if(!isAdmin(user))throw failure('Account administration permission required.',403);
      const before=Number(searchParams.get('before'))||Number.MAX_SAFE_INTEGER;
      const events=db.prepare('SELECT audit.id,audit.at,audit.action,audit.document,users.name AS actor FROM audit LEFT JOIN users ON audit.user_id=users.id WHERE audit.id<? ORDER BY audit.id DESC LIMIT 51').all(before);
      const more=events.length>50;return json({events:events.slice(0,50).map(e=>({id:e.id,at:e.at,action:e.action,actor:auditDetails(e.document).actorName||e.actor||'Deleted account',changes:auditDetails(e.document).changes||[]})),next:more?events[49].id:null});
    }
    if(route==='/api/security/backup'&&method==='POST'){
      if(!user.owner)throw failure('Only the Owner can export a full security backup.',403);
      await reauthenticate(request,body,user);audit(user.id,'Encrypted full backup downloaded');return json(await work(()=>encryptBackup(snapshot(),body.passphrase)));
    }
    return null;
  }
  return {state,limit,clear,work,enabled,challenge,reauthenticate,revoke,handle};
}
