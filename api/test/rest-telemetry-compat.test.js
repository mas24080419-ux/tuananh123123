'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const flow=require('../system-flow');
test('system telemetry recognizes canonical REST and versioned traffic without treating auth or webhook as orders',()=>{
 const sys=flow({pool:null});
 for(const [method,path,module] of [
  ['POST','/api/orders','orders'],
  ['POST','/api/v1/orders','orders'],
  ['POST','/api/staff/orders','stafforder'],
  ['POST','/api/finance/entries','finance'],
  ['GET','/api/finance/reports/analytics','finance'],
  ['POST','/api/lockers/A1/rentals','rental'],
  ['POST','/api/service-receipts','rental'],
  ['PATCH','/api/order-items/11111111-1111-4111-8111-111111111111','kds'],
  ['POST','/api/management/core/catalog','admin']
 ]){
  assert.equal(sys.classify(method,path)?.module,module,method+' '+path);
 }
 for(const path of ['/api/session','/api/management/architecture/live','/api/staff/order-presence','/api/payments/recipients','/api/webhooks/sepay'])
  assert.equal(sys.classify('GET',path),null,'Must skip sensitive or non-business read: '+path);
});
