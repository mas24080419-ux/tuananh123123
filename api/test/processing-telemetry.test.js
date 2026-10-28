'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const makeSystemFlow=require('../system-flow');
function setup(){
 const queries=[];
 const pool={query:async q=>{
  const text=typeof q==='string'?q:q.text;queries.push(text);
  if(text.includes('AS "orders24h"'))return {rows:[{orders24h:3,itemsWaiting:2,itemsPreparing:1,itemsReady:1,stockMovements24h:4,financeEntries24h:2,occupiedLockers:1,serviceReceipts24h:2,auditEvents24h:9}]};
  return {rows:[]};
 }};
 return {flow:makeSystemFlow({pool}),queries};
}
test('Order trace records real stage boundaries, preserves order and releases in-flight count',async()=>{
 const {flow}=setup();
 const req={method:'POST',url:'/api/orders?token=SHOULD_NOT_LEAK'};
 const res=new EventEmitter();res.statusCode=201;
 flow.trackRequest(req,res);
 let current=await flow.recent();
 assert.equal(current.inFlight,1);
 assert.equal(current.active[0].steps[0].node,'http');
 flow.mark(req,'validate','QR và số lượng hợp lệ',2);
 flow.mark(req,'orders','Đã ghi dòng món, chưa commit');
 flow.mark(req,'inventory','Đã cập nhật tồn tạm');
 flow.mark(req,'tx','Đang chờ COMMIT');
 flow.mark(req,'pg','PostgreSQL COMMIT thành công');
 res.emit('finish');
 current=await flow.recent();
 assert.equal(current.inFlight,0);
 assert.equal(current.traces[0].state,'success');
 assert.equal(current.traces[0].status,201);
 assert.deepEqual(current.traces[0].steps.map(x=>x.node),['http','validate','orders','inventory','tx','pg','http']);
 assert.equal(current.traces[0].count,2);
 assert.doesNotMatch(JSON.stringify(current),/SHOULD_NOT_LEAK/);
 assert.equal(current.metrics.orders24h,3);
 assert.equal(current.metrics.itemsWaiting,2);
});
test('Failed request never shows a successful COMMIT and leaves in-flight state',async()=>{
 const {flow}=setup();
 const req={method:'POST',url:'/api/orders'};
 const res=new EventEmitter();res.statusCode=409;
 flow.trackRequest(req,res);
 flow.mark(req,'validate','Số lượng hợp lệ');
 flow.mark(req,'tx','ROLLBACK: đơn chưa lưu');
 res.emit('finish');
 const snap=await flow.recent();
 assert.equal(snap.traces[0].state,'failed');
 assert.equal(snap.traces[0].status,409);
 assert.ok(!snap.traces[0].steps.some(x=>x.node==='pg'));
 assert.equal(snap.inFlight,0);
});
test('Read-only kitchen requests expose observed SELECT steps without claiming COMMIT',async()=>{
 const {flow}=setup();
 const req={method:'GET',url:'/api/kds'};
 const res=new EventEmitter();res.statusCode=200;
 flow.trackRequest(req,res);
 flow.mark(req,'auth','Xác thực nhân viên');
 flow.mark(req,'kds','Đang tải bếp');
 flow.mark(req,'pg','SELECT hàng chờ hoàn thành',4);
 res.emit('finish');
 const snap=await flow.recent();
 assert.equal(snap.active.length,0);
 assert.equal(snap.traces.length,1);
 assert.equal(snap.traces[0].readOnly,true);
 assert.deepEqual(snap.traces[0].steps.map(x=>x.node),['http','auth','kds','pg','http']);
 assert(!snap.traces[0].steps.some(x=>/COMMIT/i.test(x.label)));
 assert.equal(snap.requests[0].route,'/api/kds');
});
test('New telemetry code does not expose secret names, raw URLs or request bodies',async()=>{
 const {flow}=setup();
 const req={method:'POST',url:'/api/lockers/A1/rent?phone=012345678'};
 const res=new EventEmitter();res.statusCode=200;
 flow.trackRequest(req,res);flow.mark(req,'rental','Ghi phiếu thuê');res.emit('finish');
 const body=JSON.stringify(await flow.recent());
 assert.doesNotMatch(body,/012345678|\/api\/lockers\/A1/);
 assert.match(body,/\/api\/lockers\/\*/);
});
