'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const make=require('../lockers');
const actor={role:'waiter',userId:randomUUID(),workArea:'equipment'};
const body=()=>({customerName:'Khách thử nghiệm',customerPhone:'0900 000 000',note:'',paymentMethod:'cash',confirmPayment:true,requestId:randomUUID()});
test('locker customer information and mutations require owner or equipment assignment',async()=>{
 const service=make({serviceCosts:{snapshot:async()=>{}},pool:{query(){throw Error('storage must not be read')}},id:randomUUID});
 for(const a of [null,{role:'waiter',userId:randomUUID()},{role:'waiter',userId:randomUUID(),workArea:'restroom'},{role:'manager',userId:randomUUID()}]){
  await assert.rejects(service.list(a),{status:403});
  await assert.rejects(service.rent(a,'A1',body()),{status:403});
  await assert.rejects(service.release(a,'A1',{rentalId:randomUUID(),confirm:true}),{status:403});
 }
});
test('invalid code, customer or phone is rejected before opening a transaction',async()=>{
 const service=make({serviceCosts:{snapshot:async()=>{}},pool:{connect(){throw Error('storage must not be used')}},id:randomUUID});
 for(const [code,b] of [['A31',body()],['C1',body()],['A01',body()],['A1',{...body(),customerName:' '}],['B30',{...body(),customerPhone:'abc'}]])await assert.rejects(service.rent(actor,code,b),{status:400});
 await assert.rejects(service.release(actor,'A1',{rentalId:randomUUID(),confirm:false}),{status:400});
});
test('rent locks the locker before checking occupancy; occupied locker rolls back',async()=>{
 const calls=[];const c={query:async(sql)=>{calls.push(sql);if(sql.startsWith('SELECT code'))return {rowCount:1,rows:[{code:'A1'}]};if(sql.startsWith('SELECT id FROM locker_rentals'))return {rowCount:1,rows:[{id:randomUUID()}]};return {rowCount:0,rows:[]}},release(){}};
 const service=make({serviceCosts:{snapshot:async()=>{}},pool:{connect:async()=>c},id:randomUUID});
 await assert.rejects(service.rent(actor,'A1',body()),{status:409});
 assert(calls.indexOf('SELECT code FROM lockers WHERE code=$1 FOR UPDATE')<calls.indexOf('SELECT id FROM locker_rentals WHERE locker_code=$1 AND ended_at IS NULL'));
 assert.equal(calls.at(-1),'ROLLBACK');assert(!calls.some(x=>x.startsWith('INSERT')));
});
test('retry of an existing rental does not create another rental',async()=>{
 const b=body(),rentalId=randomUUID();let writes=0;
 const c={query:async(sql)=>{if(sql.startsWith('INSERT'))writes++;return {rows:sql.startsWith('SELECT id,locker_code')?[{id:rentalId,locker_code:'A1',customer_name:b.customerName,customer_phone:'0900000000',note:'',opened_by:actor.userId,ended_at:null,payment_method:'cash'}]:[]}},release(){}};
 const service=make({serviceCosts:{snapshot:async()=>{}},pool:{connect:async()=>c},id:randomUUID});
 assert.deepEqual(await service.rent(actor,'A1',b),{id:rentalId,replayed:true,ended:false});
 await assert.rejects(service.rent(actor,'B1',b),{status:409});assert.equal(writes,0);
});
test('returning an old completed rental cannot release a later tenant',async()=>{
 const rentalId=randomUUID(),calls=[];
 const c={query:async(sql)=>{calls.push(sql);return {rows:sql.startsWith('SELECT id,ended_at')?[{id:rentalId,ended_at:'2026-10-27T01:00:00Z'}]:[],rowCount:1}},release(){}};
 const service=make({serviceCosts:{snapshot:async()=>{}},pool:{connect:async()=>c},id:randomUUID});
 assert.deepEqual(await service.release(actor,'A1',{rentalId,confirm:true}),{id:rentalId,already:true});
 assert(!calls.some(x=>x.startsWith('UPDATE')));assert.equal(calls.at(-1),'COMMIT');
});
test('new rental records exactly 30000 income regardless of client amount in the same transaction',async()=>{
 const calls=[];
 const c={query:async(sql,params)=>{calls.push({sql,params});return {rows:[],rowCount:sql.startsWith('SELECT code')||sql.startsWith('INSERT INTO finance_entries')?1:0}},release(){}};
 const service=make({serviceCosts:{snapshot:async()=>{}},pool:{connect:async()=>c},id:randomUUID});
 const result=await service.rent(actor,'B30',{...body(),amount:1});
 assert.equal(result.amount,30000);
 const income=calls.find(x=>x.sql.startsWith('INSERT INTO finance_entries'));
 assert.equal(income.params[2],30000);assert.equal(income.params[3],'cash');
 const rental=calls.find(x=>x.sql.startsWith('INSERT INTO locker_rentals'));
 assert.equal(rental.params[7],30000);assert.equal(rental.params[9],income.params[0]);
 assert.equal(calls.filter(x=>x.sql.startsWith('INSERT INTO area_receipts')).length,1);
 assert.equal(calls.at(-1).sql,'COMMIT');
});
test('failed income or rental write rolls back; unconfirmed payments are rejected',async()=>{
 for(const failedPrefix of ['INSERT INTO finance_entries','INSERT INTO locker_rentals']){
  const calls=[];const c={query:async(sql)=>{calls.push(sql);if(sql.startsWith(failedPrefix))throw Error('Simulated failure');return {rows:[],rowCount:sql.startsWith('SELECT code')||sql.startsWith('INSERT INTO finance_entries')?1:0}},release(){}};
  const service=make({serviceCosts:{snapshot:async()=>{}},pool:{connect:async()=>c},id:randomUUID});
  await assert.rejects(service.rent(actor,'A1',body()),/Simulated failure/);
  assert.equal(calls.at(-1),'ROLLBACK');assert(!calls.includes('COMMIT'));
 }
 const service=make({serviceCosts:{snapshot:async()=>{}},pool:{},id:randomUUID});
 await assert.rejects(service.rent(actor,'A1',{...body(),confirmPayment:false}),{status:400});
 await assert.rejects(service.rent(actor,'A1',{...body(),paymentMethod:'fake'}),{status:400});
});
test('legacy fee retries cannot charge a rental twice and remain area restricted',async()=>{
 const rentalId=randomUUID(),calls=[];
 const c={query:async(sql)=>{calls.push(sql);return {rows:sql.startsWith('SELECT id,request_id')?[{id:rentalId,finance_entry_id:randomUUID(),payment_method:'cash'}]:[]}},release(){}};
 const service=make({serviceCosts:{snapshot:async()=>{}},pool:{connect:async()=>c},id:randomUUID});
 assert.deepEqual(await service.collect(actor,'A1',{rentalId,confirmPayment:true,paymentMethod:'cash'}),{id:rentalId,amount:30000,already:true});
 assert(!calls.some(x=>x.startsWith('INSERT')));
 await assert.rejects(service.collect({...actor,workArea:'restroom'},'A1',{rentalId,confirmPayment:true,paymentMethod:'cash'}),{status:403});
});
