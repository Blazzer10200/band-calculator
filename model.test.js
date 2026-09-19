import {sampleData} from './test-fixtures.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {freshData,total,paid,balance,addPayment,validatePurchase,validateBackup,cents,contactBalance,payContact} from './model.js';
test('sample data is valid and a fresh workspace starts at the live PTO band rates with no records',()=>{
  const demo=validateBackup(sampleData()),own=validateBackup(freshData());
  assert.equal(demo.purchases.length,6);assert.equal(own.purchases.length,0);assert.equal(own.contacts.length,0);
  assert.deepEqual(own.bands.map(b=>[b.name,b.price]),[['Loose change',2500],['White band',10000],['Blue band',150000],['Purple band',250000],['Brown band',600000],['Yellow band',1250000]]);
});
test('partial payments reduce balance, a final payment settles, and overpayments fail',()=>{
  const p=sampleData().purchases[0];assert.equal(total(p),1200000);assert.equal(paid(p),600000);assert.equal(balance(p),600000);
  const partial=addPayment(p,100000,new Date().toISOString(),'one');assert.equal(balance(partial),500000);assert.equal(p.payments.length,1);
  assert.equal(balance(addPayment(partial,500000,new Date().toISOString(),'two')),0);
  assert.throws(()=>addPayment(partial,500001,new Date().toISOString(),'bad'));assert.throws(()=>addPayment(p,-100,new Date().toISOString(),'negative'));
});
test('saved purchases keep prices when defaults change',()=>{const d=sampleData(),before=total(d.purchases[0]);d.bands[2].price=1;assert.equal(total(d.purchases[0]),before);});
test('integer cents avoid decimal totals and invalid quantities or payments are rejected',()=>{
  const p={...sampleData().purchases[0],lines:[{name:'Band',quantity:3,price:cents('0.10')}],payments:[]};assert.equal(total(validatePurchase(p)),30);
  assert.throws(()=>validatePurchase({...p,lines:[{quantity:1.5,price:100}]}));assert.throws(()=>validatePurchase({...p,payments:[{amount:31}]}));assert.throws(()=>validatePurchase({...p,lines:[]}));
});
test('backup round trip preserves payment history; corrupt and orphan records are rejected',()=>{
  const d=sampleData();assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(d))),d);
  assert.throws(()=>validateBackup({...d,contacts:[]}));assert.throws(()=>validateBackup({...d,version:2}));
  const bad=structuredClone(d);bad.bands[0].color='url(https://example.com)';assert.throws(()=>validateBackup(bad));
  const duplicate=structuredClone(d);duplicate.contacts.push(duplicate.contacts[0]);assert.throws(()=>validateBackup(duplicate));
});
test('unpaid mixed-band drop-offs accrue a contact balance and retain their rates',()=>{
  const data=sampleData();
  const dropoff=validatePurchase({id:'drop-1',kind:'dropoff',contactId:'c1',date:new Date().toISOString(),notes:'Left for later payment',lines:[{...data.bands[1],quantity:20},{...data.bands[3],quantity:5}],payments:[]});
  const previous=contactBalance(data.purchases,'c1');
  data.purchases.push(dropoff);
  assert.equal(total(dropoff),700000);
  assert.equal(contactBalance(data.purchases,'c1'),previous+700000);
  data.bands[1].price=999;assert.equal(total(dropoff),700000);
  assert.equal(validateBackup(JSON.parse(JSON.stringify(data))).purchases.at(-1).kind,'dropoff');
});
test('one contact payment settles oldest drop-offs first and leaves other people untouched',()=>{
  const line={name:'White band',quantity:10,price:10000};
  const records=[{id:'new',contactId:'a',kind:'dropoff',date:'2026-09-05T12:00:00Z',lines:[line],payments:[]},{id:'old',contactId:'a',kind:'dropoff',date:'2026-09-04T12:00:00Z',lines:[line],payments:[]},{id:'other',contactId:'b',date:'2026-09-03T12:00:00Z',lines:[line],payments:[]}];
  const result=payContact(records,'a',150000,'2026-09-06T12:00:00Z','batch');
  assert.equal(balance(result[1]),0);assert.equal(balance(result[0]),50000);
  assert.equal(contactBalance(result,'a'),50000);assert.equal(contactBalance(result,'b'),100000);
  assert.equal(records[1].payments.length,0);
  assert.equal(contactBalance(payContact(result,'a',50000,'2026-09-06T12:00:00Z','final'),'a'),0);
  assert.throws(()=>payContact(records,'a',200001,'2026-09-06','bad'));
  assert.throws(()=>payContact(records,'missing',100,'2026-09-06','bad'));
  assert.throws(()=>payContact(records,'a',0,'2026-09-06','bad'));
});
