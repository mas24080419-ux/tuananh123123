'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const create=require('../async-ttl-cache');
const {readFileSync}=require('node:fs');
const path=require('node:path');
test('100 simultaneous KDS reads use one database query',async()=>{
 let count=0,clock=1000;
 const cache=create(async()=>({serial:++count}),{ttlMs:900,now:()=>clock});
 const values=await Promise.all(Array.from({length:100},()=>cache.get()));
 assert.equal(count,1);
 assert(values.every(v=>v.serial===1));
 clock+=700;assert.equal((await cache.get()).serial,1);
 clock+=300;assert.equal((await cache.get()).serial,2);
 assert.equal(count,2);
});
test('invalidation while query is pending cannot cache stale rows',async()=>{
 let release,reads=0;
 const old=new Promise(resolve=>{release=resolve});
 const cache=create(()=>++reads===1?old:Promise.resolve('fresh'),{ttlMs:1000});
 const pending=cache.get();await Promise.resolve();cache.invalidate();
 assert.equal(await cache.get(),'fresh');release('stale');
 assert.equal(await pending,'stale');
 assert.equal(await cache.get(),'fresh');
 assert.equal(reads,2);
});
test('failed read is retried',async()=>{
 let calls=0;const cache=create(async()=>{if(++calls===1)throw Error('db down');return 'OK'});
 await assert.rejects(cache.get(),/db down/);
 assert.equal(await cache.get(),'OK');assert.equal(calls,2);
});
test('KDS filters active items and invalidates after writes; order writes are batched',()=>{
 const server=readFileSync(path.join(__dirname,'../server.js'),'utf8');
 assert(server.includes("JOIN dining_order_lines li ON li.order_id=o.id WHERE li.status IN ('new','preparing','ready')"));
 assert(server.includes('const fetchedOrders=await kdsCache.get()'));
 assert(server.includes("const kdsCache=createAsyncTtlCache(()=>getOrders(true),{ttlMs:900})"));
 assert(server.includes("kdsCache.invalidate();void orderLive.pulse(true)"));
 assert(server.includes("await c.query('COMMIT');\n  kdsCache.invalidate()"));
 const order=server.slice(server.indexOf('async function placeOrder'),server.indexOf('async function getOrders'));
 assert(order.includes('FROM UNNEST($2::uuid[],$3::uuid[],$4::text[],$5::integer[]'));
 assert(!order.includes('for(const it of items)await c.query('));
 assert(order.includes('await ops.consume(c,orderId)'));
 assert(order.includes('ON CONFLICT(table_id,request_id) DO NOTHING'));
});
