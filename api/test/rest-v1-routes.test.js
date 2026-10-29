'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {canonicalize}=require('../rest-v1-routes');
const uuid='11111111-1111-4111-8111-111111111111';
const token='a'.repeat(48);
const samples=[
 ['GET','/api/v1/session','/api/me'],
 ['POST','/api/v1/session/login','/api/auth/login'],
 ['POST','/api/v1/session/logout','/api/logout'],
 ['GET','/api/v1/tables/'+token+'/menu','/api/menu/'+token],
 ['GET','/api/v1/orders/'+uuid,'/api/order-status/'+uuid],
 ['POST','/api/v1/orders','/api/orders'],
 ['PATCH','/api/v1/order-items/'+uuid,'/api/items/'+uuid],
 ['GET','/api/v1/payments/recipients','/api/payment/recipient'],
 ['GET','/api/v1/finance/reports/profitability','/api/admin/financial-model'],
 ['PUT','/api/v1/finance/ingredient-costs','/api/admin/ingredient-costs'],
 ['GET','/api/v1/finance/service-costs','/api/admin/service-cost-rates'],
 ['POST','/api/v1/staff/orders/'+uuid+'/payment-confirmations','/api/staff/orders/'+uuid+'/confirm-payment'],
 ['POST','/api/v1/orders/'+uuid+'/payment-confirmations','/api/admin/orders/'+uuid+'/confirm-payment'],
 ['POST','/api/v1/lockers/A1/rentals','/api/lockers/A1/rent'],
 ['POST','/api/v1/lockers/B30/releases','/api/lockers/B30/release'],
 ['POST','/api/v1/service-receipts','/api/area/receipts']
];
test('versioned REST routes reuse exact legacy business transactions',()=>{
 for(const [method,url,expected] of samples){
  assert.deepEqual(canonicalize(url,method),{path:expected,versioned:true},method+' '+url);
 }
});
test('REST adapter rejects unknown paths and wrong methods, leaves legacy unchanged',()=>{
 assert.deepEqual(canonicalize('/api/v1/unknown','GET'),{path:'/api/v1/unknown',versioned:true,unsupported:true});
 assert.equal(canonicalize('/api/v1/orders','DELETE').unsupported,true);
 assert.equal(canonicalize('/api/v1/lockers/C5/rentals','POST').unsupported,true);
 assert.deepEqual(canonicalize('/api/orders','POST'),{path:'/api/orders',versioned:false});
 assert.equal(canonicalize('/api/v1/orders/garbage','GET').unsupported,true);
});
test('all migrated frontend clients use canonical unversioned endpoints; script syntax is valid',()=>{
 const dir=path.join(__dirname,'../public');
 for(const name of ['guest.js','staff-orders.js','financial-intelligence.js']){
  const js=fs.readFileSync(path.join(dir,name),'utf8');
  assert(js.includes('/api/'),name);
  assert(!js.includes('/api/v1/'),'Frontend must use canonical unversioned REST');
  assert.doesNotThrow(()=>new vm.Script(js,{filename:name}),name);
 }
 const guest=fs.readFileSync(path.join(dir,'guest.js'),'utf8');
 assert(guest.includes("'/api/tables/'+tableToken+'/menu'"));
 assert(guest.includes('/api/payments/recipients'));
 const staff=fs.readFileSync(path.join(dir,'staff-orders.js'),'utf8');
 assert(staff.includes('/api/staff/orders/'));
 assert(staff.includes("+'/payment-confirmations'"));
 const finance=fs.readFileSync(path.join(dir,'financial-intelligence.js'),'utf8');
 assert(finance.includes('/api/finance/reports/profitability'));
});
test('canonical REST routes /api reuse the same guarded transaction handlers',()=>{
 for(const [method,url,expected] of samples){
  const unversioned=url.replace('/api/v1/','/api/');
  assert.deepEqual(canonicalize(unversioned,method),{path:expected,versioned:false},method+' '+unversioned);
 }
 assert.deepEqual(canonicalize('/api/admin/summary','GET'),{path:'/api/admin/summary',versioned:false});
 assert.deepEqual(canonicalize('/api/webhooks/sepay','POST'),{path:'/api/webhooks/sepay',versioned:false});
 assert.deepEqual(canonicalize('/api/webhooks/sepay-sandbox','POST'),{path:'/api/webhooks/sepay-sandbox',versioned:false});
});
test('REST v1 preserves shared auth and validation instead of bypassing them',()=>{
 const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 assert(server.includes('const mapped=restV1.canonicalize(originalPath,req.method)'));
 assert(server.includes('if(!sameOrigin(req,res))return'));
 assert(server.includes('if(mapped.unsupported)return err(res,404'));
 assert(server.includes('if(!await requireAdmin(req,res))return'));
 assert(server.includes('if(!await requireAuth(req,res))return'));
 assert(server.includes("await ops.consume(c,orderId)"));
 assert(server.includes("confirmPayment(p.split('/')[4]"));
});
