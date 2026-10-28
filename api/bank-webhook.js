'use strict';
const crypto=require('node:crypto');
const bad=(message,status=400)=>Object.assign(Error(message),{status});
const bankBin=raw=>{
 const value=String(raw||'').toLowerCase().replace(/[^a-z0-9]/g,'');
 if(['mb','mbbank','militarybank'].includes(value))return '970422';
 if(['vietinbank','vietin','icb'].includes(value))return '970415';
 return null;
};
function referenceFrom(raw){
 const matches=String(raw||'').toUpperCase().match(/(?:^|[^A-Z0-9])TT6[A-F0-9]{14}(?![A-Z0-9])/g)||[];
 const codes=[...new Set(matches.map(x=>x.match(/TT6[A-F0-9]{14}/)?.[0]).filter(Boolean))];
 return codes.length===1?codes[0]:null;
}
function verify(raw,headers,secret,now=Date.now()){
 if(!secret||secret.length<24)throw bad('Chưa thiết lập khóa webhook SePay.',503);
 const stamp=String(headers['x-sepay-timestamp']||''),signature=String(headers['x-sepay-signature']||'');
 if(!/^\d{10}$/.test(stamp)||Math.abs(now/1000-Number(stamp))>300)throw bad('Webhook timestamp không hợp lệ.',401);
 if(!/^sha256=[0-9a-f]{64}$/i.test(signature))throw bad('Thiếu hoặc sai chữ ký webhook.',401);
 const expected=crypto.createHmac('sha256',secret).update(stamp+'.').update(raw).digest();
 const provided=Buffer.from(signature.slice(7),'hex');
 if(provided.length!==expected.length||!crypto.timingSafeEqual(provided,expected))throw bad('Chữ ký webhook không hợp lệ.',401);
 return true;
}
function parse(data){
 const id=String(data?.id??''),account=String(data?.accountNumber||''),amount=Number(data?.transferAmount);
 if(!/^\d{1,40}$/.test(id)||!/^\d{6,25}$/.test(account)||!Number.isSafeInteger(amount)||amount<=0||amount>999999999999)throw bad('Trường giao dịch không hợp lệ.');
 return {id,account,amount,bank:bankBin(data.gateway),
  ref:referenceFrom([data.code||'',data.content||''].join(' ')),incoming:data.transferType==='in'};
}
async function rawBody(req){
 if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw bad('Chỉ nhận JSON.',415);
 const pieces=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>16000)throw bad('Webhook quá lớn.',413);pieces.push(chunk)}
 return Buffer.concat(pieces);
}
function createWebhook({pool,secret='',autoConfirm=false,onPaid=()=>{}}){
 async function ingest(data){
  if(!pool)throw bad('Cần PostgreSQL.',503);
  const t=parse(data),c=await pool.connect();let paid=false;
  try{
   await c.query('BEGIN');
   const created=await c.query("INSERT INTO bank_webhook_transactions(source,external_id,bank_bin,account_number,amount,payment_reference,status) VALUES('sepay',$1,$2,$3,$4,$5,'needs_review') ON CONFLICT(source,external_id) DO NOTHING RETURNING id",[t.id,t.bank,t.account,t.amount,t.ref]);
   if(!created.rowCount){await c.query('COMMIT');return {duplicate:true}}
   let status='needs_review',orderId=null;
   if(t.incoming&&t.bank&&t.ref){
    const found=await c.query('SELECT id,payment_status,payment_method,transfer_bank_bin,transfer_account_number FROM dining_orders WHERE payment_reference=$1 FOR UPDATE',[t.ref]);
    const order=found.rows[0];
    if(order){orderId=order.id;
     if(order.payment_method==='bank_transfer'&&order.transfer_bank_bin===t.bank&&order.transfer_account_number===t.account){
      const total=(await c.query("SELECT coalesce(sum(quantity*unit_price),0)::bigint AS amount FROM dining_order_lines WHERE order_id=$1 AND status<>'cancelled'",[order.id])).rows[0].amount;
      if(Number(total)>0&&Number(total)===t.amount){
       if(order.payment_status==='paid')status='already_paid';
       else if(order.payment_status==='unpaid'){
        if(autoConfirm){
         await c.query("UPDATE dining_orders SET payment_status='paid',paid_amount=$2,paid_at=now() WHERE id=$1 AND payment_status='unpaid'",[order.id,t.amount]);
         await c.query("INSERT INTO dining_audit(order_id,actor,action,detail) VALUES($1,'system','payment_confirmed',$2::jsonb)",[order.id,JSON.stringify({provider:'sepay',eventId:t.id,bankBin:t.bank,amount:t.amount})]);
         status='auto_paid';paid=true;
        }else status='verified_test';
       }
      }
     }
    }
   }
   await c.query('UPDATE bank_webhook_transactions SET status=$2,order_id=$3 WHERE id=$1',[created.rows[0].id,status,orderId]);
   await c.query('COMMIT');
   if(paid)try{onPaid()}catch{}
   return {duplicate:false,status,paid};
  }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 }
 async function receive(req){
  const raw=await rawBody(req);verify(raw,req.headers,secret);
  let parsed;try{parsed=JSON.parse(raw.toString('utf8'))}catch{throw bad('JSON không hợp lệ.')}
  return ingest(parsed);
 }
 return {receive,ingest,enabled:secret.length>=24,autoConfirm:Boolean(autoConfirm&&secret.length>=24)};
}
module.exports={bankBin,referenceFrom,verify,parse,rawBody,createWebhook};
