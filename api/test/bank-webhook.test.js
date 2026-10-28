'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const {verify,parse,referenceFrom,createWebhook}=require('../bank-webhook');
const base=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(base,p),'utf8');
const secret='unit-test-only-sepay-secret-0123456789';
const ref='TT6AABBCCDDEEFF11';
const payload=(extra={})=>({id:92704,gateway:'MBBank',accountNumber:'1234567890',content:'Thanh toan '+ref,transferType:'in',transferAmount:150000,...extra});
function fakePool({order={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',payment_status:'unpaid',payment_method:'bank_transfer',transfer_bank_bin:'970422',transfer_account_number:'1234567890'},amount=150000}={}){
 let exists=false,paid=0,audits=0,webhookStatus=null,transactions=[];
 return {
  get results(){return {paid,audits,webhookStatus,transactions}},
  async connect(){return {async query(sql,params=[]){
   transactions.push(sql);
   if(sql.includes('INSERT INTO bank_webhook_transactions')){
    if(exists)return {rowCount:0,rows:[]};
    exists=true;return {rowCount:1,rows:[{id:1}]};
   }
   if(sql.includes('SELECT id,payment_status,payment_method,transfer_bank_bin'))return {rows:order?[{...order}]:[]};
   if(sql.includes('SELECT coalesce(sum(quantity*unit_price)'))return {rows:[{amount:String(amount)}]};
   if(sql.includes("UPDATE dining_orders SET payment_status='paid'")){paid++;return {rowCount:1}};
   if(sql.includes('INSERT INTO dining_audit')){audits++;return {rowCount:1}};
   if(sql.includes('UPDATE bank_webhook_transactions SET')){webhookStatus=params[1];return {rowCount:1}};
   return {rowCount:1,rows:[]};
  },release(){}}}
 };
}
test('SePay HMAC signs timestamp and original byte payload; rejects altered and replayed requests',()=>{
 const raw=Buffer.from(JSON.stringify(payload()),'utf8'),timestamp=String(Math.floor(Date.now()/1000));
 const signed='sha256='+crypto.createHmac('sha256',secret).update(timestamp+'.').update(raw).digest('hex');
 assert.equal(verify(raw,{'x-sepay-timestamp':timestamp,'x-sepay-signature':signed},secret),true);
 assert.throws(()=>verify(Buffer.from(raw.toString()+' '),{'x-sepay-timestamp':timestamp,'x-sepay-signature':signed},secret),/chữ ký/i);
 assert.throws(()=>verify(raw,{'x-sepay-timestamp':String(Number(timestamp)-900),'x-sepay-signature':signed},secret),/timestamp/);
 assert.throws(()=>verify(raw,{'x-sepay-timestamp':timestamp,'x-sepay-signature':signed},''),/khóa/);
});
test('MB and VietinBank codes, unique order reference, outgoing transfer rejection',()=>{
 assert.equal(parse(payload()).bank,'970422');
 assert.equal(parse(payload({gateway:'VietinBank',content:'SEVQR '+ref})).bank,'970415');
 assert.equal(referenceFrom('SEVQR '+ref),ref);
 assert.equal(referenceFrom(ref+'X'),null);
 assert.equal(referenceFrom('TT6AABBCCDDEEFF11 TT612345678901234'),null);
 assert.equal(parse(payload({transferType:'out'})).incoming,false);
 assert.throws(()=>parse(payload({transferAmount:-100})),/không hợp lệ/);
});
test('verified test webhook records matched receipt WITHOUT changing actual payment',async()=>{
 const db=fakePool();
 const handler=createWebhook({pool:db,secret,autoConfirm:false});
 const result=await handler.ingest(payload());
 assert.equal(result.status,'verified_test');
 assert.equal(db.results.paid,0);
 assert.equal(db.results.audits,0);
 assert.equal(db.results.webhookStatus,'verified_test');
 const retry=await handler.ingest(payload());
 assert.equal(retry.duplicate,true);
 assert.equal(db.results.paid,0);
});
test('live mode exact verified bank, amount, reference marks paid once and writes audit',async()=>{
 const db=fakePool();let notifications=0;
 const handler=createWebhook({pool:db,secret,autoConfirm:true,onPaid:()=>notifications++});
 const first=await handler.ingest(payload());
 assert.equal(first.status,'auto_paid');
 assert.equal(db.results.paid,1);assert.equal(db.results.audits,1);assert.equal(notifications,1);
 const retry=await handler.ingest(payload());
 assert.equal(retry.duplicate,true);
 assert.equal(db.results.paid,1);assert.equal(db.results.audits,1);
});
test('wrong receiving account, bank, amount or no matching order always requires review',async()=>{
 for(const changed of [{accountNumber:'2222222222'},{gateway:'VietinBank'},{transferAmount:149000},{content:'TRANSFER OTHER'},{transferType:'out'}]){
  const db=fakePool();const result=await createWebhook({pool:db,secret,autoConfirm:true}).ingest(payload(changed));
  assert.equal(result.status,'needs_review',JSON.stringify(changed));
  assert.equal(db.results.paid,0);
 }
 const db=fakePool({order:null});
 const result=await createWebhook({pool:db,secret,autoConfirm:true}).ingest(payload());
 assert.equal(result.status,'needs_review');
});
test('public QR selection keeps the two accounts separate and Vietin requires SEVQR',()=>{
 const guest=read('public/guest.js'),html=read('public/guest.html'),server=read('server.js'),schema=read('schema.sql');
 assert(guest.includes("bankBin: selectedPaymentMethod==='bank_transfer'?bankRecipient?.bankBin:null"));
 assert(html.includes('id="receivingBankSelect"'));
 assert(server.includes("const paymentRef=chosenBank?")||server.includes("paymentRef=chosenBank?"));
 assert(server.includes("recipient?.bankBin==='970415'?'SEVQR ':'"));
 assert(server.includes("if(!sepayWebhook.enabled)return err(res,503"));
 assert(!server.includes("SEPAY_AUTO_CONFIRM = true"));
 assert(schema.includes('UNIQUE(source,external_id)'));
});
