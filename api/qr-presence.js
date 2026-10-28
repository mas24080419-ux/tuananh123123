'use strict';
// Approximate live browser sessions viewing the QR menu, not camera scans.
// Ephemeral, privacy-preserving in-memory state: no IPs, cookies or personal data.
module.exports=function qrPresence({now=()=>Date.now(),ttlMs=55000,maxSessions=2500,validationMs=30000}={}){
 const sessions=new Map(),validTables=new Map(),pendingTableChecks=new Map();
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 const tokenPattern=/^[0-9a-f]{48}$/i;
 const error=(message,status=400)=>Object.assign(Error(message),{status});
 function cleanup(){
  const time=now();
  for(const [key,s] of sessions)if(s.lastSeen+ttlMs<=time)sessions.delete(key);
  for(const [key,v] of validTables)if(v.validatedAt+validationMs<=time)validTables.delete(key);
 }
 async function heartbeat(body,lookup){
  cleanup();
  const sessionId=body?.sessionId,token=body?.token;
  if(typeof sessionId!=='string'||!uuid.test(sessionId)||typeof token!=='string'||!tokenPattern.test(token))
   throw error('Phiên QR không hợp lệ.');
  let table=validTables.get(token)?.table;
  if(!table){
   // Concurrent viewers of the same table reuse one PostgreSQL token lookup,
   // preventing a 100-device QR burst from launching 100 identical SELECTs.
   let pending=pendingTableChecks.get(token);
   if(!pending){
    pending=Promise.resolve().then(()=>lookup(token));
    pendingTableChecks.set(token,pending);
   }
   try{
    const result=await pending;
    if(!result||result.active!==true)throw error('Mã QR đã hết hiệu lực.',404);
    table={id:result.id,name:result.name};
    validTables.set(token,{table,validatedAt:now()});
   }finally{
    if(pendingTableChecks.get(token)===pending)pendingTableChecks.delete(token);
   }
  }
  // One browser tab contributes at most one active session. A session cannot
  // silently change tables: it is first removed before linking to the new table.
  if(!sessions.has(sessionId)&&sessions.size>=maxSessions)throw error('Hệ thống giám sát QR tạm quá tải.',503);
  // UI state is advisory telemetry (not proof of a committed order).
  const allowed=new Set(['viewing','selecting','submitting','ordered']);
  const stage=allowed.has(body?.stage)?body.stage:'viewing';
  const cartItems=Number.isSafeInteger(body?.cartItems)&&body.cartItems>=0&&body.cartItems<=60?body.cartItems:0;
  sessions.set(sessionId,{tableId:table.id,tableName:table.name,lastSeen:now(),stage,cartItems});
  return {ok:true,ttlSeconds:Math.ceil(ttlMs/1000)};
 }
 function leave(body){
  if(typeof body?.sessionId==='string'&&uuid.test(body.sessionId))sessions.delete(body.sessionId);
  return {ok:true};
 }
 function snapshot(){
  cleanup();
  const byTable=new Map();
  const total={activeSessions:sessions.size,activeTables:0,selectingSessions:0,submittingSessions:0,
   orderedSessions:0,cartItems:0,viewingSessions:0};
  for(const s of sessions.values()){
   const key=s.tableId;
   if(!byTable.has(key))byTable.set(key,{tableName:s.tableName,activeSessions:0,selectingSessions:0,
    submittingSessions:0,orderedSessions:0,cartItems:0,viewingSessions:0});
   const t=byTable.get(key);
   t.activeSessions++;
   const phaseKey=s.stage==='selecting'?'selectingSessions':s.stage==='submitting'?'submittingSessions':
    s.stage==='ordered'?'orderedSessions':'viewingSessions';
   t[phaseKey]++;total[phaseKey]++;
   if(s.stage==='selecting'||s.stage==='submitting'){
    t.cartItems+=s.cartItems;total.cartItems+=s.cartItems;
   }
  }
  total.activeTables=byTable.size;
  const tables=[...byTable.values()].sort((a,b)=>b.activeSessions-a.activeSessions||a.tableName.localeCompare(b.tableName,'vi')).slice(0,40);
  return {...total,tables,ttlSeconds:Math.ceil(ttlMs/1000),
   meaning:'Hoạt động các tab QR đang mở: xem thực đơn, chọn món trong giỏ, đang gửi yêu cầu và đã nhận phản hồi thành công. Số món là số tạm trong giỏ, chưa COMMIT.',
   scope:'Trạng thái gửi từ UI theo heartbeat, không phải chứng từ PostgreSQL, không đếm người duy nhất; RAM một instance Render.'};
 }
 return {heartbeat,leave,snapshot};
};
