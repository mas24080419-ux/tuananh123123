'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {canonicalize}=require('../rest-v1-routes');
const publicDir=path.join(__dirname,'../public');
test('shipped frontend JS uses only canonical /api resource URLs except external bank webhook callbacks',()=>{
 let endpoints=0;
 for(const filename of fs.readdirSync(publicDir).filter(n=>n.endsWith('.js'))){
  const source=fs.readFileSync(path.join(publicDir,filename),'utf8');
  assert(!source.includes('/api/v1/'),filename+' still refers to transitional v1');
  const found=source.match(/\/api\/(?!v1\/)[a-z0-9_/-]+/ig)||[];
  for(const url of found){
   if(url.startsWith('/api/webhooks/'))continue;
   endpoints++;
   assert(!url.startsWith('/api/admin/'),filename+' uses retired admin namespace: '+url);
   assert(!url.startsWith('/api/area/'),filename+' uses retired service namespace: '+url);
   assert(!url.startsWith('/api/order-status'),filename+' uses retired order read namespace: '+url);
   assert(!url.startsWith('/api/menu/'),filename+' uses retired menu namespace: '+url);
   assert(!url.startsWith('/api/items/'),filename+' uses retired item mutation namespace: '+url);
  }
 }
 assert(endpoints>=35,'The scan must cover real frontend endpoints');
});
test('operational domains all map canonical /api to the same protected and transactional backend',()=>{
 const uuid='11111111-1111-4111-8111-111111111111';
 const cases=[
 ['GET','/api/finance/reports/profitability','/api/admin/financial-model'],
 ['POST','/api/finance/entries','/api/admin/finance/entries'],
 ['GET','/api/finance/operations','/api/admin/operations'],
 ['POST','/api/staff/orders','/api/staff/orders'],
 ['POST','/api/orders','/api/orders'],
 ['PATCH','/api/order-items/'+uuid,'/api/items/'+uuid],
 ['POST','/api/orders/'+uuid+'/payment-confirmations','/api/admin/orders/'+uuid+'/confirm-payment'],
 ['GET','/api/inventory','/api/admin/inventory'],
 ['PATCH','/api/inventory/items/'+uuid+'/reorder','/api/admin/inventory/items/'+uuid+'/reorder'],
 ['PUT','/api/inventory/recipes','/api/admin/inventory/recipes'],
 ['GET','/api/management/users','/api/admin/users'],
 ['POST','/api/management/core/catalog','/api/admin/core/catalog'],
 ['GET','/api/management/architecture/system/live','/api/admin/architecture/system/live'],
 ['POST','/api/service-receipts','/api/area/receipts'],
 ['POST','/api/lockers/A1/rentals','/api/lockers/A1/rent'],
 ['GET','/api/payments/bank-accounts','/api/admin/receiving-banks'],
 ['PUT','/api/payments/bank-accounts','/api/admin/receiving-banks'],
 ['GET','/api/management/summary','/api/admin/summary'],
 ['GET','/api/session','/api/me'],
 ['POST','/api/session/login','/api/auth/login'],
 ['POST','/api/session/logout','/api/logout']
 ];
 for(const [method,url,expected] of cases)
  assert.equal(canonicalize(url,method).path,expected,method+' '+url);
 assert.equal(canonicalize('/api/webhooks/sepay','POST').path,'/api/webhooks/sepay');
 assert.equal(canonicalize('/api/webhooks/sepay-sandbox','POST').path,'/api/webhooks/sepay-sandbox');
});
test('api contract files distinguish canonical URLs from compatibility v1',()=>{
 const spec=fs.readFileSync(path.join(__dirname,'../openapi.yaml'),'utf8');
 const compat=fs.readFileSync(path.join(__dirname,'../openapi-v1.yaml'),'utf8');
 assert(spec.includes('/api/orders:') && spec.includes('/api/finance/reports/profitability:'));
 assert(compat.includes('/api/v1/orders:'));
});
