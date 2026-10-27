'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const make=require('../lockers');
const actor={role:'waiter',userId:randomUUID(),workArea:'equipment'};
const body=()=>({customerName:'Khách thử nghiệm',customerPhone:'0900 000 000',note:'',requestId:randomUUID()});
test('locker customer information and mutations require owner or equipment assignment',async()=>{
 const service=make({pool:{query(){throw Error('storage must not be read')}},id:randomUUID});
 for(const a of [null,{role:'waiter',userId:randomUUID()},{role:'waiter',userId:randomUUID(),workArea:'restroom'},{role:'manager',userId:randomUUID()}]){
  await assert.rejects(service.list(a),{status:403});
  await assert.rejects(service.rent(a,'A1',body()),{status:403});
  await assert.rejects(service.release(a,'A1',{rentalId:randomUUID(),confirm:true}),{status:403});
 }
});
test('invalid code, customer or phone is rejected before opening a transaction',async()=>{
 const service=make({pool:{connect(){throw Error('storage must not be used')}},id:randomUUID});
 for(const [code,b] of [['A31',body()],['C1',body()],['A01',body()],['A1',{...body(),customerName:' '}],['B30',{...body(),customerPhone:'abc'}]])await assert.rejects(service.rent(actor,code,b),{status:400});
 await assert.rejects(service.release(actor,'A1',{rentalId:randomUUID(),confirm:false}),{status:400});
});
test('rent locks the locker before checking occupancy; occupied locker rolls back',async()=>{
 const calls=[];const c={query:async(sql)=>{calls.push(sql);if(sql.startsWith('SELECT code'))return {rowCount:1,rows:[{code:'A1'}]};if(sql.startsWith('SELECT id FROM locker_rentals'))return {rowCount:1,rows:[{id:randomUUID()}]};return {rowCount:0,rows:[]}},release(){}};
 const service=make({pool:{connect:async()=>c},id:randomUUID});
 await assert.rejects(service.rent(actor,'A1',body()),{status:409});
 assert(calls.indexOf('SELECT code FROM lockers WHERE code=$1 FOR UPDATE')<calls.indexOf('SELECT id FROM locker_rentals WHERE locker_code=$1 AND ended_at IS NULL'));
 assert.equal(calls.at(-1),'ROLLBACK');assert(!calls.some(x=>x.startsWith('INSERT')));
});
test('retry of an existing rental does not create another rental',async()=>{
 const b=body(),rentalId=randomUUID();let writes=0;
 const c={query:async(sql)=>{if(sql.startsWith('INSERT'))writes++;return {rows:sql.startsWith('SELECT id,locker_code')?[{id:rentalId,locker_code:'A1',customer_name:b.customerName,customer_phone:'0900000000',note:'',opened_by:actor.userId,ended_at:null}]:[]}},release(){}};
 const service=make({pool:{connect:async()=>c},id:randomUUID});
 assert.deepEqual(await service.rent(actor,'A1',b),{id:rentalId,replayed:true,ended:false});
 await assert.rejects(service.rent(actor,'B1',b),{status:409});assert.equal(writes,0);
});
test('returning an old completed rental cannot release a later tenant',async()=>{
 const rentalId=randomUUID(),calls=[];
 const c={query:async(sql)=>{calls.push(sql);return {rows:sql.startsWith('SELECT id,ended_at')?[{id:rentalId,ended_at:'2026-10-27T01:00:00Z'}]:[],rowCount:1}},release(){}};
 const service=make({pool:{connect:async()=>c},id:randomUUID});
 assert.deepEqual(await service.release(actor,'A1',{rentalId,confirm:true}),{id:rentalId,already:true});
 assert(!calls.some(x=>x.startsWith('UPDATE')));assert.equal(calls.at(-1),'COMMIT');
});
