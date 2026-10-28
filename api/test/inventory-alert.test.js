'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const makeOperations=require('../operations');

test('inventory alert reads real stock rows and reports critical / low / healthy correctly',async()=>{
 const calls=[];
 const items=[
  {id:randomUUID(),name:'Sản phẩm A',quantity:'0.000',reorder_level:'10.000',unit:'cái'},
  {id:randomUUID(),name:'Sản phẩm B',quantity:'2.000',reorder_level:'10.000',unit:'cái'},
  {id:randomUUID(),name:'Sản phẩm C',quantity:'5.000',reorder_level:'10.000',unit:'cái'},
  {id:randomUUID(),name:'Sản phẩm D',quantity:'11.000',reorder_level:'10.000',unit:'cái'},
  {id:randomUUID(),name:'Sản phẩm E',quantity:'3.000',reorder_level:'0.000',unit:'cái'}
 ];
 const pool={query:async sql=>{calls.push(sql);
  if(sql.includes('FROM inventory_items WHERE active=true'))return {rows:items};
  if(sql.includes('FROM inventory_movements m'))return {rows:[]};
  throw Error('Unexpected SQL: '+sql);
 }};
 const ops=makeOperations({pool,id:randomUUID});
 const dashboard=await ops.inventoryDashboard();
 assert.equal(dashboard.summary.total,5);
 assert.equal(dashboard.summary.low,3);
 assert.equal(dashboard.summary.critical,2);
 assert.equal(dashboard.summary.healthy,2);
 assert.deepEqual(dashboard.items.map(x=>x.low_stock),[true,true,true,false,false]);
 assert.equal(dashboard.movements.length,0);
 assert.equal(calls.length,2);
 assert(calls.every(q=>!/^INSERT|^UPDATE|^DELETE/.test(q)));
});
test('inventory dashboard refuses missing database rather than showing demo counts',async()=>{
 const ops=makeOperations({pool:null,id:randomUUID});
 await assert.rejects(ops.inventoryDashboard(),{status:503});
});
test('threshold update validates identifiers and decimal precision before writes',async()=>{
 const ops=makeOperations({pool:{connect(){throw Error('Unexpected database usage')}},id:randomUUID});
 await assert.rejects(ops.updateReorderLevel('bad',{reorderLevel:10}),{status:400});
 await assert.rejects(ops.updateReorderLevel(randomUUID(),{reorderLevel:-1}),{status:400});
 await assert.rejects(ops.updateReorderLevel(randomUUID(),{reorderLevel:1.0001}),{status:400});
 await assert.rejects(ops.updateReorderLevel(randomUUID(),{reorderLevel:''}),{status:400});
 await assert.rejects(ops.updateReorderLevel(randomUUID(),{reorderLevel:null}),{status:400});
});
test('threshold update writes only reorder level and audit in one transaction',async()=>{
 const itemId=randomUUID(),calls=[],client={
  query:async(sql,args)=>{calls.push({sql,args});
   if(sql.startsWith('SELECT id,name,reorder_level'))return {rows:[{id:itemId,name:'Nước suối',reorder_level:'5.000'}]};
   if(sql.startsWith('UPDATE inventory_items'))return {rows:[{id:itemId,name:'Nước suối',unit:'chai',quantity:'4.000',reorder_level:'10.000'}]};
   return {rows:[],rowCount:1};
  },release(){}
 };
 const ops=makeOperations({pool:{connect:async()=>client},id:randomUUID});
 const result=await ops.updateReorderLevel(itemId,{reorderLevel:10});
 assert.equal(result.reorder_level,'10.000');
 assert.equal(calls[0].sql,'BEGIN');
 assert.equal(calls.at(-1).sql,'COMMIT');
 const update=calls.find(x=>x.sql.startsWith('UPDATE inventory_items'));
 assert.deepEqual(update.args,[itemId,10]);
 assert(/SET reorder_level=/.test(update.sql));
 assert(!/SET quantity=/.test(update.sql));
 const audit=calls.find(x=>x.sql.startsWith('INSERT INTO pos_audit'));
 assert(audit,'audit is mandatory');
 assert.equal(audit.args[1],itemId);
});
test('threshold remains unchanged when value already matches; no write or audit',async()=>{
 const itemId=randomUUID(),calls=[],c={
  query:async(sql)=>{calls.push(sql);return {rows:sql.startsWith('SELECT')?[{id:itemId,name:'X',reorder_level:'10.000'}]:[]}},
  release(){}
 };
 const ops=makeOperations({pool:{connect:async()=>c},id:randomUUID});
 const result=await ops.updateReorderLevel(itemId,{reorderLevel:10});
 assert.equal(result.unchanged,true);
 assert(!calls.some(q=>/^UPDATE|^INSERT/.test(q)));
 assert.equal(calls.at(-1),'COMMIT');
});
test('failed threshold audit rolls the transaction back',async()=>{
 const itemId=randomUUID(),calls=[],c={
  query:async sql=>{calls.push(sql);
   if(sql.startsWith('SELECT'))return {rows:[{id:itemId,reorder_level:'5'}]};
   if(sql.startsWith('UPDATE'))return {rows:[{id:itemId,reorder_level:'8'}]};
   if(sql.startsWith('INSERT INTO pos_audit'))throw Error('Simulated audit failure');
   return {rows:[]};
  },release(){}
 };
 const ops=makeOperations({pool:{connect:async()=>c},id:randomUUID});
 await assert.rejects(ops.updateReorderLevel(itemId,{reorderLevel:8}),/Simulated audit failure/);
 assert.equal(calls.at(-1),'ROLLBACK');
 assert(!calls.includes('COMMIT'));
});
