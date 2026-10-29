'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {resolveRestV1,mapping}=require('../rest-v1');
test('v1 paths forward to the same legacy business operations',()=>{
 for(const [method,route,target] of mapping){
  assert.equal(resolveRestV1(route,method),target,route);
  assert.equal(resolveRestV1(route,'TRACE'),'/api/__unknown-rest-v1-route',route);
 }
});
test('resource paths correctly represent order updates, payments and locker rentals',()=>{
 const id='a1d5b18d-7dbe-4c34-9899-8e8c0c05b606';
 const entries=[
  ['GET','/api/v1/orders/'+id,'/api/order-status/'+id],
  ['PATCH','/api/v1/order-items/'+id,'/api/items/'+id],
  ['POST','/api/v1/staff/orders/'+id+'/payment-confirmations','/api/staff/orders/'+id+'/confirm-payment'],
  ['POST','/api/v1/admin/orders/'+id+'/payment-confirmations','/api/admin/orders/'+id+'/confirm-payment'],
  ['POST','/api/v1/lockers/A30/rentals','/api/lockers/A30/rent'],
  ['POST','/api/v1/lockers/B1/returns','/api/lockers/B1/release'],
  ['POST','/api/v1/lockers/B12/payments','/api/lockers/B12/collect'],
  ['PUT','/api/v1/inventory/items/'+id+'/reorder-level','/api/admin/inventory/items/'+id+'/reorder']
 ];
 for(const [method,route,target] of entries)assert.equal(resolveRestV1(route,method),target,route);
});
test('unlisted versioned path is rejected and old paths remain untouched in migration',()=>{
 assert.equal(resolveRestV1('/api/v1/unsupported','GET'),'/api/__unknown-rest-v1-route');
 assert.equal(resolveRestV1('/api/orders','POST'),'/api/orders');
});
