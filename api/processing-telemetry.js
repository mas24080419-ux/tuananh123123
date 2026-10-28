'use strict';
// In-flight, privacy-safe operation traces; never assert a DB write before the caller
// marks the COMMIT step. All trace data lives in this Render process (not durable).
const crypto=require('node:crypto');
module.exports=function processingTelemetry({now=()=>new Date().toISOString(),publish=()=>{}}={}){
 const active=new Map(),recent=[];
 const allowed=new Set(['http','auth','validate','orders','kds','inventory','finance','rental','admin','tx','pg','audit','stream']);
 const exportTrace=t=>({id:t.id,module:t.module,method:t.method,route:t.route,state:t.state,status:t.status,
  count:t.count,readOnly:t.readOnly,createdAt:t.createdAt,finishedAt:t.finishedAt,durationMs:t.durationMs,
  steps:t.steps.map(x=>({...x}))});
 const emit=(t,type)=>publish({type,trace:exportTrace(t)});
 function mark(req,node,label,count){
  const t=req?._flowTrace;
  if(!t||t.state!=='running'||!allowed.has(node))return false;
  if(Number.isSafeInteger(count)&&count>=0&&count<=10000)t.count=count;
  const prev=t.steps[t.steps.length-1];
  if(prev?.node===node&&prev.label===label)return false;
  t.steps.push({node,label:String(label).slice(0,90),at:now(),elapsedMs:Math.round(Number(process.hrtime.bigint()-t.started)/1e6)});
  if(t.steps.length>32)t.steps.shift();
  emit(t,'step');return true;
 }
 function start(req,res,target){
  if(!target)return;
  const readOnly=req.method==='GET'&&['/api/kds','/api/admin/inventory','/api/admin/analytics','/api/admin/summary','/api/lockers'].includes(target.route);
  if(!readOnly&&!['POST','PATCH','PUT','DELETE'].includes(req.method))return;
  const t={id:crypto.randomUUID(),module:target.module,method:target.method,route:target.route,
   count:null,readOnly,state:'running',status:null,started:process.hrtime.bigint(),createdAt:now(),finishedAt:null,durationMs:null,steps:[]};
  req._flowTrace=t;active.set(t.id,t);
  mark(req,'http',readOnly?'Đã tiếp nhận yêu cầu đọc dữ liệu':'HTTP request đã tiếp nhận');
  let closed=false;
  const done=aborted=>{
   if(closed)return;closed=true;
   t.durationMs=Math.round(Number(process.hrtime.bigint()-t.started)/1e6);
   t.finishedAt=now();t.status=aborted?499:res.statusCode;
   t.state=aborted?'aborted':t.status>=200&&t.status<400?'success':'failed';
   t.steps.push({node:'http',label:t.state==='success'?'HTTP phản hồi thành công':t.state==='failed'?'HTTP phản hồi lỗi':'Ngắt kết nối',at:t.finishedAt,elapsedMs:t.durationMs});
   active.delete(t.id);recent.unshift(exportTrace(t));
   if(recent.length>70)recent.length=70;
   emit(t,'finish');
  };
  res.once('finish',()=>done(false));
  res.once('close',()=>{if(!res.writableEnded)done(true)});
 }
 function summary(){return {inFlight:active.size,active:[...active.values()].map(exportTrace),traces:recent.slice(0,40)}}
 const metricsSql=[
  'SELECT',
  '(SELECT count(*)::int FROM dining_orders WHERE created_at>=now()-interval \'24 hours\') AS "orders24h",',
  '(SELECT count(*)::int FROM dining_orders o WHERE EXISTS (SELECT 1 FROM dining_order_lines li WHERE li.order_id=o.id AND li.status IN (\'new\',\'preparing\',\'ready\'))) AS "ordersInProgress",',
  '(SELECT count(*)::int FROM dining_orders o WHERE EXISTS (SELECT 1 FROM dining_order_lines li WHERE li.order_id=o.id AND li.status=\'preparing\')) AS "ordersPreparing",',
  '(SELECT count(*)::int FROM dining_order_lines WHERE status=\'new\') AS "itemsWaiting",',
  '(SELECT count(*)::int FROM dining_order_lines WHERE status=\'preparing\') AS "itemsPreparing",',
  '(SELECT count(*)::int FROM dining_order_lines WHERE status=\'ready\') AS "itemsReady",',
  '(SELECT count(*)::int FROM dining_order_lines WHERE status=\'served\' AND updated_at>=now()-interval \'24 hours\') AS "itemsServed24h",',
  '(SELECT count(*)::int FROM inventory_movements WHERE created_at>=now()-interval \'24 hours\') AS "stockMovements24h",',
  '(SELECT count(*)::int FROM finance_entries WHERE created_at>=now()-interval \'24 hours\') AS "financeEntries24h",',
  '(SELECT count(*)::int FROM locker_rentals WHERE ended_at IS NULL) AS "occupiedLockers",',
  '(SELECT count(*)::int FROM area_receipts WHERE created_at>=now()-interval \'24 hours\') AS "serviceReceipts24h",',
  '(SELECT count(*)::int FROM inventory_items WHERE active=true AND quantity<=reorder_level) AS "lowStock",',
  '(SELECT count(*)::int FROM dining_audit WHERE created_at>=now()-interval \'24 hours\') AS "auditEvents24h"'
 ].join(' ');
 return {start,mark,summary,metricsSql};
};
