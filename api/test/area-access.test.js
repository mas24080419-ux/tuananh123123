'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canAccess,canUseDining}=require('../area-access');
const receipts=require('../area-receipts');
test('area employees cannot cross areas or access dining; ordinary dining roles retain access',()=>{
 for(const area of ['equipment','restroom']){
  const actor={role:'waiter',userId:'staff-id',workArea:area};
  assert.equal(canAccess(actor,area),true);
  assert.equal(canAccess(actor,area==='equipment'?'restroom':'equipment'),false);
  assert.equal(canUseDining(actor),false);
 }
 for(const role of ['manager','cashier','waiter','kitchen','bar']){
  assert.equal(canAccess({role,userId:'staff-id'},'equipment'),false);
  assert.equal(canUseDining({role}),true);
 }
 assert.equal(canAccess(null,'equipment'),false);
 assert.equal(canAccess({role:'admin'},'invalid'),false);
 assert.equal(canAccess({role:'admin'},'restroom'),true);
});
test('reject cross-area reads and writes before querying storage',async()=>{
 const service=receipts({pool:{query(){throw Error('Must not query')}},id:()=>''});
 const actor={role:'waiter',userId:'staff-id',workArea:'equipment'};
 await assert.rejects(service.list(actor,'restroom'),{status:403});
 await assert.rejects(service.create(actor,'restroom',{}),{status:403});
 await assert.rejects(service.create(actor,'equipment',{service:'restroom'}),{status:400});
});
test('receipt and income are one transaction; write failure rolls back',async()=>{
 const statements=[];
 const client={query:async(sql)=>{statements.push(sql);if(sql.startsWith('INSERT INTO area_receipts'))throw Error('Simulated write failure');return {rows:[],rowCount:sql.startsWith('INSERT INTO finance_entries')?1:0}},release(){}};
 const service=receipts({pool:{connect:async()=>client},id:()=>require('crypto').randomUUID()});
 await assert.rejects(service.create({role:'waiter',userId:'staff-id',workArea:'equipment'},'equipment',{service:'float',quantity:1,amount:10000,paymentMethod:'cash',requestId:require('crypto').randomUUID()}),/Simulated write failure/);
 assert.equal(statements[0],'BEGIN');assert.equal(statements.at(-1),'ROLLBACK');assert.equal(statements.includes('COMMIT'),false);
});
test('retry returns the existing receipt without another income; payload changes are rejected',async()=>{
 const id=require('crypto').randomUUID(),requestId=require('crypto').randomUUID();
 let writes=0;
 const prior={id,area:'equipment',staff_user_id:'staff-id',service:'float',quantity:1,amount:'10000',payment_method:'cash',note:''};
 const client={query:async(sql)=>{if(sql.startsWith('INSERT'))writes++;return {rows:sql.startsWith('SELECT r.*')?[prior]:[]}},release(){}};
 const service=receipts({pool:{connect:async()=>client},id:()=>id});
 const actor={role:'waiter',userId:'staff-id',workArea:'equipment'},body={service:'float',quantity:1,amount:10000,paymentMethod:'cash',requestId};
 assert.deepEqual(await service.create(actor,'equipment',body),{id,replayed:true});
 await assert.rejects(service.create(actor,'equipment',{...body,amount:20000}),{status:409});
 assert.equal(writes,0);
});
