'use strict';
// Owner-only cross-module observability. Business events are read from already committed
// PostgreSQL rows; API measurements exist only in memory for this Node process.
// No request bodies, tokens, names, phone numbers or raw dynamic URLs are retained.
function makeSystemFlow({pool,intervalMs=4000,maxClients=4,now=()=>new Date().toISOString()}){
 const subscribers=new Set(),requests=[];
 let timer=null,running=false,revision=0;
 const telemetry=require('./processing-telemetry')({now,publish:message=>{
  const line='event: trace\n'+'data: '+JSON.stringify(message)+'\n\n';
  for(const sub of subscribers)if(!sub.res.destroyed&&!sub.res.writableEnded)try{sub.res.write(line)}catch{}
 }});
 const fail=(message,status=503)=>Object.assign(Error(message),{status});
 const classify=(method,path)=>{
  if(!path.startsWith('/api/')||path.startsWith('/api/admin/architecture')||path==='/api/me'||path==='/api/health'||/login|logout|password|activate-owner|recipient|payment-banks/.test(path))return null;
  const rules=[
   [/^\/api\/orders$/, 'orders','/api/orders'],
   [/^\/api\/order-status\//,'orders','/api/order-status/:id'],
   [/^\/api\/menu\//,'orders','/api/menu/:token'],
   [/^\/api\/kds$/, 'kds','/api/kds'],
   [/^\/api\/items\//,'kds','/api/items/:id'],
   [/^\/api\/admin\/inventory/,'inventory','/api/admin/inventory/*'],
   [/^\/api\/admin\/finance/,'finance','/api/admin/finance/*'],
   [/^\/api\/admin\/analytics/,'finance','/api/admin/analytics'],
   [/^\/api\/admin\/summary/,'finance','/api/admin/summary'],
   [/^\/api\/admin\/orders\//,'finance','/api/admin/orders/:id/confirm-payment'],
   [/^\/api\/lockers/,'rental','/api/lockers/*'],
   [/^\/api\/area\/receipts/,'rental','/api/area/receipts'],
   [/^\/api\/admin\/core/,'admin','/api/admin/core/*'],
   [/^\/api\/admin\/users/,'admin','/api/admin/users/*'],
   [/^\/api\/tables/,'admin','/api/tables'],
   [/^\/api\/history/,'orders','/api/history']
  ];
  const matched=rules.find(([re])=>re.test(path));
  return matched?{module:matched[1],route:matched[2],method}:null;
 };
 function trackRequest(req,res){
  const path=(req.url||'').split('?')[0];
  const target=classify(req.method||'GET',path);
  if(!target)return;
  telemetry.start(req,res,target);
  const started=process.hrtime.bigint();
  res.once('finish',()=>{
   const durationMs=Math.round(Number(process.hrtime.bigint()-started)/1e6);
   requests.unshift({id:'http-'+(++revision),module:target.module,route:target.route,method:target.method,status:res.statusCode,durationMs,occurredAt:now(),source:'http-memory'});
   if(requests.length>60)requests.length=60;
   if(subscribers.size)void pulse();
  });
 }
 // Events come from committed rows. All selected columns are categorical;
 // no customer/employee identifiers, QR secrets, or payment account data.
 const sql=[
  'SELECT * FROM (',
  "SELECT 'dining:'||id::text AS id,CASE WHEN action='item_status_changed' THEN 'kds' WHEN action='payment_confirmed' THEN 'finance' ELSE 'orders' END AS module,action,created_at AS occurred_at,'dining_audit' AS source FROM dining_audit WHERE created_at>now()-interval '24 hours'",
  'UNION ALL',
  "SELECT 'stock:'||id::text,'inventory',kind,created_at,'inventory_movements' FROM inventory_movements WHERE created_at>now()-interval '24 hours'",
  'UNION ALL',
  "SELECT 'finance:'||id::text,'finance',direction||':'||source,created_at,'finance_entries' FROM finance_entries WHERE created_at>now()-interval '24 hours'",
  'UNION ALL',
  "SELECT 'pos:'||id::text,CASE WHEN entity IN ('locker_rental','area_receipt') THEN 'rental' WHEN entity LIKE 'inventory%' THEN 'inventory' ELSE 'admin' END,entity||':'||action,created_at,'pos_audit' FROM pos_audit WHERE created_at>now()-interval '24 hours'",
  'UNION ALL',
  "SELECT 'locker:'||id::text,'rental','rental_opened',created_at,'locker_rentals' FROM locker_rentals WHERE created_at>now()-interval '24 hours'",
  'UNION ALL',
  "SELECT 'rental:'||id::text,'rental',area||':'||service,created_at,'area_receipts' FROM area_receipts WHERE created_at>now()-interval '24 hours'",
  ') e ORDER BY occurred_at DESC,id DESC LIMIT 100'
 ].join(' ');
 async function recent(){
   if(!pool)throw fail('Luồng dữ liệu thực yêu cầu PostgreSQL.');
   const [result,countResult]=await Promise.all([
    pool.query({text:sql,query_timeout:4500}),
    pool.query({text:telemetry.metricsSql,query_timeout:4500})
   ]);
   return {checkedAt:now(),source:'postgresql + process-memory',
    events:result.rows.map(r=>({id:r.id,module:r.module,action:r.action,occurredAt:r.occurred_at,source:r.source})),
    requests:requests.slice(0,50),metrics:countResult.rows[0]||null,...telemetry.summary(),
    connectedOwners:subscribers.size,
    scope:'24h PostgreSQL counts and SSE execution steps in RAM; individual SQL statements are not traced'};
  }
  function send(res,payload){
  if(res.destroyed||res.writableEnded)return;
  res.write('event: system\n'+'data: '+JSON.stringify(payload)+'\n\n');
 }
 async function pulse(){
  if(running||!subscribers.size)return;
  running=true;
  try{
   const data=await recent();
   for(const sub of [...subscribers]){
    if(!sub.res.destroyed&&!sub.res.writableEnded)send(sub.res,data);
    if(Date.now()-sub.checked>30000){
     sub.checked=Date.now();
     try{if(!await sub.authorized())sub.res.end()}catch{sub.res.end()}
    }
   }
  }catch(e){
   console.error('system flow refresh failed:',e.message);
   for(const sub of [...subscribers])if(!sub.res.destroyed&&!sub.res.writableEnded)sub.res.write('event: offline\n'+'data: {"error":"Không truy vấn được dữ liệu PostgreSQL"}\n\n');
  }finally{running=false}
 }
 async function attach(req,res,authorized){
  if(!pool)throw fail('Chế độ pilot không hỗ trợ giám sát sự kiện thực.');
  if(subscribers.size>=maxClients)throw fail('Đã đạt giới hạn phiên giám sát trực tiếp.',429);
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
  res.write(': connected\n\n');
  const sub={res,authorized,checked:Date.now()};
  subscribers.add(sub);
  const cleanup=()=>{
   subscribers.delete(sub);
   if(!subscribers.size&&timer){clearInterval(timer);timer=null}
  };
  res.on('close',cleanup);
  if(!timer)timer=setInterval(()=>{void pulse()},intervalMs);
  void pulse();
 }
 return {recent,attach,trackRequest,classify,mark:telemetry.mark,pulse};
}
module.exports=makeSystemFlow;
