'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {model}=require('../architecture-monitor');
const makeFlow=require('../system-flow');
const makeOrderFlow=require('../order-flow-live');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('architecture graph has a real employee order node with a distinct inbound path',()=>{
 const nodes=new Set(model.nodes.map(n=>n.id));
 const edges=new Set(model.edges.map(e=>e.from+'-'+e.to));
 assert(nodes.has('stafforder'));
 assert(nodes.has('orders'));
 assert(model.flows.some(f=>f.id==='stafforder'));
 for(const id of ['stafforder-http','http-auth','auth-orders','orders-inventory','orders-kds','orders-postgres','orders-finance']){
  assert(edges.has(id),'missing employee-order path segment '+id);
 }
 const node=model.nodes.find(n=>n.id==='stafforder');
 assert(node.routes.includes('POST /api/staff/orders'));
 assert(node.routes.includes('POST /api/staff/orders/:id/confirm-payment'));
 assert(!JSON.stringify(model).includes('ca thu ngân và nhật ký'));
});

test('employee orders are captured as a sanitized module, but reads are not counted as writes',()=>{
 const flow=makeFlow({pool:null});
 assert.deepEqual(flow.classify('POST','/api/staff/orders'),{module:'stafforder',route:'/api/staff/orders',method:'POST'});
 assert.deepEqual(flow.classify('POST','/api/staff/orders/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/confirm-payment'),{
  module:'finance',route:'/api/staff/orders/:id/confirm-payment',method:'POST'
 });
 assert.equal(flow.classify('GET','/api/staff/orders'),null);
 assert.equal(flow.classify('GET','/api/staff/menu'),null);
 assert.equal(flow.classify('POST','/api/users/login'),null);
 assert.equal(flow.classify('POST','/api/admin/architecture/recent'),null);
});

test('committed audit identifies employee-created orders without exporting account details',async()=>{
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const pool={query:async query=>{
  const sql=typeof query==='string'?query:query.text;
  if(sql.includes('FROM dining_orders o JOIN dining_tables t'))return {rows:[{id,created_at:'2026-10-28T10:00:00Z',payment_status:'unpaid',table_name:'Bàn 1'}]};
  if(sql.includes('FROM dining_order_lines WHERE order_id='))return {rows:[{order_id:id,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'Trà',station:'bar',quantity:1,status:'new'}]};
  if(sql.includes('FROM dining_audit'))return {rows:[{id:'5',order_id:id,item_id:null,action:'order_created',actor:'staff',created_at:'2026-10-28T10:00:00Z',secretEmployee:'never send this'}]};
  throw Error('Unexpected query');
 }};
 const feed=makeOrderFlow({pool});
 const snapshot=await feed.recent();
 assert.equal(snapshot.orders[0].source,'staff');
 assert.equal(snapshot.events[0].action,'order_created');
 assert(!JSON.stringify(snapshot).includes('secretEmployee'));
 assert(!JSON.stringify(snapshot).includes('never send this'));
});

test('deep map and live timeline display staff source and replay only observed steps',()=>{
 const detail=read('public/architecture-deep.js');
 const player=read('public/architecture-path.js');
 const live=read('public/architecture-live.js');
 const overview=read('public/architecture.js');
 const html=read('public/architecture.html');
 for(const [name,script] of [['deep',detail],['path',player],['live',live],['overview',overview]]){
  assert.doesNotThrow(()=>new vm.Script(script,{filename:name+'.js'}));
 }
 assert(detail.includes("id:'stafforder'"));
 assert(detail.includes("['stafforder','Nhân viên gọi món']"));
 assert(detail.includes("['stafforder','http','stafforder']"));
 assert(player.includes("trace.module==='stafforder'"));
 assert(player.includes("flow.source==='staff'"));
 assert(player.includes("data?.verifiedOrders"));
 assert(player.includes("elapsedMs:null"));
 assert(live.includes("o.source==='staff'"));
 assert(live.includes("'stafforder-http'"));
 assert(overview.includes("modelState.filter==='stafforder'"));
 assert(html.includes('QR khách gọi món và nhân viên tạo/kiểm soát đơn'));
});
