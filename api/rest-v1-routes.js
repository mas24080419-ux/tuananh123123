'use strict';
// Transitional REST v1 URL adapter. Canonical resources share exactly the same
// authorized handlers and PostgreSQL transactions as legacy routes. No duplicate
// business implementation, no mutation of database data and no legacy deletion.
const staticRoutes=new Map([
 ['GET /api/v1/health','/api/health'],
 ['GET /api/v1/session','/api/me'],
 ['POST /api/v1/session/login','/api/auth/login'],
 ['POST /api/v1/session/logout','/api/logout'],
 ['GET /api/v1/tables','/api/tables'],
 ['GET /api/v1/payments/recipients','/api/payment/recipient'],
 ['GET /api/v1/kitchen/orders','/api/kds'],
 ['GET /api/v1/staff/menu-items','/api/staff/menu'],
 ['GET /api/v1/staff/orders','/api/staff/orders'],
 ['POST /api/v1/staff/orders','/api/staff/orders'],
 ['GET /api/v1/lockers','/api/lockers'],
 ['GET /api/v1/finance/reports/profitability','/api/admin/financial-model'],
 ['GET /api/v1/finance/reports/analytics','/api/admin/analytics'],
 ['GET /api/v1/finance/transactions','/api/admin/operations'],
 ['POST /api/v1/finance/transactions','/api/admin/finance/entries'],
 ['GET /api/v1/finance/ingredient-costs','/api/admin/ingredient-costs'],
 ['PUT /api/v1/finance/ingredient-costs','/api/admin/ingredient-costs'],
 ['GET /api/v1/finance/service-costs','/api/admin/service-cost-rates'],
 ['PUT /api/v1/finance/service-costs','/api/admin/service-cost-rates'],
 ['GET /api/v1/inventory','/api/admin/inventory'],
 ['POST /api/v1/inventory/items','/api/admin/inventory/items'],
 ['PUT /api/v1/inventory/recipes','/api/admin/inventory/recipes'],
 ['POST /api/v1/inventory/movements','/api/admin/inventory/movements'],
 ['GET /api/v1/payments/bank-accounts','/api/admin/receiving-banks'],
 ['PUT /api/v1/payments/bank-accounts','/api/admin/receiving-banks'],
 ['GET /api/v1/payments/bank-transactions','/api/admin/bank-transactions'],
 ['GET /api/v1/payments/sepay-sandbox','/api/admin/sepay-sandbox'],
 ['GET /api/v1/monitoring/data-flows','/api/admin/architecture/live'],
 ['GET /api/v1/staff/qr-presence','/api/admin/qr/presence'],
 ['POST /api/v1/qr/presence','/api/qr/presence'],
 ['POST /api/v1/qr/leave','/api/qr/leave']
]);
const patterns=[
 {methods:['GET'],pattern:/^\/api\/v1\/tables\/([0-9a-f]{48})\/menu$/i,target:m=>'/api/menu/'+m[1]},
 {methods:['GET'],pattern:/^\/api\/v1\/orders\/([0-9a-f-]{36})$/i,target:m=>'/api/order-status/'+m[1]},
 {methods:['POST'],pattern:/^\/api\/v1\/orders$/,target:()=>'/api/orders'},
 {methods:['PATCH'],pattern:/^\/api\/v1\/order-items\/([0-9a-f-]{36})$/i,target:m=>'/api/items/'+m[1]},
 {methods:['POST'],pattern:/^\/api\/v1\/staff\/orders\/([0-9a-f-]{36})\/payment-confirmations$/i,target:m=>'/api/staff/orders/'+m[1]+'/confirm-payment'},
 {methods:['POST'],pattern:/^\/api\/v1\/orders\/([0-9a-f-]{36})\/payment-confirmations$/i,target:m=>'/api/admin/orders/'+m[1]+'/confirm-payment'},
 {methods:['POST'],pattern:/^\/api\/v1\/lockers\/([AB](?:[1-9]|[12][0-9]|30))\/rentals$/,target:m=>'/api/lockers/'+m[1]+'/rent'},
 {methods:['POST'],pattern:/^\/api\/v1\/lockers\/([AB](?:[1-9]|[12][0-9]|30))\/releases$/,target:m=>'/api/lockers/'+m[1]+'/release'},
 {methods:['POST'],pattern:/^\/api\/v1\/lockers\/([AB](?:[1-9]|[12][0-9]|30))\/collections$/,target:m=>'/api/lockers/'+m[1]+'/collect'},
 {methods:['GET','POST'],pattern:/^\/api\/v1\/service-receipts$/,target:()=>'/api/area/receipts'},
 {methods:['GET'],pattern:/^\/api\/v1\/staff\/orders\/([0-9a-f-]{36})$/,target:()=>null}
];
function canonicalize(path,method){
 if(!path.startsWith('/api/v1/'))return {path,versioned:false};
 const m=String(method||'GET').toUpperCase();
 const exact=staticRoutes.get(m+' '+path);
 if(exact)return {path:exact,versioned:true};
 for(const route of patterns){
  const match=path.match(route.pattern);
  if(match&&route.methods.includes(m)){
   const target=route.target(match);
   if(target)return {path:target,versioned:true};
  }
 }
 return {path,versioned:true,unsupported:true};
}
module.exports={canonicalize};
