import test from 'node:test';
import assert from 'node:assert/strict';
import {securityNudge,dismissSecurityNudge} from './security-ui.js';

const session=id=>({user:{id,owner:true},security:{admin:true,mfaEnabled:false,requireAdminMfa:false,enrollmentRequired:false}});

test('dismissing a reminder affects only that account and does not change security settings',()=>{
  const owner=session('dismiss-owner'),other=session('other-owner'),before=structuredClone(owner);
  assert.match(securityNudge(owner),/Dismiss security reminder/);
  dismissSecurityNudge(owner);
  assert.equal(securityNudge(owner),'');
  assert.match(securityNudge(other),/Add another layer of protection/);
  assert.deepEqual(owner,before);
  owner.security.mfaEnabled=true;
  assert.match(securityNudge(owner),/Lock down the Owner account/);
});

test('reminder dismissal works when browser storage is unavailable',t=>{
  const old=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('Storage blocked');}});
  t.after(()=>{if(old)Object.defineProperty(globalThis,'localStorage',old);else delete globalThis.localStorage;});
  const owner=session('blocked-storage-owner');
  assert.doesNotThrow(()=>dismissSecurityNudge(owner));
  assert.equal(securityNudge(owner),'');
});

test('accounts without a relevant security recommendation do not see a reminder',()=>{
  const member=session('no-reminder');member.security.admin=false;
  assert.equal(securityNudge(member),'');
  const owner=session('protected-owner');owner.security.mfaEnabled=true;owner.security.requireAdminMfa=true;
  assert.equal(securityNudge(owner),'');
});
