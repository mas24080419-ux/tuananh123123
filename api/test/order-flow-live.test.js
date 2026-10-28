'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs');
const path=require('node:path');
const build=require('../order-flow-live');
const front=fs.readFileSync(path.join(__dirname,'../public/architecture-live.js'),'utf8');
const page=fs.readFileSync(path.join(__dirname,'../public/architecture.html'),'utf8');
const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
function makeDb(){
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',line='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 let seq=3,status='new';const sql=[];
 const pool={async query(q){
  const text=typeof q==='string'?q:q.text;
  sql.push(text);
  if(text.includes('FROM dining_orders o JOIN dining_tables t')){
   return {rows:[{id,created_at:'2026-10-28T06:00:00Z',payment_status:'unpaid',table_name:'Bàn 02'}]};
  }
  if(text.includes('FROM dining_order_lines WHERE order_id=')){
   return {rows:[{order_id:id,id:line,name:'Trà đào',station:'bar',quantity:2,status,created_at:'2026-10-28T06:00:00Z',updated_at:'2026-10-28T06:00:00Z'}]};
  }
  if(text.includes('FROM dining_audit')&&text.includes('ORDER BY id DESC LIMIT 1'))return {rows:[{id:String(seq)}]};
  if(text.includes('FROM dining_audit')){
   return {rows:[{id:'3',order_id:id,item_id:null,action:'order_created',created_at:'2026-10-28T06:00:00Z',
    previous_status:null,next_status:null},...(seq>3?[{id:'4',order_id:id,item_id:line,action:'item_status_changed',
    created_at:'2026-10-28T06:01:00Z',previous_status:'new',next_status:'preparing'}]:[])]};
  }
  throw Error('Unexpected query: '+text);
 }};
 return {pool,sql,id,line,setSeq(n){seq=n;status=n>3?'preparing':'new'}};
}
test('order feed reads actual PostgreSQL orders, item states, and whitelisted audit without personal data',async()=>{
 const db=makeDb(),feed=build({pool:db.pool});
 const d=await feed.recent();
 assert.equal(d.source,'postgresql');
 assert.equal(d.orders[0].tableName,'Bàn 02');
 assert.equal(d.orders[0].items[0].name,'Trà đào');
 assert.equal(d.orders[0].items[0].status,'new');
 assert.equal(d.events[0].action,'order_created');
 assert.equal(d.cursor,'3');
 assert(db.sql.every(q=>/^SELECT\s/i.test(q)));
 assert(db.sql.every(q=>!/\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bALTER\b/i.test(q)));
 assert(db.sql.some(q=>q.includes("query_timeout")===false)); // timeout is a query property, not interpolated SQL
 assert(!JSON.stringify(d).match(/customerPhone|token|payment_account/));
 db.setSeq(4);const next=await feed.recent();
 assert.equal(next.events.length,2);
 assert.equal(next.events.find(event=>event.action==='item_status_changed').to,'preparing');
 assert.equal(next.orders[0].items[0].status,'preparing');
});
test('pilot mode fails closed, not fabricated live order data',async()=>{
 const feed=build({pool:null});
 await assert.rejects(feed.recent(),{status:503});
});
test('owner stream connects, sends a real snapshot, emits updates, and releases resources on close',async()=>{
 const db=makeDb(),feed=build({pool:db.pool,intervalMs:20000});
 const res=new EventEmitter();const writes=[];
 res.destroyed=false;res.writableEnded=false;res.writeHead=(status,headers)=>{res.status=status;res.headers=headers};
 res.write=x=>{writes.push(x);return true};res.end=()=>{res.writableEnded=true;res.emit('close')};
 await feed.attach(new EventEmitter(),res,async()=>true);
 assert.equal(res.status,200);
 assert.equal(res.headers['Content-Type'],'text/event-stream; charset=utf-8');
 assert(writes.some(x=>x.includes('event: snapshot')));
 assert.equal(feed.stats().clients,1);
 db.setSeq(4);await feed.pulse(true);
 assert(writes.some(x=>x.includes('item_status_changed')));
 res.end();
 assert.equal(feed.stats().clients,0);
});
test('server persists trace markers inside order transaction and publishes only after COMMIT',()=>{
 assert(server.includes("'order_validated'"));
 assert(server.includes("'inventory_checked'"));
 assert(server.includes("'order_created'"));
 const orderPath=server.slice(server.indexOf('async function placeOrder'),server.indexOf('async function getOrders'));
 assert(orderPath.indexOf("'order_validated'")<orderPath.indexOf('await ops.consume(c,orderId)'));
 assert(orderPath.indexOf("'inventory_checked'")>orderPath.indexOf('await ops.consume(c,orderId)'));
 assert(orderPath.indexOf("'inventory_checked'")<orderPath.indexOf("await c.query('COMMIT');void orderLive.pulse(true)"));
 assert(orderPath.indexOf("await c.query('COMMIT');void orderLive.pulse(true)")>0);
 assert(server.includes("void orderLive.pulse(true);return row"));
});
test('live SSE and reconnect API are authenticated as owner on backend',()=>{
 for(const endpoint of ['/api/admin/architecture/live','/api/admin/architecture/recent']){
  const start=server.indexOf("p==='"+endpoint+"'");
  assert(start>0,endpoint);
  assert(server.slice(start,start+180).includes('requireAdmin(req,res)'),endpoint+' must check role');
 }
 assert(front.includes('new EventSource('));
 assert(front.includes("credentials:'same-origin'"));
 assert(front.includes('setInterval(()=>{void reload()},5000)'));
 assert(page.includes('id="liveOrderList"'));
 assert(page.includes('id="liveOrderDetail"'));
 assert(page.includes('/architecture-live.css'));
 assert(page.includes('/architecture-live.js'));
 assert(front.includes('escape(value)')||front.includes('const escape=value=>'));
});
