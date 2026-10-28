'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const makeSystemFlow=require('../system-flow');

function fakeFlow(){
 const seen=[];
 const pool={query:async statement=>{
  seen.push(statement);
  return {rows:[{id:'dining:1',module:'orders',action:'order_created',occurred_at:'2026-10-28T07:00:00.000Z',source:'dining_audit'}]};
 }};
 return {flow:makeSystemFlow({pool,now:()=> '2026-10-28T07:01:00.000Z'}),seen};
}
test('Sanitize dynamic routes and exclude owner authentication and observability self traffic',()=>{
 const {flow}=fakeFlow();
 assert.deepEqual(flow.classify('POST','/api/orders'),{module:'orders',route:'/api/orders',method:'POST'});
 assert.equal(flow.classify('POST','/api/admin/login'),null);
 assert.equal(flow.classify('POST','/api/admin/change-password'),null);
 assert.equal(flow.classify('GET','/api/admin/architecture/system/live'),null);
 assert.equal(flow.classify('GET','/api/health'),null);
 assert.deepEqual(flow.classify('POST','/api/lockers/A1/rent'),{module:'rental',route:'/api/lockers/*',method:'POST'});
 assert.deepEqual(flow.classify('GET','/api/menu/secret-qr-token'),{module:'orders',route:'/api/menu/:token',method:'GET'});
});
test('Live model contains committed DB evidence and sanitized, ephemeral API telemetry',async()=>{
 const {flow,seen}=fakeFlow();
 const req={method:'POST',url:'/api/lockers/A30/rent?secret=token-and-user-phone'};
 const res=new EventEmitter();res.statusCode=201;
 flow.trackRequest(req,res);res.emit('finish');
 const data=await flow.recent();
 assert.equal(data.events[0].action,'order_created');
 assert.equal(data.events[0].source,'dining_audit');
 assert.equal(data.requests[0].module,'rental');
 assert.equal(data.requests[0].route,'/api/lockers/*');
 assert.equal(data.requests[0].status,201);
 assert.equal(data.requests[0].source,'http-memory');
 assert.ok(seen[0].text.includes('inventory_movements'));
 assert.ok(seen[0].text.includes('finance_entries'));
 assert.ok(seen[0].text.includes('pos_audit'));
 assert.ok(seen[0].text.includes('area_receipts'));
 assert.doesNotMatch(JSON.stringify(data),/token-and-user-phone/);
 assert.doesNotMatch(JSON.stringify(data),/\/api\/lockers\/A30\/rent/);
});
test('System stream rejects PostgreSQL-less pilot instead of generating fake events',async()=>{
 const flow=makeSystemFlow({pool:null});
 await assert.rejects(()=>flow.recent(),{status:503});
});
test('Production routes enforce owner access before system events and streams',()=>{
 const fs=require('node:fs');
 const path=require('node:path');
 const source=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
 for(const route of ['/api/admin/architecture/system/recent','/api/admin/architecture/system/live']){
  const pos=source.indexOf("p==='"+route+"'");
  assert.ok(pos>0,'route missing: '+route);
  const snippet=source.slice(pos,pos+260);
  assert.match(snippet,/requireAdmin\(req,res\)/);
 }
});

test('Durable committed QR audit reconstructs the real ordered milestones after a process restart',async()=>{
 const orderId='a61892b3-e3a6-4792-8b77-82964098fd6c';
 const audit=[
  {id:'22',order_id:orderId,action:'order_created',created_at:'2026-10-28T08:26:20.726Z',privatePhone:'012345678'},
  {id:'21',order_id:orderId,action:'inventory_checked',created_at:'2026-10-28T08:26:20.726Z'},
  {id:'20',order_id:orderId,action:'order_validated',created_at:'2026-10-28T08:26:20.726Z'}
 ];
 const db={query:async q=>{
  if(q.text.includes('order_id::text'))return {rows:audit};
  if(q.text.includes('AS "orders24h"'))return {rows:[{orders24h:4,ordersInProgress:2}]};
  return {rows:[]};
 }};
 const flow=makeSystemFlow({pool:db,now:()=> '2026-10-28T08:27:00.000Z'});
 const d=await flow.recent();
 assert.equal(d.verifiedOrders.length,1);
 assert.equal(d.verifiedOrders[0].orderId,orderId);
 assert.deepEqual(d.verifiedOrders[0].steps.map(x=>x.action),['order_validated','inventory_checked','order_created']);
 assert.deepEqual(d.verifiedOrders[0].steps.map(x=>x.id),['20','21','22']);
 assert.doesNotMatch(JSON.stringify(d),/012345678/);
 assert.equal(d.metrics.orders24h,4);
});
test('Architecture client uses persisted order count and recovers verified audit without manufacturing SQL spans',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const js=fs.readFileSync(path.join(__dirname,'../public/architecture-deep.js'),'utf8');
 const player=fs.readFileSync(path.join(__dirname,'../public/architecture-path.js'),'utf8');
 assert.match(js,/guest:\[m\.orders24h,'đơn QR \/ 24h'\]/);
 assert.match(player,/data\?\.verifiedOrders/);
 assert.match(player,/postgresql-audit/);
 assert.match(player,/elapsedMs:null/);
 assert.match(player,/Đã xác thực yêu cầu \(audit PostgreSQL\)/);
});
