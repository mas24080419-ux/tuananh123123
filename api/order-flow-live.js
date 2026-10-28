'use strict';
// PostgreSQL-backed read model + server-sent events for owner-only order flow.
// No fake stages. Events are read from dining_audit after transactions commit.
function makeOrderFlow({pool,intervalMs=2500,maxClients=5,now=()=>new Date().toISOString()}){
 const subscribers=new Set();
 let timer=null, busy=false, lastCursor=null, lastPayload=null, ticks=0;
 const fail=(message,status=503)=>Object.assign(Error(message),{status});
 const idSafe=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/i.test(x);
 const auditActions=['order_validated','inventory_checked','order_created','item_status_changed','payment_confirmed'];
 async function recent(){
  if(!pool)throw fail('Theo dõi đơn trực tiếp yêu cầu PostgreSQL.');
  const orders=await pool.query({text:`SELECT o.id,o.created_at,o.payment_status,t.name AS table_name
    FROM dining_orders o JOIN dining_tables t ON t.id=o.table_id
    WHERE o.created_at>=now()-interval '24 hours'
      OR EXISTS (SELECT 1 FROM dining_order_lines li WHERE li.order_id=o.id AND li.status IN ('new','preparing','ready'))
    ORDER BY o.created_at DESC,o.id DESC LIMIT 20`,query_timeout:4000});
  const ids=orders.rows.map(x=>x.id);
  if(!ids.length)return {checkedAt:now(),orders:[],events:[],cursor:'0',source:'postgresql'};
  const [items,audits]=await Promise.all([
   pool.query({text:`SELECT order_id,id,name,station,quantity,status,created_at,updated_at
       FROM dining_order_lines WHERE order_id=ANY($1::uuid[])
       ORDER BY created_at,id LIMIT 350`,values:[ids],query_timeout:4000}),
   pool.query({text:`SELECT id::text,order_id,item_id,action,created_at,
       actor,detail->>'from' AS previous_status,detail->>'to' AS next_status
       FROM dining_audit
       WHERE order_id=ANY($1::uuid[]) AND action=ANY($2::text[])
       ORDER BY id DESC LIMIT 400`,values:[ids,auditActions],query_timeout:4000})
  ]);
  const lines=new Map(ids.map(id=>[id,[]]));
  for(const item of items.rows){
   const line={id:item.id,name:item.name,station:item.station,quantity:item.quantity,status:item.status,createdAt:item.created_at,updatedAt:item.updated_at};
   lines.get(item.order_id)?.push(line);
  }
  const itemNames=new Map(items.rows.map(x=>[x.id,x.name]));
  const sourceByOrder=new Map(audits.rows.filter(e=>e.action==='order_created').map(e=>[e.order_id,e.actor==='staff'?'staff':e.actor==='guest'?'guest':'unknown']));
  const events=audits.rows.reverse().map(e=>({
   id:String(e.id),orderId:e.order_id,itemId:e.item_id||null,action:e.action,
   at:e.created_at,from:e.previous_status||null,to:e.next_status||null,
   itemName:e.item_id?itemNames.get(e.item_id)||null:null
  }));
  const maxCursor=audits.rows.reduce((max,e)=>BigInt(e.id)>BigInt(max)?e.id:max,'0');
  return {
   checkedAt:now(),source:'postgresql',cursor:String(maxCursor),
   orders:orders.rows.map(o=>({id:o.id,tableName:o.table_name,createdAt:o.created_at,paymentStatus:o.payment_status,source:sourceByOrder.get(o.id)||'unknown',items:lines.get(o.id)||[]})),
   events
  };
 }
 async function cursor(){
  if(!pool)throw fail('Không có PostgreSQL.');
  const r=await pool.query({text:'SELECT id::text FROM dining_audit ORDER BY id DESC LIMIT 1',query_timeout:4000});
  return r.rows[0]?.id||'0';
 }
 const send=(res,payload)=>{
  if(res.destroyed||res.writableEnded)return;
  res.write('event: snapshot\n'+'id: '+String(payload.cursor||0)+'\n'+'data: '+JSON.stringify(payload)+'\n\n');
 };
 async function pulse(force=false){
  if(busy||!subscribers.size)return;
  busy=true;
  try{
   const current=await cursor();
   // A full reload every 12 cycles also removes orders outside the 24h window.
   if(force||current!==lastCursor||!lastPayload||++ticks%12===0){
    const payload=await recent();
    lastCursor=current;lastPayload=payload;
    for(const sub of [...subscribers])send(sub.res,payload);
   }else for(const sub of [...subscribers]){
    if(!sub.res.destroyed&&!sub.res.writableEnded)sub.res.write(': heartbeat\n\n');
   }
   // Revalidate the owner session even while the same EventSource stays connected.
   for(const sub of [...subscribers]){
    if(Date.now()-sub.lastAuthCheck>=30000){
     sub.lastAuthCheck=Date.now();
     try{if(!await sub.authorized())sub.res.end()}catch{sub.res.end()}
    }
   }
  }catch(error){
   console.error('live order flow check failed',error.message);
   for(const sub of [...subscribers]){
    if(!sub.res.destroyed&&!sub.res.writableEnded)sub.res.write('event: offline\n'+'data: {"message":"Không truy vấn được luồng đơn. Đang kết nối lại."}\n\n');
   }
  }finally{busy=false}
 }
 const stopIfIdle=()=>{
  if(!subscribers.size&&timer){clearInterval(timer);timer=null;lastPayload=null;lastCursor=null;ticks=0;}
 };
 async function attach(req,res,authorized){
  if(!pool)throw fail('Tính năng theo dõi đơn yêu cầu PostgreSQL.');
  if(subscribers.size>=maxClients)throw fail('Đã có quá nhiều kết nối giám sát.',429);
  const first=await recent();
  res.writeHead(200,{
   'Content-Type':'text/event-stream; charset=utf-8',
   'Cache-Control':'no-store, no-transform',
   'Connection':'keep-alive','X-Accel-Buffering':'no',
   'Vary':'Cookie'
  });
  res.write('retry: 2500\n\n');
  const sub={res,authorized,lastAuthCheck:Date.now()};
  subscribers.add(sub);
  send(res,first);
  const remove=()=>{subscribers.delete(sub);stopIfIdle()};
  res.once('close',remove);
  if(!timer)timer=setInterval(()=>{void pulse()},intervalMs);
  return undefined;
 }
 return {recent,attach,pulse,cursor,stats:()=>({clients:subscribers.size})};
}
module.exports=makeOrderFlow;
