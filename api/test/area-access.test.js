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
 const service=receipts({serviceCosts:{snapshot:async()=>{}},pool:{query(){throw Error('Must not query')}},id:()=>''});
 const actor={role:'waiter',userId:'staff-id',workArea:'equipment'};
 await assert.rejects(service.list(actor,'restroom'),{status:403});
 await assert.rejects(service.create(actor,'restroom',{}),{status:403});
 await assert.rejects(service.create(actor,'equipment',{service:'restroom'}),{status:400});
 await assert.rejects(service.create(actor,'equipment',{service:'locker'}),{status:400});
});
test('receipt and income are one transaction; write failure rolls back',async()=>{
 const statements=[];
 const client={query:async(sql)=>{statements.push(sql);if(sql.startsWith('INSERT INTO area_receipts'))throw Error('Simulated write failure');return {rows:[],rowCount:sql.startsWith('INSERT INTO finance_entries')?1:0}},release(){}};
 const service=receipts({serviceCosts:{snapshot:async()=>{}},pool:{connect:async()=>client},id:()=>require('crypto').randomUUID()});
 await assert.rejects(service.create({role:'waiter',userId:'staff-id',workArea:'equipment'},'equipment',{service:'float',floatType:'child_float',confirmPayment:true,quantity:1,amount:20000,paymentMethod:'cash',requestId:require('crypto').randomUUID()}),/Simulated write failure/);
 assert.equal(statements[0],'BEGIN');assert.equal(statements.at(-1),'ROLLBACK');assert.equal(statements.includes('COMMIT'),false);
});
test('retry returns the existing receipt without another income; payload changes are rejected',async()=>{
 const id=require('crypto').randomUUID(),requestId=require('crypto').randomUUID();
 let writes=0;
 const prior={id,area:'equipment',staff_user_id:'staff-id',service:'float',float_type:'child_float',quantity:1,amount:'20000',payment_method:'cash',note:''};
 const client={query:async(sql)=>{if(sql.startsWith('INSERT'))writes++;return {rows:sql.startsWith('SELECT r.*')?[prior]:[]}},release(){}};
 const service=receipts({serviceCosts:{snapshot:async()=>{}},pool:{connect:async()=>client},id:()=>id});
 const actor={role:'waiter',userId:'staff-id',workArea:'equipment'},body={service:'float',floatType:'child_float',confirmPayment:true,quantity:1,amount:20000,paymentMethod:'cash',requestId};
 assert.deepEqual(await service.create(actor,'equipment',body),{id,replayed:true,amount:20000});
 await assert.rejects(service.create(actor,'equipment',{...body,quantity:2}),{status:409});
 assert.equal(writes,0);
});
test('all three float tariffs are calculated by the server, ignoring client amount',async()=>{
 const {randomUUID}=require('crypto');
 for(const [floatType,unitPrice] of [['child_vest',20000],['child_float',20000],['black_adult',30000]]){
  const calls=[];const c={query:async(sql,params)=>{calls.push({sql,params});return {rows:[],rowCount:sql.startsWith('INSERT INTO finance_entries')?1:0}},release(){}};
  const service=receipts({serviceCosts:{snapshot:async()=>{}},pool:{connect:async()=>c},id:randomUUID});
  const result=await service.create({role:'waiter',userId:'staff-id',workArea:'equipment'},'equipment',{service:'float',floatType,quantity:3,amount:1,paymentMethod:'cash',confirmPayment:true,requestId:randomUUID()});
  assert.equal(result.amount,3*unitPrice);
  assert.equal(calls.find(x=>x.sql.startsWith('INSERT INTO finance_entries')).params[3],3*unitPrice);
  const detail=calls.find(x=>x.sql.startsWith('INSERT INTO float_receipt_details'));
  assert.equal(detail.params[1],floatType);assert.equal(detail.params[2],unitPrice);
  assert.equal(calls.at(-1).sql,'COMMIT');
 }
});
test('a float type and payment confirmation are required',async()=>{
 const service=receipts({serviceCosts:{snapshot:async()=>{}},pool:{connect(){throw Error('must not open transaction')}},id:()=>''}),actor={role:'waiter',userId:'staff-id',workArea:'equipment'};
 await assert.rejects(service.create(actor,'equipment',{service:'float',floatType:'unknown',confirmPayment:true}),{status:400});
 await assert.rejects(service.create(actor,'equipment',{service:'float',floatType:'child_vest',confirmPayment:false}),{status:400});
});
