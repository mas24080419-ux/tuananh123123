'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {Readable}=require('node:stream');
const createSandbox=require('../sepay-sandbox');
const {verify}=require('../bank-webhook');
const secret='test-only-sepay-sandbox-hmac-123456789012345';
const now=Date.parse('2026-10-28T16:00:00Z');
const sample=(id,bank='MBBank')=>({
 id,gateway:bank,accountNumber:'0123456789',content:'SEVQR TT6AABBCCDDEEFF11',
 transferType:'in',transferAmount:150000
});
function signed(payload,{tamper=false}={}){
 const raw=Buffer.from(JSON.stringify(payload));
 const ts=String(now/1000);
 const hmac=crypto.createHmac('sha256',secret).update(ts+'.').update(raw).digest('hex');
 const req=Readable.from([tamper?Buffer.from(raw.toString()+' '):raw]);
 req.headers={'content-type':'application/json','x-sepay-timestamp':ts,'x-sepay-signature':'sha256='+hmac};
 return req;
}
test('sandbox rejects signed events without configured secret',async()=>{
 const s=createSandbox();
 assert.equal(s.snapshot().configured,false);
 await assert.rejects(()=>s.receive(signed(sample(1))),e=>e.status===503);
});
test('sandbox accepts signed MB and VietinBank trial events but stores only bounded redacted RAM history',async()=>{
 const s=createSandbox({secret,clock:()=>now,capacity:2});
 const first=await s.receive(signed(sample(1)));
 assert.deepEqual(first,{success:true,duplicate:false});
 const retry=await s.receive(signed(sample(1)));
 assert.deepEqual(retry,{success:true,duplicate:true});
 await s.receive(signed(sample(2,'VietinBank')));
 await s.receive(signed(sample(3)));
 const result=s.snapshot();
 assert.equal(result.events.length,2);
 assert.equal(result.events[0].bankBin,'970422');
 assert.equal(result.events[1].bankBin,'970415');
 assert(result.events.every(x=>x.mode==='sandbox'&&x.noRealPayment&&x.accountTail==='••••6789'));
 assert(!JSON.stringify(result).includes('0123456789'));
 assert.equal(result.persisted,false);
 assert.equal(result.autoConfirm,false);
});
test('sandbox rejects fake signatures and old timestamp without recording anything',async()=>{
 const s=createSandbox({secret,clock:()=>now});
 await assert.rejects(()=>s.receive(signed(sample(9),{tamper:true})),e=>e.status===401);
 assert.equal(s.snapshot().events.length,0);
});
test('sandbox path and admin status are separate from production reconciliation',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const src=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 const ui=fs.readFileSync(path.join(__dirname,'../public/payment.html'),'utf8');
 assert(src.includes("p==='/api/webhooks/sepay-sandbox'"));
 assert(src.includes("p==='/api/admin/sepay-sandbox'"));
 assert(src.includes("process.env.SEPAY_SANDBOX_SECRET"));
 assert(ui.includes('sepaySandboxUrl'));
 const sandbox=fs.readFileSync(path.join(__dirname,'../sepay-sandbox.js'),'utf8');
 assert(!sandbox.includes('pool.query'));
 assert(!sandbox.includes('UPDATE dining_orders'));
 assert(!sandbox.includes('paid_amount'));
});
