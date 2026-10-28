'use strict';
// Approximate live browser sessions viewing the QR menu, not camera scans.
// Ephemeral, privacy-preserving in-memory state: no IPs, cookies or personal data.
module.exports=function qrPresence({now=()=>Date.now(),ttlMs=55000,maxSessions=2500,validationMs=30000}={}){
 const sessions=new Map(),validTables=new Map();
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
   table=await lookup(token);
   if(!table||table.active!==true)throw error('Mã QR đã hết hiệu lực.',404);
   validTables.set(token,{table:{id:table.id,name:table.name},validatedAt:now()});
  }
  // One browser tab contributes at most one active session. A session cannot
  // silently change tables: it is first removed before linking to the new table.
  if(!sessions.has(sessionId)&&sessions.size>=maxSessions)throw error('Hệ thống giám sát QR tạm quá tải.',503);
  sessions.set(sessionId,{tableId:table.id,tableName:table.name,lastSeen:now()});
  return {ok:true,ttlSeconds:Math.ceil(ttlMs/1000)};
 }
 function leave(body){
  if(typeof body?.sessionId==='string'&&uuid.test(body.sessionId))sessions.delete(body.sessionId);
  return {ok:true};
 }
 function snapshot(){
  cleanup();
  const byTable=new Map();
  for(const s of sessions.values()){
   const key=s.tableId;
   if(!byTable.has(key))byTable.set(key,{tableName:s.tableName,activeSessions:0});
   byTable.get(key).activeSessions++;
  }
  const tables=[...byTable.values()].sort((a,b)=>b.activeSessions-a.activeSessions||a.tableName.localeCompare(b.tableName,'vi')).slice(0,40);
  return {activeSessions:sessions.size,activeTables:byTable.size,tables,ttlSeconds:Math.ceil(ttlMs/1000),
   meaning:'Số phiên trình duyệt đang xem thực đơn QR, không phải lượt camera quét hay số người duy nhất',
   scope:'RAM một instance Render; không tính người chỉ quét camera mà không mở trang'};
 }
 return {heartbeat,leave,snapshot};
};
