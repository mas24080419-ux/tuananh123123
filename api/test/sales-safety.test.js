'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const createRateLimit=require('../rate-limit');

test('100 guests behind one IP fit the order budget; login remains restricted',()=>{
 const limiter=createRateLimit();
 for(let i=0;i<100;i++)assert(limiter.allow('orders:shared-wifi',240));
 for(let i=0;i<8;i++)assert(limiter.allow('login:shared-wifi',8));
 assert.equal(limiter.allow('login:shared-wifi',8),false);
});
test('rate counters expire, stay bounded and cannot reset active keys by flooding',()=>{
 let time=0;const limiter=createRateLimit({now:()=>time,maxKeys:2});
 assert(limiter.allow('a',1));assert(limiter.allow('b',1));
 assert.equal(limiter.allow('c',1),false);
 assert.equal(limiter.allow('a',1),false);assert.equal(limiter.size(),2);
 time=60000;assert(limiter.allow('c',1));assert.equal(limiter.size(),1);
});

// Execute the actual server functions against a transactional lock model.
// Both interleavings must preserve paid_amount and forbid paid cancellation.
for(const first of ['payment','cancellation'])test(first+' racing the other operation preserves the paid total',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 const update=source.slice(source.indexOf('async function updateLine('),source.indexOf('\nasync function orderStatus('));
 const payment=source.slice(source.indexOf('async function confirmPayment('),source.indexOf('\nconst serveStatic='));
 let status='new',paymentStatus='unpaid',paidAmount=0,tail=Promise.resolve();
 const pool={async connect(){let unlock=null;return {
  async query(sql){
   if(sql==='BEGIN')return {rows:[]};
   if(sql==='COMMIT'||sql==='ROLLBACK'){unlock?.();unlock=null;return {rows:[]}}
   if(sql.includes('FOR UPDATE OF o')||sql.startsWith('SELECT id,payment_method,payment_status,paid_amount')){
    const previous=tail;tail=new Promise(resolve=>{unlock=resolve});await previous;
    return {rows:[{id:'order',payment_status:paymentStatus,payment_method:'cash',paid_amount:paidAmount}]};
   }
   if(sql.startsWith('SELECT status,station'))return {rows:[{status,station:'kitchen'}]};
   if(sql.startsWith('UPDATE dining_order_lines')){status='cancelled';return {rows:[{id:'line',status}]}}
   if(sql.includes('coalesce(sum(quantity*unit_price)'))return {rows:[{amount:status==='cancelled'?0:50000}]};
   if(sql.startsWith('UPDATE dining_orders')){paymentStatus='paid';paidAmount=50000;return {rows:[]}}
   if(sql.startsWith('INSERT INTO dining_audit'))return {rows:[]};
   throw Error('Unexpected SQL '+sql);
  },release(){assert.equal(unlock,null)}
 }}};
 const context=vm.createContext({pool,systemFlow:{mark(){}},canChangeOrderItem:()=>true,ops:{async restore(){}},invalidateOrderReads(){},orderLive:{async pulse(){}},console});
 vm.runInContext(update+'\n'+payment+'\nthis.updateLine=updateLine;this.confirmPayment=confirmPayment;',context);
 const cancel=()=>context.updateLine('line','cancelled',{role:'admin'});
 const pay=()=>context.confirmPayment('order','cash');
 const results=await Promise.allSettled(first==='payment'?[pay(),cancel()]:[cancel(),pay()]);
 assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');
 assert.equal(results[1].reason.status,409);
 if(first==='payment'){assert.equal(status,'new');assert.equal(paymentStatus,'paid');assert.equal(paidAmount,50000)}
 else {assert.equal(status,'cancelled');assert.equal(paymentStatus,'unpaid');assert.equal(paidAmount,0)}
});
