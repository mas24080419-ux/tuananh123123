'use strict';
// Authenticated employee browser activity: ephemeral, not an order, stock or finance record.
// Never export user IDs, names, email, IPs, session IDs or cart contents.
module.exports=function staffOrderPresence({now=()=>Date.now(),ttlMs=45000,maxSessions=2500}={}){
 const sessions=new Map();
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const err=(message,status=400)=>Object.assign(Error(message),{status});
 const allowed=new Set(['viewing','selecting','submitting','ordered']);
 const permitted=actor=>Boolean(actor?.userId&&!actor.workArea&&['admin','manager','cashier','waiter'].includes(actor.role));
 function prune(){const t=now();for(const [key,s] of sessions)if(s.lastSeen+ttlMs<=t)sessions.delete(key)}
 async function heartbeat(body,actor,lookup){
  if(!permitted(actor))throw err('Không có quyền cập nhật phiên gọi món.',403);
  prune();
  const id=body?.sessionId,tableId=body?.tableId||null;
  if(typeof id!=='string'||!uuid.test(id)||tableId!==null&&(typeof tableId!=='string'||!uuid.test(tableId)))throw err('Phiên hoặc bàn không hợp lệ.');
  const old=sessions.get(id);
  if(old&&old.userId!==actor.userId)throw err('Phiên thuộc tài khoản khác.',403);
  if(!old&&sessions.size>=maxSessions)throw err('Đã đạt giới hạn phiên theo dõi.',503);
  let tableName=tableId?'Chưa xác minh': 'Chưa chọn bàn';
  if(tableId){
   if(old?.tableId===tableId)tableName=old.tableName;
   else{
    const table=await lookup(tableId);
    if(!table?.active)throw err('Bàn không còn hoạt động.',404);
    tableName=String(table.name||'Bàn').slice(0,80);
   }
  }
  const stage=allowed.has(body?.stage)?body.stage:'viewing';
  const cartItems=Number.isSafeInteger(body?.cartItems)&&body.cartItems>=0&&body.cartItems<=60?body.cartItems:0;
  sessions.set(id,{userId:actor.userId,tableId,tableName,lastSeen:now(),stage,cartItems});
  return {ok:true,ttlSeconds:Math.ceil(ttlMs/1000)};
 }
 function leave(body,actor){
  if(!permitted(actor))throw err('Không có quyền kết thúc phiên.',403);
  const id=body?.sessionId;
  if(typeof id==='string'&&uuid.test(id)&&sessions.get(id)?.userId===actor.userId)sessions.delete(id);
  return {ok:true};
 }
 function snapshot(){
  prune();
  const totals={activeSessions:0,viewingSessions:0,selectingSessions:0,submittingSessions:0,orderedSessions:0,cartItems:0,activeTables:0};
  const grouped=new Map();
  for(const s of sessions.values()){
   totals.activeSessions++;
   const key=s.stage==='selecting'?'selectingSessions':s.stage==='submitting'?'submittingSessions':s.stage==='ordered'?'orderedSessions':'viewingSessions';
   totals[key]++;
   if(s.stage==='selecting'||s.stage==='submitting')totals.cartItems+=s.cartItems;
   const name=s.tableName;
   if(!grouped.has(name))grouped.set(name,{tableName:name,activeSessions:0,viewingSessions:0,selectingSessions:0,submittingSessions:0,orderedSessions:0,cartItems:0});
   const group=grouped.get(name);group.activeSessions++;group[key]++;
   if(s.stage==='selecting'||s.stage==='submitting')group.cartItems+=s.cartItems;
  }
  totals.activeTables=[...sessions.values()].filter(x=>x.tableId).reduce((a,x)=>(a.add(x.tableId),a),new Set()).size;
  return {...totals,tables:[...grouped.values()].sort((a,b)=>b.selectingSessions-a.selectingSessions||b.activeSessions-a.activeSessions).slice(0,30),
   ttlSeconds:Math.ceil(ttlMs/1000),scope:'Phiên gọi món nhân viên đã xác thực; giỏ hàng trong trình duyệt, chỉ lưu tạm RAM. Không phải đơn đã xác nhận hay trừ tồn kho.'};
 }
 return {heartbeat,leave,snapshot};
};
