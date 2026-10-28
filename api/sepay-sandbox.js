'use strict';
// Dedicated SePay TEST MODE receiver. This deliberately NEVER accesses PostgreSQL,
// does not create orders, does not update paid_amount and does not touch finance.
const {verify,parse,rawBody}=require('./bank-webhook');
const bad=(message,status=400)=>Object.assign(Error(message),{status});
module.exports=function createSepaySandbox({secret='',clock=()=>Date.now(),capacity=30}={}){
 const events=[];
 const known=new Set();
 const configured=Boolean(typeof secret==='string'&&secret.length>=24);
 async function receive(req){
  if(!configured)throw bad('Chưa cấu hình SEPAY_SANDBOX_SECRET.',503);
  const bytes=await rawBody(req);
  verify(bytes,req.headers,secret,clock());
  let payload;
  try{payload=JSON.parse(bytes.toString('utf8'))}catch{throw bad('JSON không hợp lệ.')}
  const event=parse(payload);
  const dedupeKey=event.bank+':'+event.id;
  if(known.has(dedupeKey))return {success:true,duplicate:true};
  known.add(dedupeKey);
  const info={
   id:event.id,bankBin:event.bank,accountTail:'••••'+event.account.slice(-4),
   amount:event.amount,reference:event.ref,
   type:event.incoming?'Tiền vào':'Tiền ra',receivedAt:new Date(clock()).toISOString(),
   status:event.bank?'Webhook thử hợp lệ':'Ngân hàng chưa hỗ trợ',
   mode:'sandbox',noRealPayment:true
  };
  events.unshift(info);
  while(events.length>capacity){
   const removed=events.pop();
   known.delete(removed.bankBin+':'+removed.id);
  }
  return {success:true,duplicate:false};
 }
 function snapshot(){return {configured,isolated:true,persisted:false,autoConfirm:false,events:events.map(x=>({...x}))}}
 return {receive,snapshot,configured};
};
